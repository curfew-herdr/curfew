// A new workspace, que's way, for the project + menu's Terminal and agents (main.js runs it): a
// generated `adjective-adjective-noun` name for the branch and the folder, `git fetch origin`, a
// worktree from origin/<default branch> (else the local one), the gitignored files that
// .worktreeinclude and que.toml's worktree_include list copied in from the main checkout, and
// que.toml's setup ahead of the agent in the new terminal.
//
// Ported from que (https://github.com/queapp-org/que), Apache-2.0, by the same author (see NOTICE):
// the word lists and the drawing are src/shared/names.ts; the steps are WorkspaceManager.prepare in
// src/daemon/workspaces.ts (newWorkspace's clash check, fetchOrigin, detectDefaultBranch,
// addWorktree, copyIncludes); the que.toml rules are src/shared/config.ts's, read here by a small
// reader for the three keys this uses. Unlike que, a step that fails after the worktree was added
// takes the worktree and its branch away again, and only gitignored files are copied.
//
// Runs on a `host` { exec(cmd, args, { cwd, timeout }), readTextFile(path), home(), log?(msg) }:
// herdr's in the sidebar, node's in workspace.test.mjs.

/** herdr's worktree root (the shipped worktree mod's ROOT), so its Open worktree… lists these too. */
export const worktreeRoot = (home) => `${home}/.herdr/worktrees`;
const base = (path) => path.replace(/\/+$/, "").split("/").pop();

/** A step that failed; its message is the row's error line. */
export class Failure extends Error {}

// ---- names: que's src/shared/names.ts ----------------------------------------------------------

export const ADJECTIVES = [
  "amber", "bold", "brave", "breezy", "bright", "brisk", "calm", "cheery", "clever", "cosy",
  "crisp", "curly", "dapper", "eager", "early", "fancy", "fluffy", "frosty", "gentle", "giddy",
  "glad", "golden", "grand", "happy", "hardy", "hazel", "honest", "humble", "jolly", "keen",
  "kind", "lively", "lucky", "mellow", "merry", "mighty", "misty", "modest", "nimble", "noble",
  "patient", "peppy", "plucky", "polite", "proud", "quick", "quiet", "rapid", "rosy", "rustic",
  "shiny", "silver", "sleepy", "smooth", "snappy", "snowy", "soft", "sound", "spry", "steady",
  "sturdy", "sunny", "swift", "tidy", "tiny", "trusty", "tender", "upbeat", "vivid", "warm",
  "wavy", "wise", "witty", "woolly", "young", "zesty", "zippy", "velvet", "mossy", "dusky",
];

export const NOUNS = [
  "badger", "beacon", "beaver", "bison", "bottle", "bucket", "button", "candle", "canoe", "cactus",
  "comet", "compass", "cookie", "crane", "cricket", "dolphin", "falcon", "fern", "ferret", "finch",
  "gecko", "goose", "hammer", "harbor", "hedgehog", "heron", "kettle", "kitten", "koala", "ladder",
  "lantern", "lemon", "lizard", "llama", "magnet", "maple", "marble", "meadow", "mitten", "mole",
  "moose", "muffin", "narwhal", "otter", "owl", "panda", "parrot", "pebble", "pelican", "penguin",
  "pepper", "pickle", "pigeon", "pillow", "pine", "puffin", "pumpkin", "rabbit", "raccoon", "radish",
  "robin", "saddle", "salmon", "shovel", "sparrow", "spoon", "squirrel", "teapot", "thimble", "tiger",
  "toaster", "tortoise", "trumpet", "tulip", "turnip", "umbrella", "walnut", "walrus", "whistle", "wombat",
];

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** `adjective-adjective-noun`, two different adjectives; `rng` returns [0, 1). */
export function randomName(rng = Math.random) {
  const first = pick(ADJECTIVES, rng);
  const second = pick(ADJECTIVES.filter((a) => a !== first), rng);
  return `${first}-${second}-${pick(NOUNS, rng)}`;
}

// ---- que.toml and .worktreeinclude: que's src/shared/config.ts ---------------------------------

const KEYS = new Set(["setup", "default_branch", "worktree_include"]);
const TABLE = { table: true }; // an inline table's value: skipped, never one of KEYS
const SCALAR = /[A-Za-z0-9_:.+-]/; // numbers, booleans, dates and times

/**
 * The root keys que.toml's new worktrees use: `setup`, `default_branch` and `worktree_include`.
 * Everything else is read only far enough to be skipped (tables, inline tables, multi-line strings
 * and arrays). Answers { ok: true, config: { setup?, defaultBranch?, worktreeInclude } }, or
 * { ok: false, error } ("line 3: unterminated string") for a file that isn't TOML or gives one of
 * the three keys the wrong type: the caller reports that and goes on as if there were no file.
 */
export function parseQueToml(text) {
  const s = String(text ?? "").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  let i = 0;
  let line = 1;
  const fail = (what) => {
    throw new SyntaxError(`line ${line}: ${what}`);
  };
  const at = (t) => s.startsWith(t, i);
  const blank = () => {
    while (s[i] === " " || s[i] === "\t") i++;
  };
  const comment = () => {
    if (s[i] === "#") while (i < s.length && s[i] !== "\n") i++;
  };
  const newline = () => (s[i] === "\n" ? (i++, line++, true) : false);
  const gap = () => {
    for (;;) {
      blank();
      comment();
      if (!newline()) return;
    }
  };
  const unexpected = () => fail(i >= s.length || s[i] === "\n" ? "unexpected end of line" : `unexpected ${JSON.stringify(s[i])}`);
  const lineEnd = () => {
    blank();
    comment();
    if (i < s.length && !newline()) unexpected();
  };

  function escape() {
    const c = s[i + 1];
    const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", e: "\x1b", '"': '"', "\\": "\\" }[c];
    if (simple !== undefined) {
      i += 2;
      return simple;
    }
    const size = { x: 2, u: 4, U: 8 }[c];
    const hex = size ? s.slice(i + 2, i + 2 + size) : "";
    const code = size && /^[0-9A-Fa-f]+$/.test(hex) && hex.length === size ? parseInt(hex, 16) : -1;
    if (code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail(`invalid escape \\${c ?? ""}`);
    i += 2 + size;
    return String.fromCodePoint(code);
  }

  function basic() {
    i++;
    let out = "";
    for (;;) {
      const c = s[i];
      if (c === undefined || c === "\n") fail("unterminated string");
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") out += escape();
      else {
        out += c;
        i++;
      }
    }
  }

  function literal() {
    const end = s.indexOf("'", i + 1);
    const nl = s.indexOf("\n", i + 1);
    if (end < 0 || (nl >= 0 && nl < end)) fail("unterminated string");
    const out = s.slice(i + 1, end);
    i = end + 1;
    return out;
  }

  // """…""" (escapes, a line-ending backslash) or '''…''': a newline right after the opening goes,
  // and up to two quotes before the closing three belong to the string.
  function multi(quote, escapes) {
    i += 3;
    newline();
    let out = "";
    for (;;) {
      if (i >= s.length) fail("unterminated string");
      if (at(quote.repeat(3))) {
        let n = 3;
        while (n < 5 && s[i + n] === quote) n++;
        i += n;
        return out + quote.repeat(n - 3);
      }
      if (escapes && s[i] === "\\") {
        let j = i + 1;
        while (s[j] === " " || s[j] === "\t") j++;
        if (s[j] === "\n") {
          i = j;
          while (s[i] === " " || s[i] === "\t" || s[i] === "\n") if (s[i++] === "\n") line++;
        } else out += escape();
        continue;
      }
      if (s[i] === "\n") line++;
      out += s[i++];
    }
  }

  function keyPart() {
    if (at('"""') || at("'''")) fail("a key cannot be a multi-line string");
    if (s[i] === '"') return basic();
    if (s[i] === "'") return literal();
    const start = i;
    while (i < s.length && /[A-Za-z0-9_-]/.test(s[i])) i++;
    if (i === start) unexpected();
    return s.slice(start, i);
  }

  function key() {
    const parts = [];
    for (;;) {
      blank();
      parts.push(keyPart());
      blank();
      if (s[i] !== ".") return parts;
      i++;
    }
  }

  function array() {
    i++;
    const out = [];
    for (;;) {
      gap();
      if (s[i] === "]") {
        i++;
        return out;
      }
      if (i >= s.length) fail("unterminated array");
      out.push(value());
      gap();
      if (s[i] === ",") i++;
      else if (s[i] === "]") {
        i++;
        return out;
      } else fail(i >= s.length ? "unterminated array" : "expected , or ] in an array");
    }
  }

  function table() {
    i++;
    gap();
    if (s[i] === "}") {
      i++;
      return TABLE;
    }
    for (;;) {
      key();
      if (s[i] !== "=") fail("expected = in an inline table");
      i++;
      blank();
      value();
      gap();
      if (s[i] === "}") {
        i++;
        return TABLE;
      }
      if (s[i] !== ",") fail(i >= s.length ? "unterminated inline table" : "expected , or } in an inline table");
      i++;
      gap();
      if (s[i] === "}") {
        i++;
        return TABLE;
      }
    }
  }

  function scalar() {
    const start = i;
    while (i < s.length && SCALAR.test(s[i])) i++;
    // A date and a time may be apart by one space: 1979-05-27 07:32:00Z.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(start, i)) && /^ \d{2}:/.test(s.slice(i, i + 4))) {
      i++;
      while (i < s.length && SCALAR.test(s[i])) i++;
    }
    if (i === start) unexpected();
    return { scalar: s.slice(start, i) };
  }

  function value() {
    if (at('"""')) return multi('"', true);
    if (at("'''")) return multi("'", false);
    if (s[i] === '"') return basic();
    if (s[i] === "'") return literal();
    if (s[i] === "[") return array();
    if (s[i] === "{") return table();
    return scalar();
  }

  const found = new Map();
  const errors = [];
  let root = true; // before the first [table]
  try {
    for (;;) {
      gap();
      if (i >= s.length) break;
      if (s[i] === "[") {
        const double = at("[[");
        i += double ? 2 : 1;
        key();
        if (!at(double ? "]]" : "]")) fail("expected ] after a table name");
        i += double ? 2 : 1;
        root = false;
        lineEnd();
        continue;
      }
      const from = line;
      const k = key();
      if (s[i] !== "=") fail("expected = after a key");
      i++;
      blank();
      const v = value();
      lineEnd();
      if (!root || k.length !== 1 || !KEYS.has(k[0])) continue;
      if (found.has(k[0])) errors.push(`line ${from}: ${k[0]} is set twice`);
      found.set(k[0], { v, line: from });
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const config = { worktreeInclude: [] };
  for (const [name, field] of [["setup", "setup"], ["default_branch", "defaultBranch"]]) {
    const f = found.get(name);
    if (!f) continue;
    if (typeof f.v === "string") config[field] = f.v;
    else errors.push(`line ${f.line}: ${name} must be a string`);
  }
  const list = found.get("worktree_include");
  if (list) {
    if (Array.isArray(list.v) && list.v.every((x) => typeof x === "string")) config.worktreeInclude = list.v;
    else errors.push(`line ${list.line}: worktree_include must be a list of strings`);
  }
  return errors.length ? { ok: false, error: errors.join("; ") } : { ok: true, config };
}

/** A .worktreeinclude file: one path per line, `#` comments, blanks skipped. */
export function parseWorktreeInclude(text) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * The repo's que.toml and .worktreeinclude, both optional: { setup, defaultBranch, include, warning }.
 * A que.toml that can't be used is ignored, with `warning` saying why.
 */
export async function readRepoConfig(host, repo) {
  const read = async (name) => {
    try {
      return await host.readTextFile(`${repo}/${name}`);
    } catch (e) {
      host.log?.(`could not read ${repo}/${name}: ${e?.message ?? e}`);
      return null;
    }
  };
  const toml = await read("que.toml");
  const listed = await read(".worktreeinclude");
  let config = { worktreeInclude: [] };
  let warning = null;
  if (toml != null) {
    const r = parseQueToml(toml);
    if (r.ok) config = r.config;
    else warning = `que.toml ignored: ${r.error}`;
  }
  const include = [];
  for (const p of [...config.worktreeInclude, ...parseWorktreeInclude(listed)]) if (!include.includes(p)) include.push(p);
  return { setup: config.setup || null, defaultBranch: config.defaultBranch || null, include, warning };
}

// ---- the steps: que's src/daemon/workspaces.ts -------------------------------------------------

async function git(host, cwd, args, timeout = 30_000) {
  try {
    const r = await host.exec("git", args, { cwd, timeout });
    return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
  } catch (e) {
    return { ok: false, out: "", err: String(e?.message ?? e) };
  }
}

const refExists = async (host, repo, ref) => (await git(host, repo, ["show-ref", "--verify", "--quiet", ref])).ok;

async function exists(host, path) {
  try {
    return (await host.exec("sh", ["-c", '[ -e "$1" ] || [ -L "$1" ]', "sh", path], { timeout: 10_000 })).code === 0;
  } catch {
    return false;
  }
}

/** git's reason, short: its last fatal: or error: line, else its last line. */
function reason(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = [...lines].reverse().find((l) => /^(fatal|error):/.test(l)) ?? lines[lines.length - 1] ?? "no reason given";
  return last.replace(/^(fatal|error):\s*/, "");
}

/**
 * The first free name: `first` (shown on the row at once), then fresh draws, up to `tries` in all,
 * until neither the branch nor the folder <root>/<name> exists. `taken` holds the names other
 * workspaces being made have drawn; the one found joins it.
 */
export async function drawName(host, { repo, root, taken = new Set(), first, rng = Math.random, tries = 50 }) {
  for (let n = 0; n < tries; n++) {
    const name = n === 0 && first ? first : randomName(rng);
    if (taken.has(name)) continue;
    taken.add(name);
    const path = `${root}/${name}`;
    if (!(await refExists(host, repo, `refs/heads/${name}`)) && !(await exists(host, path))) return { name, path };
    taken.delete(name);
  }
  throw new Failure(`no free name after ${tries} tries`);
}

export async function hasOrigin(host, repo) {
  const r = await git(host, repo, ["remote"]);
  return r.ok && r.out.split("\n").includes("origin");
}

/** `git fetch origin`; a failure is logged and the work goes on from what is known. */
export async function fetchOrigin(host, repo, log = () => {}) {
  let r;
  try {
    // No password prompt can be answered here (que runs it with the same variable).
    r = await host.exec("env", ["GIT_TERMINAL_PROMPT=0", "git", "fetch", "origin"], { cwd: repo, timeout: 30_000 });
  } catch (e) {
    r = { code: -1, stderr: String(e?.message ?? e) };
  }
  if (r.code === 0) return true;
  log(`git fetch origin failed (continuing): ${reason(r.stderr)}`);
  return false;
}

/** que.toml's default_branch, else origin's HEAD, else main or master (here or on origin), else the checked-out branch, else main. */
export async function defaultBranch(host, repo, configured) {
  if (configured) return configured;
  const head = await git(host, repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok && head.out.startsWith("origin/")) return head.out.slice("origin/".length);
  for (const b of ["main", "master"]) {
    if ((await refExists(host, repo, `refs/heads/${b}`)) || (await refExists(host, repo, `refs/remotes/origin/${b}`))) return b;
  }
  const current = await git(host, repo, ["symbolic-ref", "--short", "HEAD"]);
  return (current.ok && current.out) || "main";
}

/** origin/<default> when that ref exists, else <default>; a base that names no commit fails. */
export async function baseRef(host, repo, branch) {
  const from = (await refExists(host, repo, `refs/remotes/origin/${branch}`)) ? `origin/${branch}` : branch;
  if (!(await git(host, repo, ["rev-parse", "--verify", "--quiet", `${from}^{commit}`])).ok) throw new Failure(`unknown base ref ${from}`);
  return from;
}

/** The branch <name> from <from>, not tracking it, checked out at <path> (git makes its folders). */
export async function addWorktree(host, repo, name, path, from) {
  const r = await git(host, repo, ["worktree", "add", "--no-track", "-b", name, path, from], 600_000);
  if (!r.ok) throw new Failure(`git worktree add failed: ${reason(r.err)}`);
}

/** A worktree_include entry as a path inside the repo ("a/b"), or null when it would leave it. */
export function safeInclude(entry) {
  const parts = [];
  for (const seg of String(entry).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(seg);
  }
  const rel = parts.join("/");
  if (String(entry).startsWith("/") || !rel || rel === ".." || rel.startsWith("../")) return null;
  return rel;
}

// Copies $1/$3 to $2/$3: 10 when it isn't there, 11 when git doesn't ignore it (a tracked file is
// already in the worktree, at its base's version), 12 when a symlinked folder on the way leads out
// of the repo or the worktree. Symlinks are copied as symlinks, never followed.
const COPY = `src=$1/$3 dst=$2/$3
[ -e "$src" ] || [ -L "$src" ] || exit 10
top=$(cd -P "$1" && pwd -P) && from=$(cd -P "$(dirname "$src")" && pwd -P) || exit 12
case "$from/" in "$top"/*) ;; *) exit 12 ;; esac
git -C "$1" check-ignore -q -- "$3" || exit 11
mkdir -p -- "$(dirname "$dst")" || exit 13
wt=$(cd -P "$2" && pwd -P) && to=$(cd -P "$(dirname "$dst")" && pwd -P) || exit 12
case "$to/" in "$wt"/*) ;; *) exit 12 ;; esac
if [ -d "$src" ] && [ ! -L "$src" ]; then mkdir -p -- "$dst" && exec cp -R -P -- "$src/." "$dst"; fi
exec cp -R -P -- "$src" "$dst"`;

/** que's copyIncludes: each listed gitignored file or folder of the main checkout, when it is there. */
export async function copyIncludes(host, repo, path, entries, log = () => {}) {
  for (const entry of entries) {
    const rel = safeInclude(entry);
    if (!rel) {
      log(`worktree_include: skipping unsafe path ${entry}`);
      continue;
    }
    let r;
    try {
      r = await host.exec("sh", ["-c", COPY, "sh", repo, path, rel], { timeout: 600_000 });
    } catch (e) {
      throw new Failure(`copying files failed: ${rel}: ${e?.message ?? e}`);
    }
    if (r.code === 0 || r.code === 10) continue;
    if (r.code === 11) log(`worktree_include: ${rel} is not gitignored, not copied`);
    else if (r.code === 12) log(`worktree_include: ${rel} leads outside the repository, not copied`);
    else throw new Failure(`copying files failed: ${rel}: ${reason(r.stderr) || `exit ${r.code}`}`);
  }
}

/** Takes away what addWorktree made: the worktree (and its folder), then the branch. */
export async function rollback(host, repo, name, path, log = () => {}) {
  await git(host, repo, ["worktree", "remove", "--force", path], 600_000); // fails harmlessly when there is none
  await git(host, repo, ["worktree", "prune"]);
  if (await refExists(host, repo, `refs/heads/${name}`)) {
    const r = await git(host, repo, ["branch", "-D", name]);
    if (!r.ok) log(`could not delete branch ${name}: ${reason(r.err)}`);
  }
  if (await exists(host, path)) log(`left ${path} in place: it is not a worktree git knows`);
}

// que's setup runs to its end before Claude starts, which starts even after a failed setup. Here
// the new terminal runs it first, in a shell of its own (an `exit` in it ends only that), says when
// it failed, then becomes the agent: `sh -c SETUP sh <setup> <agent argv…>`. With no agent the
// script ends, and herdr's launcher leaves the person's login shell in the worktree.
const SETUP = `printf '$ %s\\n' "$1"
sh -c "$1" || printf '\\nsetup exited with code %s\\n\\n' "$?"
shift
if [ "$#" -gt 0 ]; then exec "$@"; fi`;

/** The new terminal's argv: the agent's (null: a shell) with que.toml's setup run ahead of it. */
export function setupArgv(setup, argv) {
  if (!setup) return argv && argv.length ? argv : null;
  return ["sh", "-c", SETUP, "sh", setup, ...(argv ?? [])];
}

/**
 * Makes a workspace for the main checkout `repo`, que's way, and answers { name, path, from, argv }
 * for the space to open with: `argv` is `agent` (null: a shell) behind que.toml's setup. Calls
 * onName(name, path) once the name is free, onStep("fetching" | "adding worktree" | "copying
 * files") as it goes, onWarning(text) for a que.toml it ignores. Throws a Failure (anything else
 * is unexpected) with nothing left behind: a worktree or branch it made is taken away again.
 */
export async function prepareWorkspace(host, { repo, agent = null }, opts = {}) {
  const { first, rng, taken = new Set(), onName = () => {}, onStep = () => {}, onWarning = () => {} } = opts;
  const log = (m) => host.log?.(m);
  const config = await readRepoConfig(host, repo);
  if (config.warning) {
    log(config.warning);
    onWarning(config.warning);
  }
  const { name, path } = await drawName(host, { repo, root: `${worktreeRoot(host.home())}/${base(repo)}`, taken, first, rng });
  let made = false;
  try {
    onName(name, path);
    if (await hasOrigin(host, repo)) {
      onStep("fetching");
      await fetchOrigin(host, repo, log);
    }
    const from = await baseRef(host, repo, await defaultBranch(host, repo, config.defaultBranch));
    onStep("adding worktree");
    made = true;
    await addWorktree(host, repo, name, path, from);
    if (config.include.length) {
      onStep("copying files");
      await copyIncludes(host, repo, path, config.include, log);
    }
    return { name, path, from, argv: setupArgv(config.setup, agent) };
  } catch (e) {
    if (made) await rollback(host, repo, name, path, log);
    throw e;
  } finally {
    taken.delete(name); // its branch exists now, or it never will
  }
}
