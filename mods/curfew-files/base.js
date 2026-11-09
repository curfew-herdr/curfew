// que's base for a worktree's changes (src/daemon/diff.ts): origin's default branch when there is
// one, else the local default; files are compared from its merge base with HEAD to the working
// tree, untracked files included. Byte-identical in curfew-changes, curfew-bar, curfew-files and
// curfew-diff (a mod can't import another mod's files), so the Changes list, the strip's count,
// the tree's marks and a diff tab agree on one base and one set of files.

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.quotepath=off"];
export const STATUS = ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
// Untracked files whose lines are read (the rest are listed without them); files listed at most.
export const MAX_UNTRACKED = 60, MAX_FILES = 1000;

/** Where the comparison starts: a commit, or null with no HEAD yet (then the index is compared). */
export async function diffFrom(git) {
  const ok = async (ref) => (await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code === 0;
  if (!(await ok("HEAD"))) return null;
  const originHead = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const def = originHead.code === 0 ? originHead.stdout.trim().replace(/^origin\//, "") : null;
  for (const ref of def ? [`origin/${def}`, def] : ["origin/main", "origin/master", "main", "master"]) {
    if (!(await ok(ref))) continue;
    const mb = await git(["merge-base", ref, "HEAD"]);
    return mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : ref;
  }
  return "HEAD";
}

/** `git status` (STATUS) as untracked paths in order, conflicted paths, and the other uncommitted ones. */
export function readStatus(stdout) {
  const fresh = [], conflicts = new Set(), dirty = new Set();
  for (const entry of stdout.split("\0").filter(Boolean)) {
    const xy = entry.slice(0, 2), path = entry.slice(3);
    if (xy === "??") fresh.push(path);
    else {
      dirty.add(path);
      if (xy.includes("U") || xy === "AA" || xy === "DD") conflicts.add(path);
    }
  }
  return { fresh, conflicts, dirty };
}

/**
 * The files Changes lists, without their lines: path -> its mark, A, D or M against the base, U
 * conflicted, ? untracked. Three reads besides the base's: status, then `diff --name-status`.
 * `files` holds at most MAX_FILES of them, as the list does; `total` counts them all.
 */
export async function changedFiles(git) {
  const status = await git(STATUS);
  if (status.code !== 0) throw new Error(status.stderr.trim() || "git status failed");
  const { fresh, conflicts } = readStatus(status.stdout);
  const from = await diffFrom(git);
  const diff = await git(["diff", "--name-status", "-z", "--no-renames", ...(from ? [from] : ["--cached"])]);
  if (diff.code !== 0) throw new Error(diff.stderr.trim() || "git diff failed");
  const marks = new Map(), parts = diff.stdout.split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const letter = parts[i].charAt(0), path = parts[i + 1];
    if (letter) marks.set(path, conflicts.has(path) ? "U" : letter === "A" || letter === "D" ? letter : "M");
  }
  for (const path of fresh) if (!marks.has(path)) marks.set(path, "?");
  for (const path of conflicts) if (!marks.has(path)) marks.set(path, "U");
  return { files: new Map([...marks].slice(0, MAX_FILES)), total: marks.size };
}
