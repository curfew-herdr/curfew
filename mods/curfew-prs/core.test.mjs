// node --test ~/.config/herdr-app/mods/curfew-prs/core.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "./core.mjs";

// ---- branch history ----------------------------------------------------------------------------

test("reflogBranches lists every branch checked out, oldest first, without detached checkouts", () => {
  const out = [
    "checkout: moving from fix-b to fix-c",
    "commit: more",
    "checkout: moving from 1a2b3c4d to fix-b",
    "checkout: moving from fix-a to 1a2b3c4d",
    "checkout: moving from HEAD~2 to fix-a",
    "checkout: moving from hazel to fix-a",
    "reset: moving to HEAD",
  ].join("\n");
  assert.deepEqual(core.reflogBranches(out), ["hazel", "fix-a", "fix-b", "fix-c"]);
});

test("reflogBranches follows a rename, and drops the old name when the new one is already there", () => {
  const renamed = ["Branch: renamed refs/heads/wip to refs/heads/feature", "checkout: moving from main to wip"].join("\n");
  assert.deepEqual(core.reflogBranches(renamed), ["main", "feature"]);
  const twice = ["Branch: renamed refs/heads/a to refs/heads/b", "checkout: moving from a to b"].join("\n");
  assert.deepEqual(core.reflogBranches(twice), ["b"]);
  assert.deepEqual(core.reflogBranches(""), []);
});

test("headsOf puts the current branch last and leaves out the default branch and a detached HEAD", () => {
  assert.deepEqual(core.headsOf(["main", "a", "b"], "c", ["main"]), ["a", "b", "c"]);
  assert.deepEqual(core.headsOf(["a", "b"], "a", ["main"]), ["a", "b"]);
  assert.deepEqual(core.headsOf(["a"], "HEAD", ["main"]), ["a"]);
  assert.deepEqual(core.headsOf([], "main", ["main"]), []);
});

// ---- repositories, URLs, sessions -------------------------------------------------------------

test("githubRepo reads https, ssh and scp remotes and nothing else", () => {
  const q = { owner: "queapp-org", name: "que" };
  assert.deepEqual(core.githubRepo("https://github.com/queapp-org/que.git"), q);
  assert.deepEqual(core.githubRepo("git@github.com:queapp-org/que.git\n"), q);
  assert.deepEqual(core.githubRepo("ssh://git@github.com/queapp-org/que"), q);
  assert.equal(core.githubRepo("https://gitlab.com/a/b.git"), null);
  assert.equal(core.githubRepo(""), null);
});

test("prUrl splits a pull request URL", () => {
  assert.deepEqual(core.prUrl("https://github.com/queapp-org/que/pull/340"), { owner: "queapp-org", name: "que", number: 340 });
  assert.equal(core.prUrl("https://github.com/queapp-org/que/issues/3"), null);
});

test("ownerRoot picks the deepest worktree holding a path, with macOS's /private folded", () => {
  const roots = ["/r/que", "/r/que/.claude/worktrees/a", "/private/tmp/x"];
  assert.equal(core.ownerRoot("/r/que/src", roots), "/r/que");
  assert.equal(core.ownerRoot("/r/que/.claude/worktrees/a/src", roots), "/r/que/.claude/worktrees/a");
  assert.equal(core.ownerRoot("/r/que/.claude/worktrees/a", roots), "/r/que/.claude/worktrees/a");
  assert.equal(core.ownerRoot("/r/quest", roots), null);
  assert.equal(core.ownerRoot("/tmp/x/deep", roots), "/private/tmp/x");
});

const line = (o) => JSON.stringify({ at: "2026-11-08T12:00:00Z", sessionId: "s1", ...o });

test("decodeLogLine reads a hook line, filling owner, name or number from the URL", () => {
  assert.deepEqual(
    core.decodeLogLine(line({ cwd: "/w", url: "https://github.com/o/r/pull/7", owner: "o", repo: "r", number: 7 })),
    { at: "2026-11-08T12:00:00Z", sessionId: "s1", cwd: "/w", owner: "o", name: "r", number: 7, url: "https://github.com/o/r/pull/7" },
  );
  assert.equal(core.decodeLogLine(line({ cwd: "/w", url: "https://github.com/o/r/pull/8" })).number, 8);
  assert.equal(core.decodeLogLine(line({ cwd: "/w", repo: "o/r", number: 9 })).owner, "o");
  assert.equal(core.decodeLogLine("{not json"), null);
  assert.equal(core.decodeLogLine(line({ url: "https://github.com/o/r/pull/7" })), null);
  assert.equal(core.decodeLogLine(line({ cwd: "/w", owner: "o", repo: "r" })), null);
});

test("sessionPrs keeps this worktree's lines on its repository, each number once", () => {
  const text = [
    line({ cwd: "/r/que", owner: "o", repo: "que", number: 1, url: "https://github.com/o/que/pull/1" }),
    line({ cwd: "/r/que/src", owner: "O", repo: "Que", number: 2, url: "https://github.com/O/Que/pull/2" }),
    line({ cwd: "/r/que/.claude/worktrees/a", owner: "o", repo: "que", number: 3, url: "https://github.com/o/que/pull/3" }),
    line({ cwd: "/r/que", owner: "o", repo: "website", number: 4, url: "https://github.com/o/website/pull/4" }),
    line({ cwd: "/r/que", owner: "o", repo: "que", number: 1, url: "https://github.com/o/que/pull/1" }),
    "",
    "garbage",
    line({ cwd: "/elsewhere", owner: "o", repo: "que", number: 5 }),
  ].join("\n");
  const repos = [{ owner: "o", name: "que" }];
  const others = ["/r/que/.claude/worktrees/a"];
  assert.deepEqual(core.sessionPrs(text, "/r/que", others, repos).map((e) => e.number), [1, 2]);
  assert.deepEqual(core.sessionPrs(text, "/r/que/.claude/worktrees/a", ["/r/que"], repos).map((e) => e.number), [3]);
  assert.deepEqual(core.sessionPrs(null, "/r/que", [], repos), []);
});

test("sessionPrs reads a prs.jsonl file the way the mod does", () => {
  const dir = mkdtempSync(join(tmpdir(), "curfew-prs-"));
  const file = join(dir, "prs.jsonl");
  writeFileSync(file, `${line({ cwd: `${dir}/wt`, owner: "o", repo: "r", number: 12, url: "https://github.com/o/r/pull/12" })}\n`);
  const found = core.sessionPrs(readFileSync(file, "utf8"), `${dir}/wt`, [], [{ owner: "o", name: "r" }]);
  assert.deepEqual(found.map((e) => e.url), ["https://github.com/o/r/pull/12"]);
});

test("worktreeRoots reads git worktree list --porcelain", () => {
  const out = "worktree /a\nHEAD 123\nbranch refs/heads/main\n\nworktree /b c\nHEAD 456\ndetached\n";
  assert.deepEqual(core.worktreeRoots(out), ["/a", "/b c"]);
});

// ---- gh output and pull request state ------------------------------------------------------------

const run = (name, o = {}) => ({ __typename: "CheckRun", name, workflowName: "CI", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-08T10:00:00Z", completedAt: "2026-11-08T10:01:00Z", detailsUrl: `https://x/${name}`, ...o });
const gh = (number, o = {}) => ({ number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, state: "OPEN", isDraft: false, reviewDecision: "", mergedAt: null, updatedAt: "2026-11-08T10:00:00Z", additions: 3, deletions: 1, baseRefName: "main", headRefName: `b${number}`, ...o });

test("decodePullRequest reads gh's fields and tells a listing without a rollup apart", () => {
  const listed = core.decodePullRequest(gh(5));
  assert.equal(listed.checks, null);
  const viewed = core.decodePullRequest(gh(5, { statusCheckRollup: [run("lint"), { __typename: "StatusContext", context: "ci/x", state: "PENDING" }, 7] }));
  assert.equal(viewed.checks.length, 2);
  assert.equal(core.decodePullRequest({ number: 1 }), null);
  assert.deepEqual(core.decodePullRequests([gh(1), null, { url: "x" }]).map((p) => p.number), [1]);
});

test("checkRunsOf collapses a re-run to its newest and sorts failing first", () => {
  const runs = core.checkRunsOf([
    run("test", { conclusion: "FAILURE", startedAt: "2026-11-08T09:00:00Z" }),
    run("test", { startedAt: "2026-11-08T11:00:00Z" }),
    run("build", { status: "IN_PROGRESS", conclusion: "" }),
    run("lint", { conclusion: "TIMED_OUT" }),
    run("docs", { conclusion: "SKIPPED" }),
  ].map((c) => core.decodePullRequest(gh(1, { statusCheckRollup: [c] })).checks[0]));
  assert.deepEqual(runs.map((c) => [c.name, c.state]), [["lint", "failing"], ["build", "pending"], ["test", "passing"], ["docs", "skipped"]]);
});

test("parsePullRequest maps state, review and checks, keeping stored checks and counts for a listing", () => {
  const at = "2026-11-08T12:00:00Z";
  const fresh = core.parsePullRequest(core.decodePullRequest(gh(3, { isDraft: true, reviewDecision: "APPROVED", statusCheckRollup: [run("t")] })), at);
  assert.equal(fresh.state, "draft");
  assert.equal(fresh.review, "approved");
  assert.equal(fresh.checks, "passing");
  const stored = [{ ...fresh, state: "merged", checks: "failing", checkRuns: [{ name: "x", state: "failing" }], comments: 4, commentedAt: at, commentsFor: "u" }];
  const listed = core.parsePullRequest(core.decodePullRequest(gh(3, { state: "MERGED", mergedAt: at })), at, stored);
  assert.equal(listed.state, "merged");
  assert.equal(listed.checks, "failing");
  assert.equal(listed.comments, 4);
  assert.equal(core.parsePullRequest(core.decodePullRequest(gh(4, { state: "CLOSED" })), at).state, "closed");
});

const pr = (number, o = {}) => ({ number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, state: "open", checks: "none", review: null, checkRuns: [], updatedAt: "u1", additions: 1, deletions: 0, base: "main", head: `b${number}`, comments: null, commentedAt: null, commentsFor: null, ...o });

test("pullRequestList remembers a pull request whose branch moved on, the fresh copy winning", () => {
  const stored = [pr(1, { title: "old" }), pr(2)];
  const list = core.pullRequestList([pr(1, { title: "new" }), pr(3)], stored);
  assert.deepEqual(list.map((p) => [p.number, p.title]), [[3, "PR 3"], [2, "PR 2"], [1, "new"]]);
  const many = Array.from({ length: 25 }, (_, i) => pr(i + 1));
  assert.equal(core.pullRequestList(many).length, core.PR_LIST_CAP);
  assert.equal(core.pullRequestList(many)[0].number, 25);
});

test("planHeads asks for checks only where an open or draft pull request is, or the listing cannot say", () => {
  const listing = core.groupByHead([gh(1, { headRefName: "a" }), gh(2, { headRefName: "b", state: "MERGED", mergedAt: "t" }), gh(3, { headRefName: "c", state: "CLOSED" }), { number: 9 }]);
  const stored = [pr(2, { state: "merged", checks: "passing" }), pr(3, { state: "open" })];
  const plan = core.planHeads(["a", "b", "c", "d"], listing, stored, false);
  assert.deepEqual(plan.ask, ["a", "c"]);
  assert.deepEqual(plan.settled.map((p) => p.number), [2]);
  assert.deepEqual(core.planHeads(["a", "d"], null, [], false).ask, ["a", "d"]);
  assert.deepEqual(core.planHeads(["d"], { ...listing, full: true }, [], false).ask, ["d"]);
  const pending = [pr(2, { state: "merged", checks: "pending" })];
  assert.deepEqual(core.planHeads(["b"], listing, pending, false).ask, []);
  assert.deepEqual(core.planHeads(["b"], listing, pending, true).ask, ["b"]);
});

test("groupByHead says when the page was full", () => {
  const items = Array.from({ length: core.LIST_LIMIT }, (_, i) => gh(i + 1));
  assert.equal(core.groupByHead(items).full, true);
  assert.equal(core.groupByHead(items.slice(1)).full, false);
});

test("linkedPlan looks up session pull requests not on the branches, reusing settled ones until due", () => {
  const created = [{ number: 1 }, { number: 2 }, { number: 3 }, { number: 3 }];
  const stored = [pr(2, { state: "merged" }), pr(3)];
  const plan = core.linkedPlan(created, [pr(1)], stored, false);
  assert.deepEqual(plan.lookUp.map((e) => e.number), [3]);
  assert.deepEqual(plan.reuse.map((p) => p.number), [2]);
  assert.deepEqual(core.linkedPlan(created, [pr(1)], stored, true).lookUp.map((e) => e.number), [2, 3]);
});

test("reposOf names the repositories a listing is on", () => {
  assert.deepEqual(core.reposOf([pr(1), pr(2), { url: "https://github.com/O/R/pull/3" }, { url: "x" }]), [{ owner: "o", name: "r" }]);
});

// ---- comments ----------------------------------------------------------------------------------

test("parseThread joins comments, reviews and line comments oldest first, without empty review wrappers", () => {
  const view = {
    comments: [{ id: "c1", author: { login: "ann" }, body: "hi", createdAt: "2026-11-08T03:00:00Z", url: "u1" }],
    reviews: [
      { id: "r1", author: { login: "bob" }, body: "", state: "COMMENTED", submittedAt: "2026-11-08T01:00:00Z" },
      { id: "r2", author: { login: "bob" }, body: "fix it", state: "CHANGES_REQUESTED", submittedAt: "2026-11-08T02:00:00Z" },
    ],
  };
  const lines = [{ id: 7, user: { login: "cy" }, body: "here", created_at: "2026-11-08T00:30:00Z", path: "a.js", line: null, original_line: 4, html_url: "u3" }];
  const entries = core.parseThread(view, lines);
  assert.deepEqual(entries.map((e) => [e.kind, e.author, e.state]), [["line", "cy", null], ["review", "bob", "changes_requested"], ["comment", "ann", null]]);
  assert.equal(entries[0].line, 4);
  assert.deepEqual(core.commentCounts(entries), { comments: 3, commentedAt: "2026-11-08T03:00:00Z" });
  assert.deepEqual(core.parseThread(null, null), []);
});

test("needsCount and withCounts count an open pull request's comments once per updatedAt", () => {
  const p = pr(1, { updatedAt: "u2", commentsFor: "u1" });
  assert.equal(core.needsCount(p), true);
  assert.equal(core.needsCount(pr(1, { state: "merged" })), false);
  const [counted] = core.withCounts([p], 1, [{ at: "t1" }, { at: "t2" }], "u2");
  assert.deepEqual([counted.comments, counted.commentedAt, counted.commentsFor], [2, "t2", "u2"]);
  assert.equal(core.needsCount(counted), false);
});

test("jsonPages and pagedItems join gh api --paginate output", () => {
  assert.deepEqual(core.pagedItems('[{"a":"]"}]\n[{"b":2}]'), [{ a: "]" }, { b: 2 }]);
  assert.throws(() => core.jsonPages("[1] x"));
});

test("decodeFiles reads the REST file list", () => {
  assert.deepEqual(core.decodeFiles([{ filename: "b.js", previous_filename: "a.js", status: "renamed", additions: 2, deletions: 1 }, 3]), [
    { path: "b.js", from: "a.js", status: "renamed", additions: 2, deletions: 1 },
  ]);
  assert.deepEqual([core.fileGlyph("added").glyph, core.fileGlyph("removed").tone, core.fileGlyph("modified").glyph], ["A", "bad", "M"]);
});

// ---- storage -----------------------------------------------------------------------------------

test("storeName is stable per worktree and tells two of the same name apart", () => {
  assert.equal(core.storeName("/a/que/"), core.storeName("/a/que"));
  assert.notEqual(core.storeName("/a/que"), core.storeName("/b/que"));
  assert.match(core.storeName("/a/que"), /^que-[0-9a-f]{8}\.json$/);
});

test("parseStore reads garbage as an empty worktree and round-trips its own text", () => {
  assert.deepEqual(core.parseStore("nope").prs, []);
  assert.deepEqual(core.parseStore(null).branches, []);
  const s = { ...core.parseStore(""), root: "/w", branches: ["a"], prs: [pr(1)], seen: { 1: "t" } };
  assert.deepEqual(core.parseStore(core.storeText(s)), s);
});

test("isFresh, isClaimed and isDue read the stored times", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const s = { ...core.parseStore(""), checkedAt: "2026-11-08T11:59:00Z", claim: "2026-11-08T11:58:00Z", settledAt: "2026-11-08T11:55:00Z" };
  assert.equal(core.isFresh(s, now, 100_000), true);
  assert.equal(core.isFresh(s, now, 30_000), false);
  assert.equal(core.isClaimed(s, now, 90_000), false);
  assert.equal(core.isClaimed(s, now, 180_000), true);
  assert.equal(core.isDue(s, now, 750_000), false);
  assert.equal(core.isDue(core.parseStore(""), now, 750_000), true);
});

test("settle merges the branch and session sources over the remembered pull requests", () => {
  const store = { ...core.parseStore(""), branches: ["a"], prs: [pr(1, { title: "remembered" }), pr(2, { title: "stale" })], seen: { 2: "t" }, claim: "c" };
  const r = { root: "/w", repo: "o/r", branches: ["a", "b"], onBranch: [pr(2, { title: "fresh" })], linked: [pr(5)], checkedAt: "t1", due: true, error: null };
  const next = core.settle(store, r);
  assert.deepEqual(next.prs.map((p) => [p.number, p.title]), [[5, "PR 5"], [2, "fresh"], [1, "remembered"]]);
  assert.deepEqual([next.branches, next.settledAt, next.claim, next.seen], [["a", "b"], "t1", null, { 2: "t" }]);
  const failed = core.settle(store, { ...r, error: "gh: offline" });
  assert.deepEqual(failed.prs.map((p) => p.title), ["stale", "remembered"]);
  assert.deepEqual([failed.error, failed.settledAt, failed.checkedAt], ["gh: offline", null, "t1"]);
});

// ---- the list ----------------------------------------------------------------------------------

test("orderPrs and prCounts: open and draft first, newest first, then settled", () => {
  const prs = [pr(1, { state: "merged" }), pr(4, { state: "draft", checks: "failing" }), pr(2), pr(3, { state: "closed" })];
  const { active, settled } = core.orderPrs(prs);
  assert.deepEqual(active.map((p) => p.number), [4, 2]);
  assert.deepEqual(settled.map((p) => p.number), [3, 1]);
  assert.deepEqual(core.prCounts(prs), { open: 2, failing: 1 });
});

test("baseLabel names a stacked pull request's base by number, preferring an open one", () => {
  const prs = [pr(1, { head: "x", state: "merged" }), pr(2, { head: "x" }), pr(3, { base: "x" }), pr(4, { base: "main" })];
  assert.equal(core.baseLabel(prs[2], prs), "#2");
  assert.equal(core.baseLabel(prs[3], prs), "main");
  assert.equal(core.fromSubagent(pr(5, { head: "other" }), ["b5"]), true);
  assert.equal(core.fromSubagent(pr(5), ["b5"]), false);
});

test("checks: groups, counts, the row's line and the dot", () => {
  const runs = [{ name: "a", state: "passing" }, { name: "b", state: "failing" }, { name: "c", state: "pending" }, { name: "d", state: "skipped" }];
  assert.deepEqual(core.checkGroups(runs).listed.map((c) => c.name), ["b", "c", "d"]);
  assert.deepEqual(core.checksCount(runs), { failing: 1, words: ["1 running", "1 passing", "1 skipped"] });
  assert.deepEqual(core.checksLine({ checkRuns: runs }), { tone: "bad", text: "✗ b · 1/3" });
  assert.deepEqual(core.checksLine({ checkRuns: runs.filter((c) => c.state !== "failing") }), { tone: "busy", text: "running 1/2" });
  assert.deepEqual(core.checksLine({ checkRuns: [runs[0]] }), { tone: "good", text: "✓ 1/1" });
  assert.equal(core.checksLine({ checkRuns: [runs[3]] }), null);
  assert.equal(core.prDot(pr(1, { state: "draft" })), "ring");
  assert.equal(core.prDot(pr(1, { state: "merged" })), "muted");
  assert.equal(core.prDot(pr(1, { checks: "failing" })), "bad");
  assert.equal(core.prDot(pr(1)), "neutral");
});

test("hasNewComments: any comment is new until opened, then only later ones", () => {
  assert.equal(core.hasNewComments(pr(1), undefined), false);
  assert.equal(core.hasNewComments(pr(1, { commentedAt: "t2" }), undefined), true);
  assert.equal(core.hasNewComments(pr(1, { commentedAt: "t2" }), "t2"), false);
  assert.equal(core.hasNewComments(pr(1, { commentedAt: "t3" }), "t2"), true);
});

test("formatAge and formatSpan write que's lengths of time", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  assert.equal(core.formatAge("2026-11-08T11:59:30Z", now, " ago"), "30s ago");
  assert.equal(core.formatAge("2026-11-08T09:00:00Z", now), "3h");
  assert.equal(core.formatAge("2026-11-01T12:00:00Z", now), "7d");
  assert.equal(core.formatAge(null, now), "-");
  assert.equal(core.formatSpan("2026-11-08T10:00:00Z", "2026-11-08T10:03:05Z"), "3m 05s");
  assert.equal(core.formatSpan("2026-11-08T10:00:00Z", null), "");
  assert.equal(core.firstLine("", "gh: Not Found (HTTP 404)\nmore"), "gh: Not Found (HTTP 404)");
});
