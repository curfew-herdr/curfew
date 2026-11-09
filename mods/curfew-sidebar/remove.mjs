// Remove project, que's way (main.js runs it, mods/curfew-project draws the dialog): the project's
// spaces close and their terminals end; when the dialog's checkbox asks for it, its worktrees under
// herdr's worktree root are deleted too, one at a time, then `git worktree prune` and each emptied
// <root>/<repo> folder goes. Branches, the main checkout and anything outside the root are never
// touched.
//
// Ported from que (https://github.com/queapp-org/que), Apache-2.0, by the same author (see NOTICE):
// the order is WorkspaceManager.removeProject's in src/daemon/workspaces.ts (terminals first, then
// each worktree removed by force and pruned, branches kept). Unlike que, deleting worktrees is
// opt-in, only those under the root are deleted, and each path is checked against git's own list
// again right before it goes. Reading `git worktree list --porcelain` and the uncommitted-changes
// check (`git status` without optional locks or fsmonitor) follow herdr's shipped worktree mod.
//
// Runs on a `host` { exec(cmd, args, { cwd, timeout }), hc(args) }: herdr's in the sidebar, node's
// in remove.test.mjs.

const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const parent = (path) => path.replace(/\/+$/, "").replace(/\/[^/]*$/, "");

async function run(host, command, args, timeout = 30_000) {
  try {
    const r = await host.exec(command, args, { timeout });
    return { ok: r.code === 0, code: r.code, out: r.stdout ?? "", err: r.stderr ?? "" };
  } catch (e) {
    return { ok: false, code: -1, out: "", err: String(e?.message ?? e) };
  }
}

// ---- git's worktrees ---------------------------------------------------------------------------

/**
 * `git worktree list --porcelain`, with or without -z, as [{ path, head, branch, bare, detached,
 * locked, prunable, main }]: `main` is the first entry (the main checkout, or a bare repository);
 * `branch` without refs/heads/; `locked` and `prunable` are git's reason ("" when it gives none),
 * null when not.
 */
export function parseWorktrees(text) {
  const s = String(text ?? "");
  const out = [];
  let entry = null;
  for (const line of s.includes("\0") ? s.split("\0") : s.split("\n")) {
    if (line === "") {
      entry = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      entry = { path: line.slice(9), head: null, branch: null, bare: false, detached: false, locked: null, prunable: null, main: out.length === 0 };
      out.push(entry);
      continue;
    }
    if (!entry) continue;
    const gap = line.indexOf(" ");
    const [label, value] = gap < 0 ? [line, ""] : [line.slice(0, gap), line.slice(gap + 1)];
    if (label === "HEAD") entry.head = value;
    else if (label === "branch") entry.branch = value.replace(/^refs\/heads\//, "");
    else if (label === "bare") entry.bare = true;
    else if (label === "detached") entry.detached = true;
    else if (label === "locked") entry.locked = value;
    else if (label === "prunable") entry.prunable = value;
  }
  return out;
}

/** The repository's worktrees as git lists them now (-z: any path, as it is); null when git can't. */
export async function listWorktrees(host, main) {
  const r = await run(host, "git", ["-C", main, "worktree", "list", "--porcelain", "-z"]);
  return r.ok ? parseWorktrees(r.out) : null;
}

/**
 * Whether `path` lies strictly inside `root`, both absolute: never the root itself, a sibling that
 * shares its prefix (`<root>-x`), or a path with an empty, `.` or `..` part in it.
 */
export function isInside(root, path) {
  const r = String(root ?? "").replace(/\/+$/, "");
  const p = String(path ?? "");
  const clean = (parts) => parts.every((part) => part !== "" && part !== "." && part !== "..");
  if (!r.startsWith("/") || !clean(r.slice(1).split("/")) || !p.startsWith(`${r}/`)) return false;
  const rest = p.slice(r.length + 1).replace(/\/+$/, "");
  return rest !== "" && clean(rest.split("/"));
}

/** Uncommitted changes, untracked files included: anything `git status --porcelain` prints. A status that fails counts as dirty. */
export async function isDirty(host, path) {
  const r = await run(host, "git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", path, "status", "--porcelain"]);
  return !r.ok || r.out.trim() !== "";
}

// ---- the plan: what the dialog shows -----------------------------------------------------------

/**
 * What removing a project would close and delete, for its dialog. `main` is the main checkout,
 * `root` herdr's worktree root, `open` the project's open spaces as [{ top, linked }] (git's top
 * folder for each, and whether it is a linked worktree). Answers
 * - worktrees: the linked worktrees under `root` that git lists (never the main checkout, never a
 *   prunable one), each { name, path, open (a space is in it), dirty };
 * - outside: how many linked worktrees with a space open in them lie outside `root`; their spaces
 *   close, the worktrees stay.
 */
export async function planRemoval(host, { main, root, open = [] }) {
  const tops = new Set(open.map((o) => o.top));
  const outside = new Set(open.filter((o) => o.linked && o.top && !isInside(root, o.top)).map((o) => o.top)).size;
  const listed = (await listWorktrees(host, main)) ?? [];
  const eligible = listed.filter((w) => !w.main && !w.bare && w.prunable === null && w.path !== main && isInside(root, w.path));
  const worktrees = await Promise.all(eligible.map(async (w) => ({ name: base(w.path), path: w.path, open: tops.has(w.path), dirty: await isDirty(host, w.path) })));
  return { worktrees, outside };
}

// ---- the terminals' processes ------------------------------------------------------------------

// pid -> when it started (`ps -o lstart`), for those of `pids` running now.
async function startTimes(host, pids) {
  const now = new Map();
  if (!pids.length) return now;
  const r = await run(host, "ps", ["-o", "pid=,lstart=", "-p", pids.join(",")], 10_000);
  for (const line of r.out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S.*)$/);
    if (m) now.set(Number(m[1]), m[2].replace(/\s+/g, " ").trim());
  }
  return now;
}

/**
 * The processes behind terminals on this computer, before they are closed: each terminal's own
 * pid and its foreground program's (`hc get`), with when each started, so that a pid the system
 * has handed to another program since is never taken for it. [{ pid, start }]
 */
export async function recordProcesses(host, addresses) {
  const pids = new Set();
  for (const address of addresses) {
    try {
      const r = await host.hc(["get", address, "--json"]);
      if (r.code !== 0) continue;
      const info = JSON.parse(r.stdout);
      for (const pid of [info?.pid, info?.foreground?.pid]) if (Number.isInteger(pid) && pid > 1) pids.add(pid);
    } catch {
      // gone already, or an answer that isn't JSON: nothing to wait for
    }
  }
  const now = await startTimes(host, [...pids]);
  return [...pids].filter((pid) => now.has(pid)).map((pid) => ({ pid, start: now.get(pid) }));
}

/** Those of `procs` still running: the same pid, started at the same time. */
export async function stillRunning(host, procs) {
  const now = await startTimes(host, procs.map((p) => p.pid));
  return procs.filter((p) => now.get(p.pid) === p.start);
}

/**
 * Waits for `procs` to end, looking every `every` ms for up to `limit` ms (`wait(ms)` sleeps), then
 * sends SIGKILL to exactly those still running: recorded pids with their start times, never a name
 * or a pattern. Answers the pids it killed.
 */
export async function stopProcesses(host, procs, { wait, limit = 5000, every = 250 }) {
  let left = procs.length ? await stillRunning(host, procs) : [];
  for (let waited = 0; left.length && waited < limit; waited += every) {
    await wait(every);
    left = await stillRunning(host, left);
  }
  if (!left.length) return [];
  await run(host, "kill", ["-KILL", ...left.map((p) => String(p.pid))], 10_000);
  return left.map((p) => p.pid);
}

// ---- deleting ----------------------------------------------------------------------------------

/**
 * Deletes one linked worktree of the repository at `main`, once it is checked again: under `root`,
 * not the main checkout, listed by git now as one of its worktrees (not bare, holding no other
 * worktree). Then `git worktree remove --force`, which takes uncommitted changes and submodules
 * with it (the dialog said so) but refuses a locked worktree. Answers "" when it is gone, else why
 * not. A worktree git marks prunable (its folder deleted by hand) is gone already: prune tidies it.
 */
export async function deleteWorktree(host, { main, root, path }) {
  if (!isInside(root, path)) return `${path} is not under ${root}`;
  if (path === main) return `${path} is the main checkout`;
  if (isInside(path, main)) return `${path} holds the main checkout`;
  const listed = await listWorktrees(host, main);
  if (!listed) return "git worktree list failed";
  const w = listed.find((x) => x.path === path);
  if (!w || w.main || w.bare) return `${path} is not a worktree of ${main}`;
  if (listed.some((x) => x !== w && isInside(path, x.path))) return `${path} holds another worktree`;
  if (w.prunable !== null) return "";
  const r = await run(host, "git", ["-C", main, "worktree", "remove", "--force", path], 600_000);
  return r.ok ? "" : r.err.trim() || `git worktree remove exited with ${r.code}`;
}

/** `git worktree prune`, then the folder each deleted worktree was in, when it is empty and under `root` (never `root`). Best effort. */
export async function tidy(host, { main, root, deleted }) {
  await run(host, "git", ["-C", main, "worktree", "prune"]);
  for (const dir of new Set(deleted.map(parent))) {
    if (isInside(root, dir)) await run(host, "rmdir", [dir], 10_000); // fails harmlessly when not empty
  }
}

/**
 * Deletes the worktrees at `paths` one at a time (deleteWorktree), then tidies up when any were
 * asked for. onStart(path) before each, onEnd(path, error) after ("" when it went). Answers the
 * paths deleted.
 */
export async function deleteWorktrees(host, { main, root, paths, onStart = () => {}, onEnd = () => {} }) {
  const deleted = [];
  for (const path of paths) {
    onStart(path);
    const error = await deleteWorktree(host, { main, root, path });
    if (!error) deleted.push(path);
    onEnd(path, error);
  }
  if (paths.length) await tidy(host, { main, root, deleted });
  return deleted;
}
