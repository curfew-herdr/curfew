// The pull-request rules of que's review pane, as plain functions with no host calls, so
// `node --test` runs them: the branches a worktree has had (its HEAD reflog), the pull requests a
// session created (prs.jsonl, written by a Claude Code hook), what gh prints, how the sources merge
// and are remembered, and how the list orders, counts and words them. Ported from que (Apache-2.0):
// src/daemon/{branch-history,pr-created,pr-state,pr-state.decode,pr-thread}.ts and
// src/renderer/src/{pr-list,format}.ts. See NOTICE.

// ---- branch history (que: branch-history.ts) -------------------------------------------------

/** `list` with each of `items` not already in it appended, in order, once. */
export function appendNew(list, items) {
  const out = [...list];
  for (const item of items) if (!out.includes(item)) out.push(item);
  return out;
}

/** `list` with `branch` at the end, unless it is already in it. */
export const withBranch = (list, branch) => appendNew(list, [branch]);

/** `list` with `from` renamed `to`: in its place, or dropped when `to` is already there. */
export function renameBranch(list, from, to) {
  return list.includes(to) ? list.filter((b) => b !== from) : list.map((b) => (b === from ? to : b));
}

/** True for a name a checkout entry may hold that is not a branch: a sha, HEAD, or a revision expression. */
function notABranch(name) {
  return (
    name === "" ||
    name === "HEAD" ||
    name.startsWith("-") ||
    /^[0-9a-f]{7,40}$/.test(name) ||
    /[\s~^:?*[\\]|@\{/.test(name)
  );
}

/**
 * The branches in `git reflog show --format=%gs HEAD` output (newest first, as git prints it),
 * oldest first: both sides of each `checkout: moving from <a> to <b>`, a rename replacing its old
 * name. Detached checkouts (a sha, a revision expression) are left out.
 */
export function reflogBranches(out) {
  let list = [];
  for (const line of String(out ?? "").split("\n").reverse()) {
    const moved = /^checkout: moving from (\S+) to (\S+)$/.exec(line.trim());
    if (moved) {
      list = appendNew(list, moved.slice(1).filter((name) => !notABranch(name)));
      continue;
    }
    const [, from, to] = /^Branch: renamed refs\/heads\/(\S+) to refs\/heads\/(\S+)$/.exec(line.trim()) ?? [];
    if (from && to) list = renameBranch(list, from, to);
  }
  return list;
}

/**
 * The branches to ask GitHub about: each the worktree has had, the current one last, never a
 * default branch (que leaves the project's default and protected branches out) or a detached HEAD.
 */
export function headsOf(branches, current, defaults) {
  const list = current && current !== "HEAD" ? withBranch(branches, current) : [...branches];
  return list.filter((b) => !defaults.includes(b));
}

// ---- repositories and pull request URLs (que: pr-created.ts) ----------------------------------

/** The owner and name of a GitHub remote (https, ssh or scp form); null for any other. */
export function githubRepo(remote) {
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/\s]+@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      String(remote ?? "").trim(),
    );
  return m?.[1] && m[2] ? { owner: m[1], name: m[2] } : null;
}

export const sameRepo = (a, b) =>
  Boolean(a && b) && a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();

const PR_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/;

/** `https://github.com/<owner>/<name>/pull/<n>` as its parts; null for any other text. */
export function prUrl(url) {
  const m = PR_URL.exec(String(url ?? "").trim());
  return m ? { owner: m[1], name: m[2], number: Number(m[3]) } : null;
}

/** `owner/name`. */
export const repoName = (r) => `${r.owner}/${r.name}`;

// ---- sessions: prs.jsonl and which worktree a cwd is in ------------------------------------------

/** A path without a trailing slash, and macOS's /private/tmp and /private/var as /tmp and /var. */
export const normPath = (p) =>
  String(p ?? "").replace(/\/+$/, "").replace(/^\/private(?=\/(?:tmp|var|etc)(?:\/|$))/, "") || "/";

/** The worktree among `roots` that holds `path`: the deepest, so one nested in another's folder keeps its own. */
export function ownerRoot(path, roots) {
  const p = normPath(path);
  let best = null;
  for (const root of roots) {
    const r = normPath(root);
    if ((p === r || p.startsWith(r === "/" ? "/" : `${r}/`)) && (best === null || r.length > normPath(best).length)) best = root;
  }
  return best;
}

const str = (v) => (typeof v === "string" ? v : "");

/** One line of prs.jsonl (`{at, sessionId, cwd, url, owner, repo, number}`); null when it is not one. */
export function decodeLogLine(line) {
  let v;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || !str(v.cwd)) return null;
  const fromUrl = prUrl(v.url);
  // `repo` is the name; a line that writes `owner/name` there is read too.
  const [ownerPart, namePart] = str(v.repo).includes("/") ? str(v.repo).split("/") : [str(v.owner), str(v.repo)];
  const owner = ownerPart || fromUrl?.owner || "";
  const name = namePart || fromUrl?.name || "";
  const n = Number.isInteger(v.number) ? v.number : Number.parseInt(str(v.number), 10);
  const number = Number.isInteger(n) && n > 0 ? n : (fromUrl?.number ?? 0);
  if (!owner || !name || !number) return null;
  return {
    at: typeof v.at === "number" ? new Date(v.at).toISOString() : str(v.at),
    sessionId: str(v.sessionId),
    cwd: v.cwd,
    owner,
    name,
    number,
    url: fromUrl ? str(v.url).trim() : `https://github.com/${owner}/${name}/pull/${number}`,
  };
}

/**
 * The pull requests the sessions in worktree `root` created on one of `repos` (its origin, or the
 * name GitHub gives it now), from prs.jsonl's text: a line belongs to the worktree that holds its
 * cwd, the deepest of `root` and `others` (the repository's other worktrees). Each number once,
 * in the order logged. que counts only a pull request on the project's own repository.
 */
export function sessionPrs(text, root, others, repos) {
  const out = [];
  const seen = new Set();
  const roots = [root, ...others];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    const e = decodeLogLine(line);
    if (!e || seen.has(e.number)) continue;
    const owner = ownerRoot(e.cwd, roots);
    if (owner === null || normPath(owner) !== normPath(root)) continue;
    if (!repos.some((r) => sameRepo(r, e))) continue;
    seen.add(e.number);
    out.push(e);
  }
  return out;
}

/** `git worktree list --porcelain` as the worktrees' folders. */
export function worktreeRoots(out) {
  return String(out ?? "")
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}

// ---- what gh prints (que: pr-state.decode.ts, pr-thread.decode.ts) -----------------------------

/** The fields asked of `gh pr list` / `gh pr view`. */
export const FIELDS =
  "number,url,title,state,isDraft,reviewDecision,statusCheckRollup,mergedAt,updatedAt,additions,deletions,baseRefName,headRefName";

/** A repository's listing: FIELDS without the check rollup, the heaviest part; checks are asked of each head that needs them. */
export const LIST_FIELDS = FIELDS.split(",").filter((f) => f !== "statusCheckRollup").join(",");

/** A repository's tick lists at most this many of its most recent pull requests. */
export const LIST_LIMIT = 100;

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v) => (typeof v === "string" && v ? v : null);
const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const objects = (v) => (Array.isArray(v) ? v.filter(isObj) : []);

function decodeCheck(i) {
  const status =
    i.__typename === "StatusContext" ||
    (i.__typename !== "CheckRun" && "state" in i && !("status" in i) && !("conclusion" in i));
  if (status) {
    return {
      kind: "status",
      name: str(i.context) || str(i.name),
      state: str(i.state),
      targetUrl: strOrNull(i.targetUrl),
      createdAt: strOrNull(i.createdAt),
    };
  }
  if (!(i.__typename === "CheckRun" || "status" in i || "conclusion" in i)) return null;
  return {
    kind: "run",
    name: str(i.name) || str(i.context),
    workflowName: strOrNull(i.workflowName),
    status: str(i.status),
    conclusion: str(i.conclusion),
    detailsUrl: strOrNull(i.detailsUrl),
    startedAt: strOrNull(i.startedAt),
    completedAt: strOrNull(i.completedAt),
  };
}

/** One `gh pr list` / `gh pr view` item; null when it has no number or url. `checks` is null when it carries no rollup. */
export function decodePullRequest(v) {
  if (!isObj(v) || typeof v.number !== "number" || typeof v.url !== "string" || !v.url) return null;
  return {
    number: v.number,
    url: v.url,
    title: str(v.title),
    state: str(v.state),
    isDraft: v.isDraft === true,
    mergedAt: strOrNull(v.mergedAt),
    reviewDecision: str(v.reviewDecision),
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null,
    additions: numOrNull(v.additions),
    deletions: numOrNull(v.deletions),
    baseRefName: str(v.baseRefName),
    headRefName: str(v.headRefName),
    checks: "statusCheckRollup" in v ? objects(v.statusCheckRollup).map(decodeCheck).filter(Boolean) : null,
  };
}

export const decodePullRequests = (v) => (Array.isArray(v) ? v.map(decodePullRequest).filter(Boolean) : []);

/** Splits back-to-back JSON values (`gh api --paginate` prints one per page) and parses each. */
export function jsonPages(text) {
  const pages = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") {
      if (depth++ === 0) start = i;
    } else if (ch === "]" || ch === "}") {
      if (--depth === 0) pages.push(JSON.parse(text.slice(start, i + 1)));
    } else if (depth === 0 && !/\s/.test(ch)) throw new Error("not JSON");
  }
  if (depth !== 0 || inString) throw new Error("not JSON");
  return pages;
}

/** Every page's items, joined. */
export const pagedItems = (text) => jsonPages(text).flatMap((page) => (Array.isArray(page) ? page : [page]));

// ---- pull request state (que: pr-state.ts) -----------------------------------------------------

const FAILED = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const CHECK_ORDER = { failing: 0, pending: 1, passing: 2, skipped: 3 };

function checkRunState(status, conclusion) {
  if (status && status !== "COMPLETED") return "pending";
  if (FAILED.has(conclusion)) return "failing";
  if (conclusion === "SUCCESS") return "passing";
  return "skipped";
}

function statusContextState(state) {
  if (state === "SUCCESS") return "passing";
  if (state === "FAILURE" || state === "ERROR") return "failing";
  return "pending";
}

function checkOf(c) {
  if (c.kind === "status") {
    const state = statusContextState(c.state);
    return { name: c.name, source: null, state, url: c.targetUrl, startedAt: null, completedAt: state === "pending" ? null : c.createdAt };
  }
  return {
    name: c.name,
    source: c.workflowName,
    state: checkRunState(c.status, c.conclusion),
    url: c.detailsUrl,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
  };
}

const timeOf = (c) => (c.kind === "status" ? c.createdAt : (c.startedAt ?? c.completedAt));
const checkKey = (c) => (c.kind === "status" ? `status\0${c.name}` : `run\0${c.workflowName ?? ""}\0${c.name}`);

function supersedes(next, kept) {
  const a = timeOf(next);
  const b = timeOf(kept);
  if (a === null || b === null) return a !== null || b === null;
  return a >= b;
}

/** The rollup's runs and statuses, a re-run collapsed to its newest; failing, pending, passing, skipped; by name within each. */
export function checkRunsOf(rollup) {
  const newest = new Map();
  for (const c of rollup) {
    const key = checkKey(c);
    const kept = newest.get(key);
    if (!kept || supersedes(c, kept)) newest.set(key, c);
  }
  return [...newest.values()].map(checkOf).sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name));
}

function checksOf(runs) {
  if (runs.length === 0) return "none";
  if (runs.some((r) => r.state === "failing")) return "failing";
  if (runs.some((r) => r.state === "pending")) return "pending";
  return "passing";
}

const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes_requested", REVIEW_REQUIRED: "review_required" };

/** open, draft, merged or closed. */
export function stateOf(r) {
  if (r.mergedAt || r.state === "MERGED") return "merged";
  if (r.state === "CLOSED") return "closed";
  return r.isDraft ? "draft" : "open";
}

/**
 * A decoded item as the pull request this mod keeps. One listed without its rollup keeps the
 * checks of its copy in `stored`, else has none. Comment counts come from `stored` (see withCounts).
 */
export function parsePullRequest(r, checkedAt, stored = []) {
  const old = stored.find((p) => p.number === r.number);
  const keep = r.checks === null ? old : undefined;
  const checkRuns = r.checks === null ? (keep?.checkRuns ?? []) : checkRunsOf(r.checks);
  return {
    url: r.url,
    number: r.number,
    title: r.title,
    state: stateOf(r),
    checks: keep ? keep.checks : checksOf(checkRuns),
    review: REVIEW[r.reviewDecision] ?? null,
    checkRuns,
    updatedAt: r.updatedAt,
    additions: r.additions,
    deletions: r.deletions,
    base: r.baseRefName,
    head: r.headRefName,
    checkedAt,
    comments: old?.comments ?? null,
    commentedAt: old?.commentedAt ?? null,
    commentsFor: old?.commentsFor ?? null,
  };
}

/** At most this many pull requests are kept per worktree. */
export const PR_LIST_CAP = 20;

/**
 * One entry per number (the first seen wins), newest first by number, at most PR_LIST_CAP.
 * `stored` is what the worktree held before: one missing from `prs` is kept (its branch moved on),
 * one in `prs` gives way to the fresh copy.
 */
export function pullRequestList(prs, stored = []) {
  const seen = new Set();
  const out = [];
  for (const pr of [...prs, ...stored]) {
    if (seen.has(pr.number)) continue;
    seen.add(pr.number);
    out.push(pr);
  }
  return out.sort((a, b) => b.number - a.number).slice(0, PR_LIST_CAP);
}

/** A merged or closed pull request no longer changes much, so it is checked less often. */
export const isSettled = (pr) => pr.state === "merged" || pr.state === "closed";

/**
 * True when one listed without its rollup may keep its stored checks: both copies are settled.
 * While those are still pending they are read again when `due`.
 */
export function keepsStoredChecks(r, stored, due) {
  const old = stored.find((p) => p.number === r.number);
  if (!old || !isSettled(old) || !isSettled({ state: stateOf(r) })) return false;
  return !due || old.checks !== "pending";
}

/** A repository's listing grouped by head branch; `full` when it hit LIST_LIMIT. */
export function groupByHead(items) {
  const byBranch = new Map();
  for (const item of items) {
    const pr = decodePullRequest(item);
    if (!pr?.headRefName) continue;
    const list = byBranch.get(pr.headRefName);
    if (list) list.push(pr);
    else byBranch.set(pr.headRefName, [pr]);
  }
  return { byBranch, full: items.length >= LIST_LIMIT };
}

/**
 * What the listing settles and which heads gh must be asked about on their own, checks included:
 * every head when the listing failed (null), a head a full page misses, and a head holding a pull
 * request whose checks are not kept from before (an open or draft one, or one that just settled).
 */
export function planHeads(heads, listing, stored, due) {
  const settled = [];
  const ask = [];
  for (const head of heads) {
    if (!listing) {
      ask.push(head);
      continue;
    }
    const prs = listing.byBranch.get(head);
    if (!prs) {
      if (listing.full) ask.push(head);
      continue;
    }
    if (prs.every((pr) => keepsStoredChecks(pr, stored, due))) settled.push(...prs);
    else ask.push(head);
  }
  return { settled, ask };
}

/**
 * The session-created pull requests (`created`, from sessionPrs) not among `onBranch`: those to
 * look up by number now, and settled ones stored before, reused until `due`.
 */
export function linkedPlan(created, onBranch, stored, due) {
  const known = new Set(onBranch.map((pr) => pr.number));
  const lookUp = [];
  const reuse = [];
  for (const e of created) {
    if (known.has(e.number)) continue;
    known.add(e.number);
    const old = stored.find((p) => p.number === e.number);
    if (old && isSettled(old) && !due) reuse.push(old);
    else lookUp.push(e);
  }
  return { lookUp, reuse };
}

/** The repositories a listing's pull requests are on, by their URLs (GitHub's current names). */
export function reposOf(prs) {
  const out = [];
  for (const pr of prs) {
    const r = prUrl(pr.url);
    if (r && !out.some((o) => sameRepo(o, r))) out.push({ owner: r.owner, name: r.name });
  }
  return out;
}

// ---- comments (que: pr-thread.ts) --------------------------------------------------------------

function reviewStateOf(state) {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "DISMISSED":
      return "dismissed";
    case "PENDING":
      return "pending";
    default:
      return "commented";
  }
}

const idOf = (v) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const loginOf = (v) => (isObj(v) && strOrNull(v.login)) || "unknown";

/**
 * A pull request's conversation, oldest first: issue comments and reviews from
 * `gh pr view --json comments,reviews`, line comments from the REST `pulls/{n}/comments` list.
 */
export function parseThread(view, lineComments) {
  const entries = [];
  const v = isObj(view) ? view : {};
  for (const c of objects(v.comments)) {
    entries.push({ id: `comment:${idOf(c.id)}`, kind: "comment", author: loginOf(c.author), body: str(c.body), at: str(c.createdAt), url: strOrNull(c.url), state: null, path: null, line: null });
  }
  for (const r of objects(v.reviews)) {
    const state = reviewStateOf(str(r.state));
    // GitHub wraps every batch of line comments in an empty COMMENTED review.
    if (state === "commented" && !str(r.body).trim()) continue;
    entries.push({ id: `review:${idOf(r.id)}`, kind: "review", author: loginOf(r.author), body: str(r.body), at: str(r.submittedAt), url: strOrNull(r.url), state, path: null, line: null });
  }
  for (const l of objects(lineComments)) {
    entries.push({
      id: `line:${idOf(l.id)}`,
      kind: "line",
      author: loginOf(l.user),
      body: str(l.body),
      at: str(l.created_at),
      url: strOrNull(l.html_url),
      state: null,
      path: strOrNull(l.path),
      line: numOrNull(l.line) ?? numOrNull(l.original_line),
    });
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return entries;
}

/** How many entries a conversation holds and when the newest was posted. */
export function commentCounts(entries) {
  const commentedAt = entries.reduce((max, e) => (max === null || e.at > max ? e.at : max), null);
  return { comments: entries.length, commentedAt };
}

/** An open or draft pull request whose comments were last counted for another updatedAt. */
export const needsCount = (pr) => !isSettled(pr) && pr.commentsFor !== pr.updatedAt;

/** `prs` with `number`'s comment counts, taken while it stood at `updatedAt`. */
export function withCounts(prs, number, entries, updatedAt) {
  return prs.map((p) => (p.number === number ? { ...p, ...commentCounts(entries), commentsFor: updatedAt } : p));
}

/** A file of `gh api repos/o/r/pulls/n/files`: its path, where it came from, its status and lines. */
export function decodeFiles(items) {
  return objects(items).map((f) => ({
    path: str(f.filename),
    from: strOrNull(f.previous_filename),
    status: str(f.status) || "modified",
    additions: numOrNull(f.additions) ?? 0,
    deletions: numOrNull(f.deletions) ?? 0,
  }));
}

// ---- the stored worktree --------------------------------------------------------------------

/** The file a worktree's pull requests are kept in: its folder's name and a hash of its path. */
export function storeName(root) {
  const p = normPath(root);
  let h = 0x811c9dc5;
  for (let i = 0; i < p.length; i++) {
    h ^= p.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const base = p.split("/").pop().replace(/[^\w.-]/g, "_").slice(0, 60) || "root";
  return `${base}-${h.toString(16).padStart(8, "0")}.json`;
}

/** A stored worktree, from its file's text; an empty one for none or garbage. */
export function parseStore(text) {
  let v = null;
  try {
    v = text ? JSON.parse(text) : null;
  } catch {}
  const o = isObj(v) ? v : {};
  return {
    root: str(o.root),
    repo: str(o.repo),
    branches: Array.isArray(o.branches) ? o.branches.filter((b) => typeof b === "string") : [],
    prs: objects(o.prs).filter((p) => typeof p.number === "number" && typeof p.url === "string"),
    seen: isObj(o.seen) ? o.seen : {},
    checkedAt: strOrNull(o.checkedAt),
    settledAt: strOrNull(o.settledAt),
    error: strOrNull(o.error),
    claim: strOrNull(o.claim),
  };
}

export const storeText = (store) => `${JSON.stringify(store, null, 2)}\n`;

const age = (iso, now) => (iso ? now - Date.parse(iso) : Number.POSITIVE_INFINITY);

/** Checked within `ms`: another copy's check is adopted rather than repeated. */
export const isFresh = (store, now, ms) => age(store.checkedAt, now) < ms;

/** Another copy started a check within `ms` and has not finished it. */
export const isClaimed = (store, now, ms) => age(store.claim, now) < ms;

/** Merged and closed pull requests are read again: never read yet, or not for `ms`. */
export const isDue = (store, now, ms) => age(store.settledAt, now) >= ms;

/**
 * The stored worktree after a check (`r`): the branches it has had, its fresh pull requests (on
 * its branches, then those its sessions created) over the stored ones, which stay when their
 * branch moved on. A failed check (`r.error`) changes no pull request and keeps its message.
 */
export function settle(store, r) {
  return {
    ...store,
    root: r.root,
    repo: r.repo || store.repo,
    branches: appendNew(store.branches, r.branches),
    prs: pullRequestList(r.error ? [] : [...r.onBranch, ...r.linked], store.prs),
    checkedAt: r.checkedAt,
    settledAt: r.due && !r.error ? r.checkedAt : store.settledAt,
    error: r.error,
    claim: null,
  };
}

// ---- the list (que: pr-list.ts, format.ts) ----------------------------------------------------

export const isActive = (pr) => pr.state === "open" || pr.state === "draft";
const newestFirst = (a, b) => b.number - a.number;

/** Open and draft first, newest first; then merged and closed, newest first. */
export function orderPrs(prs) {
  return { active: prs.filter(isActive).sort(newestFirst), settled: prs.filter((pr) => !isActive(pr)).sort(newestFirst) };
}

/** The open and draft ones, and those of them failing their checks. */
export function prCounts(prs) {
  const active = prs.filter(isActive);
  return { open: active.length, failing: active.filter((pr) => pr.checks === "failing").length };
}

/** What a pull request merges into: `#n` when its base is another of these pull requests' head (a stack), else the branch. */
export function baseLabel(pr, prs) {
  const under = prs
    .filter((p) => p.number !== pr.number && pr.base !== "" && p.head === pr.base)
    .sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || newestFirst(a, b))[0];
  return under ? `#${under.number}` : pr.base;
}

/** Whether a pull request came from another worktree: its head is no branch this one checked out. */
export const fromSubagent = (pr, branches) => pr.head !== "" && !branches.includes(pr.head);

/** Failing, then running, then skipped runs; the passing ones apart, folded into one line. */
export function checkGroups(runs) {
  const of = (state) => runs.filter((c) => c.state === state);
  return { listed: [...of("failing"), ...of("pending"), ...of("skipped")], passing: of("passing") };
}

/** `1 failing · 2 running · 6 passing`, zeros left out. */
export function checksCount(runs) {
  const n = (state) => runs.filter((c) => c.state === state).length;
  const words = [
    ...(n("pending") > 0 ? [`${n("pending")} running`] : []),
    ...(n("passing") > 0 ? [`${n("passing")} passing`] : []),
    ...(n("skipped") > 0 ? [`${n("skipped")} skipped`] : []),
  ];
  return { failing: n("failing"), words };
}

/** A check's tone. */
export const CHECK_TONE = { passing: "good", failing: "bad", pending: "busy", skipped: "muted" };

/** A pull request's dot: a hollow ring for a draft, its checks' tone while open, muted once settled. */
export function prDot(pr) {
  if (pr.state === "draft") return "ring";
  if (pr.state !== "open") return "muted";
  return pr.checks === "none" ? "neutral" : CHECK_TONE[pr.checks];
}

/** The row's checks: `✗ <first failing> · 6/7`, else `running 4/7`, else `✓ 7/7`; skipped left out; null without runs. */
export function checksLine(pr) {
  const runs = (pr.checkRuns ?? []).filter((c) => c.state !== "skipped");
  if (runs.length === 0) return null;
  const passed = `${runs.filter((c) => c.state === "passing").length}/${runs.length}`;
  const failing = runs.find((c) => c.state === "failing");
  if (failing) return { tone: "bad", text: `✗ ${failing.name} · ${passed}` };
  if (runs.some((c) => c.state === "pending")) return { tone: "busy", text: `running ${passed}` };
  return { tone: "good", text: `✓ ${passed}` };
}

export const REVIEW_TEXT = {
  approved: "approved",
  changes_requested: "changes requested",
  review_required: "review required",
  commented: "commented",
  dismissed: "dismissed",
  pending: "pending",
};
const REVIEW_TONE = { approved: "good", changes_requested: "bad", commented: "neutral", dismissed: "muted", pending: "attention" };

/** One review in a conversation: its words and tone. */
export const reviewBadge = (state) => ({ label: REVIEW_TEXT[state], tone: REVIEW_TONE[state] });

/** Whether a pull request's conversation has entries newer than when it was last opened; never opened, any. */
export function hasNewComments(pr, seenAt) {
  if (!pr.commentedAt) return false;
  return seenAt === undefined || seenAt === null || pr.commentedAt > seenAt;
}

/** A changed file's glyph and tone (que: diff.ts GLYPH), from the REST status. */
export function fileGlyph(status) {
  if (status === "added") return { glyph: "A", tone: "good" };
  if (status === "removed") return { glyph: "D", tone: "bad" };
  if (status === "renamed" || status === "copied") return { glyph: "R", tone: "neutral" };
  return { glyph: "M", tone: "neutral" };
}

// ---- words and times (que: shared/format.ts) --------------------------------------------------

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `42s`, `5m`, `3h`, `2d` and `suffix`; `-` without a time. */
export function formatAge(iso, now, suffix = "") {
  if (!iso) return "-";
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s${suffix}`;
  if (s < 3600) return `${Math.floor(s / 60)}m${suffix}`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h${suffix}`;
  return `${Math.floor(s / 86_400)}d${suffix}`;
}

/** A check's run time: `42s`, `3m 05s`, `2h 07m`; empty when either end is unknown. */
export function formatSpan(from, to) {
  const start = from ? Date.parse(from) : Number.NaN;
  const end = to ? Date.parse(to) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  const s = Math.max(0, Math.round((end - start) / 1000));
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** The first line of what a program printed, for an error line. */
export const firstLine = (...texts) =>
  texts.map((t) => String(t ?? "").trim().split("\n")[0].trim()).find(Boolean) ?? "failed";
