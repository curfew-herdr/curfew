// node --test ~/.config/herdr-app/mods/curfew-sidebar/remove.test.mjs
// Remove project's plan and deletions (remove.mjs) on node's host, against throwaway git
// repositories in a temp folder ($CURFEW_TEST_TMP, else the system's), with a temp home whose
// .herdr/worktrees is the root: never the real home or a real repository. The process tests start
// their own `cat`s and stop only those, by the pids they started.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as R from "./remove.mjs";

let t; // this test's folders, environment and helpers

beforeEach(() => {
  const dir = realpathSync(mkdtempSync(join(process.env.CURFEW_TEST_TMP || tmpdir(), "curfew-remove-")));
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
  const ran = [];
  const host = {
    exec: (command, args, { cwd, timeout = 30_000 } = {}) => {
      ran.push([command, ...args]);
      return new Promise((resolve, reject) => {
        execFile(command, args, { cwd, timeout, env, encoding: "utf8", maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
          if (err && typeof err.code !== "number") reject(err);
          else resolve({ code: err ? err.code : 0, stdout, stderr });
        });
      });
    },
    hc: () => Promise.resolve({ code: 1, stdout: "", stderr: "no hc in tests" }),
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  /** A repo with one commit on main, at `at` (default <dir>/<name>). */
  const repo = (name = "shop", at = join(dir, name)) => {
    mkdirSync(at, { recursive: true });
    git(at, "init", "-q", "-b", "main");
    writeFileSync(join(at, "README.md"), "hi\n");
    git(at, "add", ".");
    git(at, "commit", "-qm", "init");
    return at;
  };
  const root = join(home, ".herdr", "worktrees");
  /** A linked worktree of `repo` on a new branch `name`, at `at` (default <root>/<repo>/<name>). */
  const worktree = (r, name, at = join(root, r.split("/").pop(), name)) => {
    git(r, "worktree", "add", "-q", "-b", name, at);
    return at;
  };
  /** The paths git lists for `r`, the main checkout first. */
  const listed = (r) => git(r, "worktree", "list", "--porcelain", "-z").split("\0").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
  t = { dir, home, env, ran, host, git, repo, root, worktree, listed };
});

afterEach(async () => {
  await fsp.rm(t.dir, { recursive: true, force: true });
});

describe("git worktree list --porcelain", () => {
  const SHA = (c) => c.repeat(40);
  const records = [
    ["worktree /src/shop", `HEAD ${SHA("1")}`, "branch refs/heads/main"],
    ["worktree /h/.herdr/worktrees/shop/calm-otter", `HEAD ${SHA("2")}`, "branch refs/heads/calm-otter"],
    ["worktree /h/.herdr/worktrees/shop/detached", `HEAD ${SHA("3")}`, "detached"],
    ["worktree /h/.herdr/worktrees/shop/on usb", `HEAD ${SHA("4")}`, "branch refs/heads/feature/usb", "locked on a usb disk"],
    ["worktree /h/.herdr/worktrees/shop/held", `HEAD ${SHA("5")}`, "branch refs/heads/held", "locked"],
    ["worktree /h/.herdr/worktrees/shop/gone", `HEAD ${SHA("6")}`, "branch refs/heads/gone", "prunable gitdir file points to non-existent location"],
  ];
  const want = [
    { path: "/src/shop", head: SHA("1"), branch: "main", bare: false, detached: false, locked: null, prunable: null, main: true },
    { path: "/h/.herdr/worktrees/shop/calm-otter", head: SHA("2"), branch: "calm-otter", bare: false, detached: false, locked: null, prunable: null, main: false },
    { path: "/h/.herdr/worktrees/shop/detached", head: SHA("3"), branch: null, bare: false, detached: true, locked: null, prunable: null, main: false },
    { path: "/h/.herdr/worktrees/shop/on usb", head: SHA("4"), branch: "feature/usb", bare: false, detached: false, locked: "on a usb disk", prunable: null, main: false },
    { path: "/h/.herdr/worktrees/shop/held", head: SHA("5"), branch: "held", bare: false, detached: false, locked: "", prunable: null, main: false },
    { path: "/h/.herdr/worktrees/shop/gone", head: SHA("6"), branch: "gone", bare: false, detached: false, locked: null, prunable: "gitdir file points to non-existent location", main: false },
  ];

  test("main, linked, detached, locked (with a reason and without) and prunable, lines ending in newlines", () => {
    assert.deepEqual(R.parseWorktrees(records.map((r) => r.join("\n")).join("\n\n") + "\n\n"), want);
  });

  test("the same with -z (NUL-ended fields, an empty one between entries)", () => {
    assert.deepEqual(R.parseWorktrees(records.map((r) => r.join("\0") + "\0").join("\0") + "\0"), want);
  });

  test("a bare repository is the first entry; nothing and junk give nothing", () => {
    const got = R.parseWorktrees(`worktree /src/shop.git\nbare\n\nworktree /h/.herdr/worktrees/shop/x\nHEAD ${SHA("7")}\nbranch refs/heads/x\n`);
    assert.deepEqual(got.map((w) => [w.path, w.main, w.bare, w.branch]), [["/src/shop.git", true, true, null], ["/h/.herdr/worktrees/shop/x", false, false, "x"]]);
    assert.deepEqual(R.parseWorktrees(""), []);
    assert.deepEqual(R.parseWorktrees(undefined), []);
    assert.deepEqual(R.parseWorktrees("HEAD abc\nbranch refs/heads/x\n"), []);
  });

  test("git's own list, read with -z: paths with a space or a newline come back whole", async () => {
    const repo = t.repo();
    const spaced = t.worktree(repo, "spaced", join(t.root, "shop", "with space"));
    const newline = t.worktree(repo, "nl", join(t.root, "shop", "two\nlines"));
    t.git(repo, "worktree", "lock", "--reason", "kept", spaced);
    const [first, ...rest] = (await R.listWorktrees(t.host, repo)).map((w) => [w.path, w.main, w.branch, w.locked]);
    assert.deepEqual(first, [repo, true, "main", null]);
    assert.deepEqual(rest.sort(), [[newline, false, "nl", null], [spaced, false, "spaced", "kept"]].sort());
    assert.equal(await R.listWorktrees(t.host, join(t.dir, "nothing-here")), null);
  });
});

describe("inside the root", () => {
  const root = "/h/.herdr/worktrees";

  test("a folder strictly under it", () => {
    for (const p of [`${root}/shop`, `${root}/shop/calm-otter`, `${root}/shop/calm-otter/`, `${root}/a b/c`]) assert.equal(R.isInside(root, p), true, p);
    assert.equal(R.isInside(`${root}/`, `${root}/shop`), true, "a root written with a slash");
  });

  test("never the root itself, a sibling sharing its prefix, a parent, or a path with . or .. in it", () => {
    const outside = [
      root,
      `${root}/`,
      `${root}-x/shop`,
      `${root}x`,
      "/h/.herdr",
      "/h",
      `${root}/..`,
      `${root}/../worktrees-x/a`,
      `${root}/shop/../../x`,
      `${root}/shop/..`,
      `${root}/./shop`,
      `${root}//shop`,
      "shop",
      "",
      null,
    ];
    for (const p of outside) assert.equal(R.isInside(root, p), false, String(p));
  });

  test("a root that isn't absolute and clean holds nothing", () => {
    assert.equal(R.isInside("h/.herdr/worktrees", "h/.herdr/worktrees/shop"), false);
    assert.equal(R.isInside("/", "/shop"), false);
    assert.equal(R.isInside("", "/shop"), false);
    assert.equal(R.isInside("/h/../x", "/h/../x/shop"), false);
  });
});

describe("the plan", () => {
  test("linked worktrees under the root, open or closed, dirty or clean; never the main checkout, a prunable one or one outside", async () => {
    const repo = t.repo();
    const open = t.worktree(repo, "open-clean");
    const dirty = t.worktree(repo, "open-dirty");
    writeFileSync(join(dirty, "README.md"), "changed\n");
    const closed = t.worktree(repo, "closed-clean");
    const untracked = t.worktree(repo, "closed-untracked");
    writeFileSync(join(untracked, "new.txt"), "new\n");
    const broken = t.worktree(repo, "status-fails");
    writeFileSync(join(broken, ".git"), "not a gitfile\n");
    const gone = t.worktree(repo, "gone");
    rmSync(gone, { recursive: true });
    const outside = t.worktree(repo, "outside", join(t.dir, "elsewhere", "outside"));
    t.worktree(repo, "sibling", `${t.root}-x/shop/sibling`);
    const tops = [
      { top: repo, linked: false },
      { top: open, linked: true },
      { top: dirty, linked: true },
      { top: outside, linked: true },
      { top: outside, linked: true }, // two spaces in one worktree: one worktree
    ];
    const plan = await R.planRemoval(t.host, { main: repo, root: t.root, open: tops });
    const byName = (a, b) => (a.name < b.name ? -1 : 1);
    assert.deepEqual({ ...plan, worktrees: [...plan.worktrees].sort(byName) }, {
      worktrees: [
        { name: "closed-clean", path: closed, open: false, dirty: false },
        { name: "closed-untracked", path: untracked, open: false, dirty: true },
        { name: "open-clean", path: open, open: true, dirty: false },
        { name: "open-dirty", path: dirty, open: true, dirty: true },
        { name: "status-fails", path: broken, open: false, dirty: true },
      ],
      outside: 1,
    });
  });

  test("a folder git doesn't know as a repository: nothing to delete, its outside spaces still counted", async () => {
    const plan = await R.planRemoval(t.host, { main: join(t.dir, "nothing-here"), root: t.root, open: [{ top: join(t.dir, "x"), linked: true }] });
    assert.deepEqual(plan, { worktrees: [], outside: 1 });
  });
});

describe("deleting", () => {
  test("deletes listed worktrees under the root one at a time, dirty ones too, keeping their branches; prunes; the emptied folder goes, the root stays", async () => {
    const repo = t.repo();
    const a = t.worktree(repo, "a");
    writeFileSync(join(a, "README.md"), "uncommitted\n");
    writeFileSync(join(a, "untracked.txt"), "x\n");
    const b = t.worktree(repo, "b");
    const steps = [];
    const deleted = await R.deleteWorktrees(t.host, { main: repo, root: t.root, paths: [a, b], onStart: (p) => steps.push(["start", p]), onEnd: (p, e) => steps.push(["end", p, e]) });
    assert.deepEqual(deleted, [a, b]);
    assert.deepEqual(steps, [["start", a], ["end", a, ""], ["start", b], ["end", b, ""]]);
    assert.ok(!existsSync(a) && !existsSync(b));
    assert.ok(!existsSync(join(t.root, "shop")), "<root>/shop was emptied, so it goes");
    assert.ok(existsSync(t.root), "the root stays");
    assert.deepEqual(t.listed(repo), [repo]);
    assert.equal(t.git(repo, "branch", "--list", "--format=%(refname:short)"), "a\nb\nmain", "branches are kept");
    assert.ok(existsSync(join(repo, "README.md")), "the main checkout is untouched");
    assert.ok(t.ran.some((c) => c.join(" ") === `git -C ${repo} worktree remove --force ${a}`));
    assert.ok(t.ran.some((c) => c.join(" ") === `git -C ${repo} worktree prune`));
  });

  test("a folder that still holds another worktree stays, and so does the root when a worktree sat right in it", async () => {
    const repo = t.repo();
    const a = t.worktree(repo, "a");
    const b = t.worktree(repo, "b");
    const direct = t.worktree(repo, "direct", join(t.root, "direct"));
    assert.deepEqual(await R.deleteWorktrees(t.host, { main: repo, root: t.root, paths: [a, direct] }), [a, direct]);
    assert.ok(existsSync(b) && existsSync(join(t.root, "shop")));
    assert.ok(existsSync(t.root));
    assert.deepEqual(t.listed(repo), [repo, b]);
  });

  test("refuses the main checkout, a folder git doesn't list, a path outside the root, a sibling root and a .. path, and touches none of them", async () => {
    // A repository whose main checkout sits under the root itself (cloned there by hand).
    const main = t.repo("held", join(t.root, "held", "main"));
    const unlisted = join(t.root, "held", "plain");
    mkdirSync(unlisted);
    writeFileSync(join(unlisted, "keep.txt"), "keep\n");
    const outside = t.worktree(main, "outside", join(t.dir, "outside"));
    const sibling = t.worktree(main, "sibling", `${t.root}-x/held/sibling`);
    const dotdot = `${t.root}/../../../outside`; // <dir>/outside, the worktree outside the root
    const cases = [
      [main, `${main} is the main checkout`],
      [join(t.root, "held"), `${join(t.root, "held")} holds the main checkout`],
      [unlisted, `${unlisted} is not a worktree of ${main}`],
      [outside, `${outside} is not under ${t.root}`],
      [sibling, `${sibling} is not under ${t.root}`],
      [dotdot, `${dotdot} is not under ${t.root}`],
    ];
    const ended = [];
    const deleted = await R.deleteWorktrees(t.host, { main, root: t.root, paths: cases.map(([p]) => p), onEnd: (p, e) => ended.push([p, e]) });
    assert.deepEqual(deleted, []);
    assert.deepEqual(ended, cases);
    for (const p of [main, unlisted, outside, sibling]) assert.ok(existsSync(p), p);
    assert.ok(existsSync(join(main, "README.md")) && existsSync(join(unlisted, "keep.txt")));
    assert.deepEqual(t.listed(main).sort(), [main, outside, sibling].sort());
    assert.ok(!t.ran.some((c) => c.includes("remove")), "git worktree remove never ran");
  });

  test("a worktree holding another one, and a locked one, stay with the reason", async () => {
    const repo = t.repo();
    const outer = t.worktree(repo, "outer");
    const inner = t.worktree(repo, "inner", join(outer, "inner"));
    const locked = t.worktree(repo, "locked");
    t.git(repo, "worktree", "lock", "--reason", "on a usb disk", locked);
    assert.equal(await R.deleteWorktree(t.host, { main: repo, root: t.root, path: outer }), `${outer} holds another worktree`);
    assert.match(await R.deleteWorktree(t.host, { main: repo, root: t.root, path: locked }), /cannot remove a locked working tree, lock reason: on a usb disk/);
    assert.ok(existsSync(outer) && existsSync(inner) && existsSync(locked));
    assert.equal(await R.deleteWorktree(t.host, { main: repo, root: t.root, path: inner }), "", "the inner one can go first");
  });

  test("a worktree whose folder was deleted by hand counts as gone: prune forgets it and its emptied folder goes", async () => {
    const repo = t.repo();
    const gone = t.worktree(repo, "gone");
    rmSync(gone, { recursive: true });
    const ended = [];
    assert.deepEqual(await R.deleteWorktrees(t.host, { main: repo, root: t.root, paths: [gone], onEnd: (p, e) => ended.push([p, e]) }), [gone]);
    assert.deepEqual(ended, [[gone, ""]]);
    assert.deepEqual(t.listed(repo), [repo]);
    assert.ok(!existsSync(join(t.root, "shop")));
  });

  test("nothing asked: nothing runs", async () => {
    const repo = t.repo();
    assert.deepEqual(await R.deleteWorktrees(t.host, { main: repo, root: t.root, paths: [] }), []);
    assert.deepEqual(t.ran, []);
  });
});

describe("the terminals' processes", () => {
  let started; // the cats this test started: stopped by their own pids afterwards

  beforeEach(() => {
    started = [];
  });

  afterEach(() => {
    for (const c of started) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  });

  /** A `cat` reading a pipe: it runs until its stdin ends. */
  const cat = () => {
    const c = spawn("cat", [], { stdio: ["pipe", "ignore", "ignore"] });
    started.push(c);
    return c;
  };
  const exited = (c) =>
    new Promise((resolve) => {
      if (c.exitCode !== null || c.signalCode !== null) resolve({ code: c.exitCode, signal: c.signalCode });
      else c.once("exit", (code, signal) => resolve({ code, signal }));
    });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** herdr-core's `hc get <address> --json` for the given terminals; anything else is unknown. */
  const hcFor = (terminals) => (args) => {
    assert.deepEqual([args[0], args[2]], ["get", "--json"]);
    const v = terminals[args[1]];
    if (v === undefined) return Promise.resolve({ code: 1, stdout: "", stderr: `no terminal ${args[1]}` });
    return Promise.resolve({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify({ address: args[1], ...v }), stderr: "" });
  };

  test("records each terminal's pid and its foreground program's, once each, with when it started", async () => {
    const shell = cat();
    const agent = cat();
    const host = { ...t.host, hc: hcFor({ t1: { pid: shell.pid, foreground: { pid: agent.pid } }, t2: { pid: shell.pid, foreground: { pid: shell.pid } }, t3: "not json", t4: { pid: "12", foreground: null } }) };
    const got = await R.recordProcesses(host, ["t1", "t2", "t3", "t4", "t9"]);
    assert.deepEqual(got.map((p) => p.pid).sort(), [shell.pid, agent.pid].sort());
    assert.ok(got.every((p) => /\d{2}:\d{2}:\d{2}/.test(p.start)), JSON.stringify(got));
    assert.deepEqual(await R.recordProcesses(host, []), []);
  });

  test("a process that ends in time is left alone; one still running at the limit, and only that one, gets SIGKILL", async () => {
    const quits = cat();
    const stays = cat();
    const procs = await R.recordProcesses({ ...t.host, hc: hcFor({ t1: { pid: quits.pid, foreground: { pid: stays.pid } } }) }, ["t1"]);
    let looks = 0;
    const wait = async (ms) => {
      if (++looks === 2) quits.stdin.end(); // cat ends at the end of its input
      await pause(ms);
    };
    const killed = await R.stopProcesses(t.host, procs, { wait, limit: 1000, every: 50 });
    assert.deepEqual(killed, [stays.pid]);
    assert.ok(looks >= 2 && looks <= 21, `looked ${looks} times`);
    assert.deepEqual(await exited(quits), { code: 0, signal: null });
    assert.deepEqual(await exited(stays), { code: null, signal: "SIGKILL" });
    assert.ok(t.ran.some((c) => c.join(" ") === `kill -KILL ${stays.pid}`));
  });

  test("all ended at once: no waiting, nothing killed", async () => {
    const quick = cat();
    const procs = await R.recordProcesses({ ...t.host, hc: hcFor({ t1: { pid: quick.pid } }) }, ["t1"]);
    quick.stdin.end();
    await exited(quick);
    let waits = 0;
    assert.deepEqual(await R.stopProcesses(t.host, procs, { wait: () => (waits++, pause(10)), limit: 500, every: 50 }), []);
    assert.equal(waits, 0);
    assert.deepEqual(await R.stopProcesses(t.host, [], { wait: () => (waits++, pause(10)) }), []);
    assert.ok(!t.ran.some((c) => c[0] === "kill"));
  });

  test("a pid started at another time (the system gave it to another program) is never killed", async () => {
    const other = cat();
    const killed = await R.stopProcesses(t.host, [{ pid: other.pid, start: "Thu Jan 1 00:00:00 1970" }], { wait: (ms) => pause(ms), limit: 200, every: 50 });
    assert.deepEqual(killed, []);
    assert.equal(other.exitCode, null);
    assert.equal(other.signalCode, null);
    assert.ok(!t.ran.some((c) => c[0] === "kill"));
  });
});
