// node --test ~/.config/herdr-app/mods/curfew-sidebar/workspace.test.mjs
// The new-workspace steps (workspace.mjs) on node's host, against throwaway git repositories (and a
// bare one as their origin) in a temp folder ($CURFEW_TEST_TMP, else the system's), with a temp
// home for ~/.herdr/worktrees and git's config: never the real home or a real repository.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as W from "./workspace.mjs";

let t; // this test's folders, environment and helpers

beforeEach(() => {
  const dir = realpathSync(mkdtempSync(join(process.env.CURFEW_TEST_TMP || tmpdir(), "curfew-workspace-")));
  const home = join(dir, "home");
  mkdirSync(home);
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  const logs = [];
  const host = {
    home: () => home,
    log: (m) => logs.push(m),
    readTextFile: (path) => fsp.readFile(path, "utf8").catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e))),
    exec: (command, args, { cwd, timeout = 30_000 } = {}) =>
      new Promise((resolve, reject) => {
        execFile(command, args, { cwd, timeout, env, encoding: "utf8", maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
          if (err && typeof err.code !== "number") reject(err);
          else resolve({ code: err ? err.code : 0, stdout, stderr });
        });
      }),
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const tryGit = (cwd, ...args) => {
    try {
      return git(cwd, ...args);
    } catch {
      return null;
    }
  };
  /** A repo with one commit on main, in <dir>/<name>. */
  const repo = (name = "shop") => {
    const r = join(dir, name);
    mkdirSync(r);
    git(r, "init", "-q", "-b", "main");
    writeFileSync(join(r, "README.md"), "hi\n");
    git(r, "add", ".");
    git(r, "commit", "-qm", "init");
    return r;
  };
  /** A bare origin with main, and a clone of it as <dir>/<name> (origin/HEAD set). */
  const cloned = (name = "shop", head = "main") => {
    const seed = join(dir, `${name}-seed`);
    mkdirSync(seed);
    git(seed, "init", "-q", "-b", head);
    writeFileSync(join(seed, "README.md"), "hi\n");
    git(seed, "add", ".");
    git(seed, "commit", "-qm", "init");
    const origin = join(dir, `${name}-origin.git`);
    git(dir, "clone", "-q", "--bare", seed, origin);
    git(dir, "clone", "-q", origin, join(dir, name));
    return { repo: join(dir, name), origin, seed };
  };
  t = { dir, home, env, logs, host, git, tryGit, repo, cloned, root: (r) => join(home, ".herdr", "worktrees", r.split("/").pop()) };
});

afterEach(async () => {
  await fsp.rm(t.dir, { recursive: true, force: true });
});

/** A seeded [0, 1) source, so a test can know which names come. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("names", () => {
  test("adjective-adjective-noun from que's word lists, two different adjectives", () => {
    const rng = seeded(7);
    for (let n = 0; n < 500; n++) {
      const [a, b, noun, ...rest] = W.randomName(rng).split("-");
      assert.equal(rest.length, 0);
      assert.ok(W.ADJECTIVES.includes(a) && W.ADJECTIVES.includes(b) && W.NOUNS.includes(noun));
      assert.notEqual(a, b);
    }
  });

  test("the second adjective is drawn from the others, so a source that repeats still gives two", () => {
    assert.equal(W.randomName(() => 0), "amber-bold-badger");
    assert.equal(W.randomName(() => 0.999999), "dusky-mossy-wombat");
  });

  test("que's lists: 80 adjectives and 80 nouns, none twice", () => {
    assert.equal(new Set(W.ADJECTIVES).size, 80);
    assert.equal(new Set(W.NOUNS).size, 80);
  });
});

describe("drawName", () => {
  test("the first name when it is free", async () => {
    const repo = t.repo();
    const got = await W.drawName(t.host, { repo, root: t.root(repo), first: "calm-quiet-otter" });
    assert.deepEqual(got, { name: "calm-quiet-otter", path: join(t.root(repo), "calm-quiet-otter") });
  });

  test("draws again past a branch that exists and a folder that exists", async () => {
    const repo = t.repo();
    const ahead = seeded(42);
    const names = [W.randomName(ahead), W.randomName(ahead), W.randomName(ahead)];
    t.git(repo, "branch", names[0]);
    mkdirSync(join(t.root(repo), names[1]), { recursive: true });
    const taken = new Set();
    const got = await W.drawName(t.host, { repo, root: t.root(repo), rng: seeded(42), taken });
    assert.equal(got.name, names[2]);
    assert.deepEqual([...taken], [names[2]], "the name found is reserved, the clashes are not");
  });

  test("skips a name another workspace being made has drawn", async () => {
    const repo = t.repo();
    const got = await W.drawName(t.host, { repo, root: t.root(repo), first: "bold-calm-owl", taken: new Set(["bold-calm-owl"]), rng: () => 0 });
    assert.equal(got.name, "amber-bold-badger");
  });

  test("gives up after 50 draws", async () => {
    const repo = t.repo();
    t.git(repo, "branch", "amber-bold-badger");
    const taken = new Set();
    await assert.rejects(W.drawName(t.host, { repo, root: t.root(repo), rng: () => 0, taken }), (e) => e instanceof W.Failure && e.message === "no free name after 50 tries");
    assert.equal(taken.size, 0);
  });
});

describe("que.toml", () => {
  test("reads setup, default_branch and worktree_include among everything else", () => {
    const r = W.parseQueToml(`# que.toml
setup = "npm ci" # run inside a new worktree
teardown = "./scripts/teardown.sh"
default_branch = 'develop'
worktree_include = [
  ".env.local", # comment
  'config/dev.json',
]
permission_mode = "acceptEdits"
when = 1979-05-27 07:32:00Z
n = -1_000.5e3
flags = { a = 1, b = [1, 2], c = "}" }
[tool]
setup = "not this one"
`);
    assert.deepEqual(r, { ok: true, config: { setup: "npm ci", defaultBranch: "develop", worktreeInclude: [".env.local", "config/dev.json"] } });
  });

  test("multi-line strings, escapes and quoted keys", () => {
    const r = W.parseQueToml(`"setup" = """
npm ci && \\
  npm run build
echo "done" \\u00e9\\t""""
notes = '''
setup = "inside a string"
[not a table]
'''
default_branch = "trunk"`);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.config.setup, 'npm ci && npm run build\necho "done" é\t"');
    assert.equal(r.config.defaultBranch, "trunk");
    assert.deepEqual(r.config.worktreeInclude, []);
  });

  test("keys under a table, in an array of tables or dotted are not the root's", () => {
    const r = W.parseQueToml(`a.setup = "x"\n[[hooks]]\nsetup = "y"\n[ "more" ]\ndefault_branch = "z"\n`);
    assert.deepEqual(r, { ok: true, config: { worktreeInclude: [] } });
  });

  test("an empty file, CRLF line ends and a byte-order mark", () => {
    assert.deepEqual(W.parseQueToml(""), { ok: true, config: { worktreeInclude: [] } });
    assert.deepEqual(W.parseQueToml('﻿setup = "make"\r\nworktree_include = [".env"]\r\n'), { ok: true, config: { setup: "make", worktreeInclude: [".env"] } });
  });

  test("a file that isn't TOML says where", () => {
    const bad = {
      'setup = "npm ci\n': "line 1: unterminated string",
      'a = 1\nsetup\n': 'line 2: expected = after a key',
      'a = 1\n\nb = "\\q"': "line 3: invalid escape \\q",
      'worktree_include = [".env"\n': "line 2: unterminated array",
      "x = 1 2\n": 'line 1: unexpected "2"',
      "= 1\n": 'line 1: unexpected "="',
      "[tool\nsetup = 1": "line 1: expected ] after a table name",
      'notes = """\nnever closed\n': "line 3: unterminated string",
    };
    for (const [text, error] of Object.entries(bad)) assert.deepEqual(W.parseQueToml(text), { ok: false, error }, text);
  });

  test("one of the three keys with the wrong type, or set twice, makes it unusable", () => {
    assert.deepEqual(W.parseQueToml("setup = 5\n"), { ok: false, error: "line 1: setup must be a string" });
    assert.deepEqual(W.parseQueToml('default_branch = ["main"]\n'), { ok: false, error: "line 1: default_branch must be a string" });
    assert.deepEqual(W.parseQueToml('worktree_include = ".env"\n'), { ok: false, error: "line 1: worktree_include must be a list of strings" });
    assert.deepEqual(W.parseQueToml('worktree_include = [".env", 1]\n'), { ok: false, error: "line 1: worktree_include must be a list of strings" });
    assert.deepEqual(W.parseQueToml('setup = "a"\nsetup = "b"\n'), { ok: false, error: "line 2: setup is set twice" });
  });
});

describe(".worktreeinclude and the repo's config", () => {
  test("one path per line, # comments and blanks skipped", () => {
    assert.deepEqual(W.parseWorktreeInclude("# secrets\n.env\n\n  config/dev.json  \n#node_modules\n"), [".env", "config/dev.json"]);
    assert.deepEqual(W.parseWorktreeInclude(null), []);
  });

  test("que.toml's list first, then the file's, each path once", async () => {
    const repo = t.repo();
    writeFileSync(join(repo, "que.toml"), 'setup = "make"\nworktree_include = [".env", "a"]\n');
    writeFileSync(join(repo, ".worktreeinclude"), "a\nb\n.env\n");
    assert.deepEqual(await W.readRepoConfig(t.host, repo), { setup: "make", defaultBranch: null, include: [".env", "a", "b"], warning: null });
  });

  test("no files: nothing to copy, no setup", async () => {
    assert.deepEqual(await W.readRepoConfig(t.host, t.repo()), { setup: null, defaultBranch: null, include: [], warning: null });
  });

  test("a que.toml that can't be used is reported and ignored; .worktreeinclude still counts", async () => {
    const repo = t.repo();
    writeFileSync(join(repo, "que.toml"), 'setup = "npm ci\n');
    writeFileSync(join(repo, ".worktreeinclude"), ".env\n");
    assert.deepEqual(await W.readRepoConfig(t.host, repo), { setup: null, defaultBranch: null, include: [".env"], warning: "que.toml ignored: line 1: unterminated string" });
  });
});

describe("safeInclude", () => {
  test("relative paths inside the repo, normalized; anything leaving it is refused", () => {
    const cases = { ".env": ".env", "./config/x.json": "config/x.json", "a//b/": "a/b", "a/../b": "b", "/etc/passwd": null, "../x": null, "a/../../x": null, ".": null, "": null, "..": null, "a/..": null };
    for (const [entry, want] of Object.entries(cases)) assert.equal(W.safeInclude(entry), want, entry);
  });
});

describe("the base", () => {
  test("que.toml's default_branch wins", async () => {
    assert.equal(await W.defaultBranch(t.host, t.repo(), "develop"), "develop");
  });

  test("origin's HEAD, else main, else master, else the branch checked out", async () => {
    const { repo } = t.cloned("trunked", "trunk");
    assert.equal(await W.defaultBranch(t.host, repo, null), "trunk");
    const plain = t.repo("plain");
    t.git(plain, "checkout", "-q", "-b", "feature/x");
    assert.equal(await W.defaultBranch(t.host, plain, null), "main");
    t.git(plain, "branch", "-m", "main", "master");
    assert.equal(await W.defaultBranch(t.host, plain, null), "master");
    t.git(plain, "branch", "-m", "master", "old");
    assert.equal(await W.defaultBranch(t.host, plain, null), "feature/x");
  });

  test("origin/<default> when it exists, else the local branch; one naming no commit fails", async () => {
    const { repo } = t.cloned();
    assert.equal(await W.baseRef(t.host, repo, "main"), "origin/main");
    const plain = t.repo("plain");
    assert.equal(await W.baseRef(t.host, plain, "main"), "main");
    await assert.rejects(W.baseRef(t.host, plain, "nope"), (e) => e instanceof W.Failure && e.message === "unknown base ref nope");
  });
});

describe("copyIncludes", () => {
  test("copies the gitignored files and folders listed; skips missing, tracked, unsafe and outside ones", async () => {
    const repo = t.repo();
    const outside = join(t.dir, "outside");
    mkdirSync(join(outside, "deep"), { recursive: true });
    writeFileSync(join(outside, "deep", "secret"), "s\n");
    writeFileSync(join(repo, ".gitignore"), ".env\nnode_modules/\nlinked\nlinks/\nescape\n");
    t.git(repo, "add", ".gitignore");
    t.git(repo, "commit", "-qm", "ignore");
    writeFileSync(join(repo, ".env"), "TOKEN=1\n");
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "pkg", "index.js"), "x\n");
    symlinkSync(".env", join(repo, "linked"));
    symlinkSync(outside, join(repo, "escape"));
    writeFileSync(join(repo, "README.md"), "changed in the main checkout\n");
    const wt = join(t.dir, "wt");
    t.git(repo, "worktree", "add", "-q", "-b", "w", wt, "main");
    await W.copyIncludes(t.host, repo, wt, [".env", "node_modules/", "linked", "missing.txt", "README.md", "../x", "/etc/hosts", "escape/deep/secret"], t.logs.push.bind(t.logs));
    assert.equal(readFileSync(join(wt, ".env"), "utf8"), "TOKEN=1\n");
    assert.equal(readFileSync(join(wt, "node_modules", "pkg", "index.js"), "utf8"), "x\n");
    assert.ok(lstatSync(join(wt, "linked")).isSymbolicLink(), "a symlink stays a symlink");
    assert.equal(readlinkSync(join(wt, "linked")), ".env");
    assert.equal(readFileSync(join(wt, "README.md"), "utf8"), "hi\n", "a tracked file keeps the base's version");
    assert.ok(!existsSync(join(wt, "missing.txt")));
    assert.ok(!existsSync(join(wt, "escape")));
    assert.deepEqual(t.logs, [
      "worktree_include: README.md is not gitignored, not copied",
      "worktree_include: skipping unsafe path ../x",
      "worktree_include: skipping unsafe path /etc/hosts",
      "worktree_include: escape/deep/secret leads outside the repository, not copied",
    ]);
  });

  test("a copy that fails is a failure", async () => {
    const repo = t.repo();
    writeFileSync(join(repo, ".gitignore"), "secret\n");
    writeFileSync(join(repo, "secret"), "s\n");
    chmodSync(join(repo, "secret"), 0o000);
    const wt = join(t.dir, "wt");
    t.git(repo, "worktree", "add", "-q", "-b", "w", wt, "main");
    await assert.rejects(W.copyIncludes(t.host, repo, wt, ["secret"]), (e) => e instanceof W.Failure && /^copying files failed: secret: .*Permission denied/.test(e.message));
  });
});

describe("setupArgv", () => {
  test("no setup: the agent's argv as it is, or a shell", () => {
    assert.deepEqual(W.setupArgv(null, ["sh", "/x/claude"]), ["sh", "/x/claude"]);
    assert.equal(W.setupArgv(null, null), null);
    assert.equal(W.setupArgv("", []), null);
  });

  test("the setup runs in the folder first, then the agent takes the terminal with its arguments", () => {
    const argv = W.setupArgv("printf '%s\\n' \"it's set up\" > setup.txt", ["sh", "-c", 'pwd -P > agent.txt; printf "%s" "$1" > arg.txt', "x", "a b"]);
    assert.deepEqual(argv.slice(0, 2), ["sh", "-c"]);
    const out = execFileSync(argv[0], argv.slice(1), { cwd: t.dir, encoding: "utf8" });
    assert.equal(out, "$ printf '%s\\n' \"it's set up\" > setup.txt\n");
    assert.equal(readFileSync(join(t.dir, "setup.txt"), "utf8"), "it's set up\n");
    assert.equal(readFileSync(join(t.dir, "agent.txt"), "utf8").trim(), t.dir);
    assert.equal(readFileSync(join(t.dir, "arg.txt"), "utf8"), "a b");
  });

  test("the agent starts even after a failed setup, or one that exits", () => {
    for (const setup of ["false", "exit 3"]) {
      const argv = W.setupArgv(setup, ["sh", "-c", "echo agent"]);
      const out = execFileSync(argv[0], argv.slice(1), { cwd: t.dir, encoding: "utf8" });
      assert.match(out, /setup exited with code [13]\n\nagent\n$/, setup);
    }
  });

  test("with no agent the script ends cleanly after the setup (herdr's launcher leaves a shell)", () => {
    const argv = W.setupArgv("echo ok", null);
    assert.equal(execFileSync(argv[0], argv.slice(1), { cwd: t.dir, encoding: "utf8" }), "$ echo ok\nok\n");
  });
});

describe("prepareWorkspace", () => {
  test("que's way: fetch, a worktree from origin/<default> on its own branch, the includes, setup ahead of the agent", async () => {
    const { repo, origin } = t.cloned();
    // origin moves on after the clone: the fetch must bring that commit in.
    const other = join(t.dir, "other");
    t.git(t.dir, "clone", "-q", origin, other);
    writeFileSync(join(other, "NEW.md"), "new\n");
    t.git(other, "add", ".");
    t.git(other, "commit", "-qm", "upstream");
    t.git(other, "push", "-q", "origin", "main");
    const upstream = t.git(other, "rev-parse", "HEAD");
    // The main checkout sits on a feature branch with uncommitted work, as the practice repo does.
    writeFileSync(join(repo, ".gitignore"), ".env\n.env.local\n");
    t.git(repo, "add", ".gitignore");
    t.git(repo, "commit", "-qm", "ignore");
    t.git(repo, "checkout", "-q", "-b", "feature/discounts");
    writeFileSync(join(repo, "README.md"), "work in progress\n");
    writeFileSync(join(repo, "que.toml"), 'setup = "npm ci"\nworktree_include = [".env"]\n');
    writeFileSync(join(repo, ".worktreeinclude"), ".env.local\n");
    writeFileSync(join(repo, ".env"), "A=1\n");
    writeFileSync(join(repo, ".env.local"), "B=2\n");
    const before = t.git(repo, "status", "--porcelain");

    const steps = [];
    const named = [];
    const taken = new Set();
    const got = await W.prepareWorkspace(t.host, { repo, agent: ["sh", "/x/claude"] }, { first: "brave-calm-otter", taken, onName: (...a) => named.push(a), onStep: (s) => steps.push(s) });

    const path = join(t.home, ".herdr", "worktrees", "shop", "brave-calm-otter");
    assert.deepEqual(got, { name: "brave-calm-otter", path, from: "origin/main", argv: W.setupArgv("npm ci", ["sh", "/x/claude"]) });
    assert.deepEqual(named, [["brave-calm-otter", path]]);
    assert.deepEqual(steps, ["fetching", "adding worktree", "copying files"]);
    assert.equal(t.git(path, "rev-parse", "HEAD"), upstream, "based on origin/main as fetched");
    assert.equal(t.git(path, "symbolic-ref", "--short", "HEAD"), "brave-calm-otter");
    assert.equal(t.tryGit(path, "rev-parse", "--abbrev-ref", "brave-calm-otter@{upstream}"), null, "--no-track: no upstream");
    assert.equal(readFileSync(join(path, ".env"), "utf8"), "A=1\n");
    assert.equal(readFileSync(join(path, ".env.local"), "utf8"), "B=2\n");
    assert.equal(t.git(repo, "symbolic-ref", "--short", "HEAD"), "feature/discounts", "the main checkout stays where it was");
    assert.equal(t.git(repo, "status", "--porcelain"), before);
    assert.equal(taken.size, 0);
  });

  test("no origin: no fetch, the local default branch, whatever is checked out", async () => {
    const repo = t.repo();
    const main = t.git(repo, "rev-parse", "main");
    t.git(repo, "checkout", "-q", "-b", "feature/x");
    writeFileSync(join(repo, "f.txt"), "f\n");
    t.git(repo, "add", ".");
    t.git(repo, "commit", "-qm", "feature");
    const steps = [];
    const got = await W.prepareWorkspace(t.host, { repo, agent: null }, { first: "tidy-wise-heron", onStep: (s) => steps.push(s) });
    assert.deepEqual(steps, ["adding worktree"]);
    assert.equal(got.from, "main");
    assert.equal(got.argv, null);
    assert.equal(t.git(got.path, "rev-parse", "HEAD"), main);
  });

  test("a fetch that fails is logged and the work goes on", async () => {
    const { repo } = t.cloned();
    t.git(repo, "remote", "set-url", "origin", join(t.dir, "gone.git"));
    const steps = [];
    const got = await W.prepareWorkspace(t.host, { repo }, { first: "keen-kind-koala", onStep: (s) => steps.push(s) });
    assert.deepEqual(steps, ["fetching", "adding worktree"]);
    assert.equal(got.from, "origin/main", "the origin/main already known");
    assert.ok(t.logs.some((l) => l.startsWith("git fetch origin failed (continuing): ")), t.logs.join("\n"));
  });

  test("a que.toml that can't be used is reported, and the workspace is made without it", async () => {
    const repo = t.repo();
    writeFileSync(join(repo, "que.toml"), 'setup = 5\n');
    const warnings = [];
    const got = await W.prepareWorkspace(t.host, { repo, agent: ["claude"] }, { first: "soft-snowy-finch", onWarning: (w) => warnings.push(w) });
    assert.deepEqual(warnings, ["que.toml ignored: line 1: setup must be a string"]);
    assert.deepEqual(got.argv, ["claude"]);
    assert.ok(existsSync(join(got.path, "README.md")));
  });

  test("git worktree add failing leaves no branch behind", async () => {
    const repo = t.repo();
    mkdirSync(join(t.home, ".herdr", "worktrees"), { recursive: true });
    writeFileSync(join(t.home, ".herdr", "worktrees", "shop"), "a file where the folder goes\n");
    const taken = new Set();
    await assert.rejects(
      W.prepareWorkspace(t.host, { repo }, { first: "grand-glad-goose", taken }),
      (e) => e instanceof W.Failure && /^git worktree add failed: could not create leading directories of '.*': Not a directory$/.test(e.message),
    );
    assert.equal(t.git(repo, "branch", "--list", "grand-glad-goose"), "");
    assert.equal(t.git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length, 1);
    assert.equal(taken.size, 0);
  });

  test("copying files failing takes the worktree and its branch away", async () => {
    const repo = t.repo();
    writeFileSync(join(repo, ".gitignore"), "secret\n");
    t.git(repo, "add", ".gitignore");
    t.git(repo, "commit", "-qm", "ignore");
    writeFileSync(join(repo, "secret"), "s\n");
    chmodSync(join(repo, "secret"), 0o000);
    writeFileSync(join(repo, ".worktreeinclude"), "secret\n");
    const steps = [];
    await assert.rejects(
      W.prepareWorkspace(t.host, { repo }, { first: "proud-quick-robin", onStep: (s) => steps.push(s) }),
      (e) => e instanceof W.Failure && /^copying files failed: secret: /.test(e.message),
    );
    assert.deepEqual(steps, ["adding worktree", "copying files"]);
    assert.ok(!existsSync(join(t.root(repo), "proud-quick-robin")));
    assert.equal(t.git(repo, "branch", "--list", "proud-quick-robin"), "");
    assert.equal(t.git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length, 1);
  });

  test("a default branch that names no commit fails before anything is made", async () => {
    const repo = t.repo();
    writeFileSync(join(repo, "que.toml"), 'default_branch = "nope"\n');
    const steps = [];
    await assert.rejects(W.prepareWorkspace(t.host, { repo }, { first: "warm-wavy-walrus", onStep: (s) => steps.push(s) }), /unknown base ref nope/);
    assert.deepEqual(steps, []);
    assert.equal(t.git(repo, "branch", "--list", "warm-wavy-walrus"), "");
    assert.ok(!existsSync(join(t.home, ".herdr")));
  });
});
