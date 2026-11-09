// node --test ~/.config/herdr-app/mods/curfew-prs/engine.test.mjs
// The engine on node's host (check.mjs), against a real git repository in a temp folder, a fake gh
// (fakes/gh) and a temporary app home (its curfew/prs.jsonl and curfew/pr-store/), never the real ones.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEngine, NO_GH } from "./engine.mjs";
import { nodeHost, main } from "./check.mjs";

const FAKES = join(dirname(fileURLToPath(import.meta.url)), "fakes");
const WITH_GH = `${FAKES}:/usr/bin:/bin:${dirname(process.execPath)}`;
const WITHOUT_GH = `/usr/bin:/bin:${dirname(process.execPath)}`;

const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

const rollup = (conclusion) => [{ __typename: "CheckRun", name: "test", workflowName: "CI", status: "COMPLETED", conclusion, startedAt: "2026-11-08T10:00:00Z", completedAt: "2026-11-08T10:02:00Z", detailsUrl: "https://ci/1" }];
const gh = (number, head, o = {}) => ({ number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, state: "OPEN", isDraft: false, reviewDecision: "", mergedAt: null, updatedAt: "2026-11-08T10:00:00Z", additions: 2, deletions: 1, baseRefName: "main", headRefName: head, ...o });

let t; // this test's folders and helpers

beforeEach(() => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "curfew-prs-engine-")));
  const repo = join(dir, "repo");
  const home = join(dir, "home");
  mkdirSync(repo);
  mkdirSync(join(home, "curfew"), { recursive: true });
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "commit", "-q", "--allow-empty", "-m", "first");
  sh(repo, "remote", "add", "origin", "https://github.com/o/r.git");
  sh(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  sh(repo, "checkout", "-q", "-b", "a");
  sh(repo, "checkout", "-q", "-b", "b");
  sh(repo, "worktree", "add", "-q", join(dir, "other"), "-b", "w");
  const fixture = {
    prs: [
      gh(1, "a", { state: "MERGED", mergedAt: "2026-11-07T00:00:00Z", statusCheckRollup: rollup("SUCCESS") }),
      gh(2, "b", { statusCheckRollup: rollup("FAILURE"), comments: [{ id: "c1", author: { login: "ann" }, body: "**hi**", createdAt: "2026-11-08T11:00:00Z", url: "u" }] }),
      gh(3, "someone-else"),
      gh(7, "stacked", { isDraft: true, baseRefName: "b" }),
      gh(8, "w"),
    ],
    lines: { 2: [{ id: 9, user: { login: "bob" }, body: "nit", created_at: "2026-11-08T11:30:00Z", path: "x.js", line: 3 }] },
    files: { 2: [{ filename: "x.js", status: "modified", additions: 2, deletions: 1 }] },
  };
  const ghFile = join(dir, "gh.json");
  const log = join(dir, "gh.log");
  writeFileSync(ghFile, JSON.stringify(fixture));
  writeFileSync(log, "");
  process.env.FAKE_GH = ghFile;
  process.env.FAKE_GH_LOG = log;
  process.env.PATH = WITH_GH;
  const entry = (number, cwd) => JSON.stringify({ at: "2026-11-08T12:00:00Z", sessionId: "s", cwd, url: `https://github.com/o/r/pull/${number}`, owner: "o", repo: "r", number });
  writeFileSync(join(home, "curfew", "prs.jsonl"), `${entry(7, join(repo, "src"))}\n${entry(8, join(dir, "other"))}\n`);
  t = {
    dir,
    repo,
    home,
    engine: makeEngine(nodeHost(home)),
    fixture: (change) => writeFileSync(ghFile, JSON.stringify(change(JSON.parse(readFileSync(ghFile, "utf8"))))),
    calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    clear: () => writeFileSync(log, ""),
  };
});

const heads = (calls) => calls.filter((c) => c[1] === "list" && c.includes("--head")).map((c) => c[c.indexOf("--head") + 1]);
const listings = (calls) => calls.filter((c) => c[1] === "list" && !c.includes("--head"));

test("a check finds the branches' and the sessions' pull requests, asking checks only where they can change", async () => {
  const r = await t.engine.check({ cwd: t.repo, on: null });
  assert.equal(r.ran, true);
  assert.equal(r.here.root, t.repo);
  assert.deepEqual(r.here.history, ["main", "a", "b"]);
  // #3 is someone else's branch, #8 the other worktree's session's.
  assert.deepEqual(r.store.prs.map((p) => [p.number, p.state, p.checks]), [[7, "draft", "none"], [2, "open", "failing"], [1, "merged", "passing"]]);
  assert.equal(r.store.repo, "o/r");
  const calls = t.calls();
  assert.equal(listings(calls).length, 1);
  assert.deepEqual(heads(calls).sort(), ["a", "b"]);
  assert.deepEqual(calls.filter((c) => c[1] === "view" && c.includes(TEXT_FIELDS)).map((c) => c.slice(2, 5)), [["7", "-R", "o/r"]]);
  // The open ones' comments are counted: an issue comment and a line comment on #2.
  assert.equal(r.store.prs.find((p) => p.number === 2).comments, 2);
  assert.equal(r.store.prs.find((p) => p.number === 7).comments, 0);
  assert.ok(existsSync(t.engine.storePath(t.repo)));

  // Again at once: adopted, no gh call.
  t.clear();
  const again = await t.engine.check({ cwd: t.repo, on: null });
  assert.equal(again.ran, false);
  assert.deepEqual(t.calls(), []);

  // Forced: the merged head keeps its stored checks; nothing to count again.
  const forced = await t.engine.check({ cwd: t.repo, on: null }, { force: true });
  assert.equal(forced.ran, true);
  assert.deepEqual(heads(t.calls()), ["b"]);
  assert.equal(t.calls().filter((c) => c[0] === "api").length, 0);
});

const TEXT_FIELDS = "number,url,title,state,isDraft,reviewDecision,statusCheckRollup,mergedAt,updatedAt,additions,deletions,baseRefName,headRefName";

test("a pull request once found is remembered when its branch and listing move on", async () => {
  await t.engine.check({ cwd: t.repo, on: null });
  t.fixture((f) => ({ ...f, prs: f.prs.filter((p) => p.number !== 1) }));
  const r = await t.engine.check({ cwd: t.repo, on: null }, { force: true });
  assert.deepEqual(r.store.prs.map((p) => p.number), [7, 2, 1]);
});

test("a session's new pull request in prs.jsonl is looked up by number", async () => {
  await t.engine.check({ cwd: t.repo, on: null });
  t.fixture((f) => ({ ...f, prs: [...f.prs, gh(9, "elsewhere", { state: "MERGED", mergedAt: "2026-11-08T12:00:00Z" })] }));
  const line = JSON.stringify({ at: "x", sessionId: "s", cwd: t.repo, url: "https://github.com/o/r/pull/9", owner: "o", repo: "r", number: 9 });
  writeFileSync(join(t.home, "curfew", "prs.jsonl"), `${readFileSync(join(t.home, "curfew", "prs.jsonl"), "utf8")}${line}\n`);
  t.clear();
  const r = await t.engine.check({ cwd: t.repo, on: null }, { force: true });
  assert.deepEqual(r.store.prs.map((p) => p.number), [9, 7, 2, 1]);
  assert.ok(t.calls().some((c) => c[1] === "view" && c[2] === "9"));
});

test("without prs.jsonl, the branches still answer", async () => {
  execFileSync("rm", [join(t.home, "curfew", "prs.jsonl")]);
  const r = await t.engine.check({ cwd: t.repo, on: null });
  assert.deepEqual(r.store.prs.map((p) => p.number), [2, 1]);
});

test("gh failing keeps the stored pull requests and says why", async () => {
  await t.engine.check({ cwd: t.repo, on: null });
  t.fixture((f) => ({ ...f, fail: "HTTP 502: Bad Gateway (https://api.github.com/graphql)" }));
  const r = await t.engine.check({ cwd: t.repo, on: null }, { force: true });
  assert.equal(r.store.error, "HTTP 502: Bad Gateway (https://api.github.com/graphql)");
  assert.deepEqual(r.store.prs.map((p) => p.number), [7, 2, 1]);
});

test("gh missing says so", async () => {
  process.env.PATH = WITHOUT_GH;
  const r = await t.engine.check({ cwd: t.repo, on: null });
  assert.equal(r.store.error, NO_GH);
});

test("a folder outside git is not a repository", async () => {
  const r = await t.engine.check({ cwd: t.home, on: null });
  assert.equal(r.here, null);
});

test("the detail's conversation and files", async () => {
  const { here, store } = await t.engine.check({ cwd: t.repo, on: null });
  const pr = store.prs.find((p) => p.number === 2);
  const thread = await t.engine.fetchThread(here, pr);
  assert.deepEqual(thread.map((e) => [e.kind, e.author]), [["comment", "ann"], ["line", "bob"]]);
  assert.deepEqual(await t.engine.fetchFiles(here, pr), [{ path: "x.js", from: null, status: "modified", additions: 2, deletions: 1 }]);
});

test("check.mjs prints the worktree and its open and draft count, as the strip reads it", async () => {
  const out = await main([t.repo], nodeHost(t.home));
  assert.deepEqual([out.root, out.open, out.ran], [t.repo, 2, true]);
  assert.deepEqual((await main([t.repo], nodeHost(t.home))).ran, false);
  const printed = JSON.parse(execFileSync(process.execPath, [join(FAKES, "..", "check.mjs"), t.repo], { encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: t.home } }));
  assert.deepEqual([printed.root, printed.open], [t.repo, 2]);
});
