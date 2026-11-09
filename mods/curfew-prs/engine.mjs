// The working side of the pull request view: git and gh calls, the stored worktrees under
// <app home>/curfew/pr-store/, and <app home>/curfew/prs.jsonl. The rules themselves are in core.mjs. It runs on a `host`
// (exec, readTextFile, writeTextFile, mkdir, appHome, and optionally log: prs.jsonl's path): herdr's, in the panel (main.js), or node's,
// in check.mjs, which the review strip runs for its count and the tests run against a fake gh.
//
// One check of a worktree, as que's PrService ticks: its branch history (local git), then one
// `gh pr list --state all --limit 100` without checks for its repository, then `gh pr list --head
// <b>` with checks only for heads that hold an open or draft pull request (or one that just
// settled, or one a full page misses), then `gh pr view <n> -R owner/name` for each pull request
// its sessions created that is not on those branches (a settled one only every 5th tick). Then up
// to three conversations of open pull requests whose updatedAt moved, for their comment counts.
//
// Every copy that shows a count or the list may check; the stored file dedupes them: a check younger
// than FRESH is adopted, and a copy starting one writes a claim first (writeTextFile writes only
// over the text it read), so the others adopt it rather than repeat it.
import * as core from "./core.mjs";

/** Shared `{root, open, at, from}`: a copy saved a worktree's pull requests, so the others re-read it. */
export const SIGNAL = "curfew-prs";

/** A tick, gently: GitHub's own state is minutes old anyway. */
export const EVERY = 150_000;
const FRESH = 100_000;
const CLAIM = 90_000;
const SETTLED_EVERY = 5 * EVERY;
const PREFETCH = 3;

export const NO_GH = "gh is not installed or not on PATH";

/** A failure whose message is the line the panel shows. */
class Failure extends Error {}

export function makeEngine(host) {
  /** prs.jsonl: one line per pull request a Claude Code session created (a hook writes it). */
  const LOG = () => host.log?.() ?? `${host.appHome()}/curfew/prs.jsonl`;
  const STORE_DIR = () => `${host.appHome()}/curfew/pr-store`;
  const storePath = (root) => `${STORE_DIR()}/${core.storeName(root)}`;

  const git = (args, cwd, on) =>
    host.exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], { cwd, on, timeout: 10_000 });

  /** Runs gh and parses what it prints; fails with gh's first stderr line. */
  async function gh(args, cwd, on, parse = JSON.parse) {
    let r;
    try {
      r = await host.exec("gh", args, { cwd, on, timeout: 30_000 });
    } catch (e) {
      throw new Failure(/time/i.test(String(e)) ? `gh timed out: gh ${args.slice(0, 2).join(" ")}` : NO_GH);
    }
    if (r.code === 127) throw new Failure(NO_GH);
    if (r.code !== 0) throw new Failure(core.firstLine(r.stderr, r.stdout, `gh exited ${r.code}`));
    try {
      return parse(r.stdout);
    } catch {
      throw new Failure("gh printed output that is not JSON");
    }
  }

  /**
   * The worktree a folder is in and what it has had, all local git: its root, current branch, HEAD
   * reflog's branches, the repository's other worktrees, origin and default branch. Null when the
   * folder is in no git repository.
   */
  async function locate(cwd, on) {
    const top = await git(["rev-parse", "--show-toplevel"], cwd, on).catch(() => null);
    if (!top || top.code !== 0) return null;
    const root = top.stdout.trim();
    const [head, reflog, list, origin, def] = await Promise.all([
      git(["rev-parse", "--abbrev-ref", "HEAD"], root, on),
      git(["reflog", "show", "-n", "5000", "--format=%gs", "HEAD"], root, on),
      git(["worktree", "list", "--porcelain"], root, on),
      git(["remote", "get-url", "origin"], root, on),
      git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root, on),
    ]);
    return {
      root,
      on: on ?? null,
      branch: head.code === 0 ? head.stdout.trim() : "",
      history: reflog.code === 0 ? core.reflogBranches(reflog.stdout) : [],
      others: core.worktreeRoots(list.stdout).filter((r) => core.normPath(r) !== core.normPath(root)),
      origin: origin.code === 0 ? core.githubRepo(origin.stdout) : null,
      defaults: def.code === 0 && def.stdout.trim() ? [def.stdout.trim().replace(/^origin\//, "")] : ["main", "master"],
    };
  }

  /** The stored worktree, read now. */
  async function load(root) {
    return core.parseStore(await host.readTextFile(storePath(root)));
  }

  /** Changes the stored worktree over whatever another copy wrote meanwhile; the result. */
  async function save(root, change) {
    const path = storePath(root);
    await host.mkdir(STORE_DIR()).catch(() => {});
    for (let i = 0; i < 5; i++) {
      const text = await host.readTextFile(path);
      const next = change(core.parseStore(text));
      try {
        await host.writeTextFile(path, core.storeText(next), text);
        return next;
      } catch {}
    }
    throw new Failure("could not save the pull requests");
  }

  /**
   * Checks the worktree `where` ({cwd, on}) is in: `{here, store, ran, threads}`, `here` null outside
   * a git repository. Unless `force`, a fresh or claimed check is adopted (`ran` false). A check that
   * ran also counts comments (`threads`: the conversations it read).
   */
  async function check(where, { force = false } = {}) {
    const here = await locate(where.cwd, where.on);
    if (!here) return { here: null, store: null, ran: false, threads: [] };
    const path = storePath(here.root);
    await host.mkdir(STORE_DIR()).catch(() => {});
    const text = await host.readTextFile(path);
    const store = core.parseStore(text);
    const now = Date.now();
    if (!force && (core.isFresh(store, now, FRESH) || core.isClaimed(store, now, CLAIM))) return { here, store, ran: false, threads: [] };
    try {
      await host.writeTextFile(path, core.storeText({ ...store, root: here.root, claim: new Date(now).toISOString() }), text);
    } catch {
      // Another copy wrote first: its check is the one running.
      if (!force) return { here, store: await load(here.root), ran: false, threads: [] };
    }
    let result;
    try {
      result = await discover(here, store, now);
    } catch (e) {
      result = { root: here.root, branches: [], onBranch: [], linked: [], checkedAt: new Date(now).toISOString(), due: false, error: String(e?.message ?? e), repo: "" };
    }
    const saved = await save(here.root, (latest) => core.settle(latest, result));
    const counted = await countComments(here, saved).catch(() => ({ store: saved, threads: [] }));
    return { here, store: counted.store, ran: true, threads: counted.threads };
  }

  /** One check's findings (see core.settle). */
  async function discover(here, store, now) {
    const checkedAt = new Date(now).toISOString();
    const due = core.isDue(store, now, SETTLED_EVERY);
    const branches = core.appendNew(store.branches, [...here.history, ...(here.branch && here.branch !== "HEAD" ? [here.branch] : [])]);
    const heads = core.headsOf(branches, here.branch, here.defaults);
    const r = { root: here.root, branches, onBranch: [], linked: [], checkedAt, due, error: null, repo: store.repo };
    const { root: cwd, on } = here;
    try {
      let listing = null;
      if (heads.length) {
        try {
          listing = core.groupByHead(await gh(["pr", "list", "--state", "all", "--limit", String(core.LIST_LIMIT), "--json", core.LIST_FIELDS], cwd, on));
        } catch (e) {
          if (e.message === NO_GH) throw e;
          // As que does: the heads are asked one by one instead.
        }
      }
      const canonical = listing ? core.reposOf([...listing.byBranch.values()].flat())[0] : null;
      if (canonical) r.repo = core.repoName(canonical);
      const { settled, ask } = core.planHeads(heads, listing, store.prs, due);
      const asked = await Promise.all(
        ask.map((head) => gh(["pr", "list", "--head", head, "--state", "all", "--limit", String(core.PR_LIST_CAP), "--json", core.FIELDS], cwd, on)),
      );
      r.onBranch = [...settled, ...asked.flatMap(core.decodePullRequests)].map((p) => core.parsePullRequest(p, checkedAt, store.prs));

      // The pull requests its sessions created, wherever their branch is (a stack, a subagent's).
      const text = on ? null : await host.readTextFile(LOG()).catch(() => null);
      const [owner, name] = r.repo.split("/");
      const repos = [here.origin, owner && name ? { owner, name } : null].filter(Boolean);
      const { lookUp, reuse } = core.linkedPlan(core.sessionPrs(text, here.root, here.others, repos), r.onBranch, store.prs, due);
      const looked = await Promise.all(
        lookUp.map(async (e) => {
          try {
            const p = core.decodePullRequest(await gh(["pr", "view", String(e.number), "-R", core.repoName(e), "--json", core.FIELDS], cwd, on));
            return p ? core.parsePullRequest(p, checkedAt, store.prs) : null;
          } catch (err) {
            r.error ??= err.message;
            return store.prs.find((p) => p.number === e.number) ?? null;
          }
        }),
      );
      r.linked = [...reuse, ...looked.filter(Boolean)];
    } catch (e) {
      r.error = e instanceof Failure ? e.message : String(e?.message ?? e);
    }
    return r;
  }

  /** `owner/name` of a pull request, from its URL. */
  const repoOf = (pr) => {
    const u = core.prUrl(pr.url);
    return u ? core.repoName(u) : "";
  };

  /** A pull request's conversation, oldest first: two gh calls. */
  async function fetchThread(here, pr) {
    const repo = repoOf(pr);
    const [view, lines] = await Promise.all([
      gh(["pr", "view", String(pr.number), "-R", repo, "--json", "comments,reviews"], here.root, here.on),
      gh(["api", `repos/${repo}/pulls/${pr.number}/comments?per_page=100`, "--paginate"], here.root, here.on, core.pagedItems),
    ]);
    return core.parseThread(view, lines);
  }

  /** A pull request's changed files against its base: one gh call. */
  async function fetchFiles(here, pr) {
    const items = await gh(["api", `repos/${repoOf(pr)}/pulls/${pr.number}/files?per_page=100`, "--paginate"], here.root, here.on, core.pagedItems);
    return core.decodeFiles(items);
  }

  /**
   * Counts the comments of up to three open pull requests whose updatedAt moved since they were
   * counted (que prefetches them the same way); the stored worktree after, and the conversations read.
   */
  async function countComments(here, store) {
    const todo = store.prs.filter(core.needsCount).slice(0, PREFETCH);
    if (!todo.length) return { store, threads: [] };
    const threads = (await Promise.all(todo.map((pr) => fetchThread(here, pr).then((entries) => ({ pr, entries }), () => null)))).filter(Boolean);
    if (!threads.length) return { store, threads };
    const next = await save(here.root, (latest) =>
      threads.reduce((s, t) => ({ ...s, prs: core.withCounts(s.prs, t.pr.number, t.entries, t.pr.updatedAt) }), latest),
    );
    return { store: next, threads };
  }

  return { LOG, storePath, locate, load, save, check, fetchThread, fetchFiles };
}
