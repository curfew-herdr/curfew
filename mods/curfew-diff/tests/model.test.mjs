// node --test ~/.config/herdr-app/mods/curfew-diff/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../model.js";
import { wordChanges, wrapBreaks, wrapTokens } from "../vendor.js";

const PATCH = [
  "diff --git a/src/app.js b/src/app.js",
  "index 1111111..2222222 100644",
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -1,4 +1,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " const d = 5;",
  " const e = 6;",
  "@@ -40,3 +41,3 @@ function tail() {",
  "   one();",
  "-  two();",
  "+  three();",
  "   four();",
  "diff --git a/docs/old name.md b/docs/new name.md",
  "similarity index 90%",
  "rename from docs/old name.md",
  "rename to docs/new name.md",
  "diff --git a/img.png b/img.png",
  "new file mode 100644",
  "index 0000000..3333333",
  "Binary files /dev/null and b/img.png differ",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-bye",
  "-now",
  "\\ No newline at end of file",
  "",
].join("\n");

const node = (over) => ({
  id: "T1", path: "src/app.js", line: 2, originalLine: 2, diffSide: "RIGHT", isResolved: false, isOutdated: false,
  comments: { nodes: [{ author: { login: "ana" }, body: "Why **3**?", createdAt: "2026-11-08T10:00:00Z", url: "u" }] },
  ...over,
});

test("parsePatch reads files, statuses, renames, binaries and numbered lines", () => {
  const files = M.parsePatch(PATCH);
  assert.deepEqual(files.map((f) => [f.path, f.status, f.add, f.del]), [
    ["src/app.js", "modified", 3, 2],
    ["docs/new name.md", "renamed", 0, 0],
    ["img.png", "added", 0, 0],
    ["gone.txt", "deleted", 0, 2],
  ]);
  const [app, renamed, image, gone] = files;
  assert.equal(renamed.from, "docs/old name.md");
  assert.equal(image.binary, true);
  assert.equal(gone.hunks[0].lines.length, 2, "the no-newline marker is not a line");
  assert.deepEqual(app.hunks.map((h) => [h.oldStart, h.newStart, h.newCount, h.fn]), [[1, 1, 5, ""], [40, 41, 3, "function tail() {"]]);
  assert.deepEqual(app.hunks[0].lines.map((l) => [l.kind, l.old, l.new]), [
    ["ctx", 1, 1], ["del", 2, null], ["add", null, 2], ["add", null, 3], ["ctx", 3, 4], ["ctx", 4, 5],
  ]);
  assert.equal(app.hunks[0].lines[1].pair, "const b = 3;", "a removed line pairs with the line it became");
  assert.equal(app.hunks[0].lines[3].pair, undefined, "an added line past the run has no pair");
  assert.deepEqual(M.parsePatch(""), []);
});

test("splitPairs puts a removed line beside the added line it became", () => {
  const [app] = M.parsePatch(PATCH);
  const pairs = M.splitPairs(app.hunks[0].lines);
  assert.deepEqual(pairs.map((p) => [p.l?.old ?? null, p.r?.new ?? null]), [[1, 1], [2, 2], [null, 3], [3, 4], [4, 5]]);
});

test("threads map to their side and line, as que places them", () => {
  const files = M.parsePatch(PATCH);
  const threads = [
    M.threadOf(node({})),
    M.threadOf(node({ id: "T2", line: null, originalLine: 42, isOutdated: true })), // outdated: its original line
    M.threadOf(node({ id: "T3", line: 2, diffSide: "LEFT" })), // the removed line 2
    M.threadOf(node({ id: "T4", line: 900 })), // not in the diff: under the file head
    M.threadOf(node({ id: "T5", path: "elsewhere.go" })),
  ];
  assert.equal(threads[1].line, 42);
  assert.equal(threads[2].side, "old");
  const placed = M.placeThreads(files, threads);
  const app = placed.files.get("src/app.js");
  assert.deepEqual([...app.at.keys()].sort(), ["new:2", "new:42", "old:2"]);
  assert.deepEqual(app.unplaced.map((t) => t.id), ["T4"]);
  assert.deepEqual(placed.elsewhere.map((t) => t.id), ["T5"]);
  const line = files[0].hunks[0].lines[2]; // + const b = 3; (new 2)
  assert.deepEqual(M.threadsAt(app, line).map((t) => t.id), ["T1"]);
  const ctx = files[0].hunks[1].lines[0]; // context old 40 / new 41
  assert.deepEqual(M.lineKeys(ctx), ["new:41", "old:40"]);
});

test("threadsOf reads a GraphQL answer and drops threads without comments", () => {
  const answer = { data: { repository: { pullRequest: { reviewThreads: { nodes: [node({}), node({ id: "E", comments: { nodes: [] } })] } } } } };
  const [t, ...rest] = M.threadsOf(answer);
  assert.equal(rest.length, 0);
  assert.deepEqual([t.id, t.resolved, t.outdated, t.comments[0].author], ["T1", false, false, "ana"]);
});

test("the thread filter keeps just the hunks with review threads", () => {
  const files = M.parsePatch(PATCH);
  const placed = M.placeThreads(files, [M.threadOf(node({ line: 42 }))]);
  const app = placed.files.get("src/app.js");
  assert.equal(M.hunkHasThreads(files[0].hunks[0], app), false);
  assert.equal(M.hunkHasThreads(files[0].hunks[1], app), true);
  const { rows } = M.buildRows(files, { mode: "unified", width: 900, placed, only: true });
  assert.deepEqual(rows.filter((r) => r.t === "file").map((r) => r.file.path), ["src/app.js"], "files without threads go");
  assert.ok(rows.every((r) => r.t !== "line" || r.line.new === null || r.line.new >= 41), "the first hunk is gone");
  const gap = rows.find((r) => r.t === "gap");
  assert.equal(gap.skipped, true);
  assert.equal(gap.count, 40);
});

test("buildRows: heights, file and thread indexes, closing, hiding and split", () => {
  const files = M.parsePatch(PATCH);
  const placed = M.placeThreads(files, [M.threadOf(node({})), M.threadOf(node({ id: "T9", line: 900 }))]);
  const all = M.buildRows(files, { mode: "unified", width: 900, placed });
  assert.equal(all.rows.length, all.sizes.length);
  assert.equal(all.rows[all.fileAt.get("src/app.js")].t, "file");
  assert.equal(all.rows[all.fileAt.get("src/app.js")].threads, 2);
  const at = all.threadAt.get("T1");
  assert.equal(all.rows[at - 1].line.new, 2, "a thread sits under its line");
  assert.equal(all.rows[at + 1].t, "tbody");
  assert.equal(all.rows[all.fileAt.get("src/app.js") + 1].thread.id, "T9", "an unplaced thread sits under its file head");
  assert.deepEqual(all.rows.filter((r) => r.t === "note").map((r) => r.text), ["Renamed, no lines changed.", "Binary file."]);
  assert.equal(all.rows.find((r) => r.t === "gap" && r.fn).count, 35, "lines between hunks, in the new file");

  const closed = M.buildRows(files, { mode: "unified", width: 900, placed, closedThreads: new Set(["T1"]) });
  const head = closed.rows[closed.threadAt.get("T1")];
  assert.equal(head.closed, true);
  assert.equal(closed.sizes[closed.threadAt.get("T1")], M.HEAD_GAP + M.HEAD_H + M.TAIL_GAP);
  assert.notEqual(closed.rows[closed.threadAt.get("T1") + 1]?.t, "tbody");

  const hidden = M.buildRows(files, { mode: "unified", width: 900, placed, hide: true });
  assert.equal(hidden.rows.some((r) => r.t === "thead" || r.t === "tbody"), false);

  const folded = M.buildRows(files, { mode: "unified", width: 900, placed, closedFiles: new Set(["src/app.js"]) });
  assert.equal(folded.rows[folded.fileAt.get("src/app.js") + 1].t, "file");

  const split = M.buildRows(files, { mode: "split", width: 900, placed });
  assert.equal(split.rows.filter((r) => r.t === "pair" && r.path === "src/app.js").length, 8);
  assert.equal(split.rows[split.threadAt.get("T1") - 1].pair.r.new, 2);
});

test("wrapping makes a long line taller, in both layouts", () => {
  const long = `+${"word ".repeat(60)}`;
  const files = M.parsePatch(["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,0 +1,1 @@", long].join("\n"));
  const narrow = M.buildRows(files, { mode: "unified", width: 400, wrap: true });
  const line = narrow.rows.find((r) => r.t === "line");
  assert.ok(line.wraps.length >= 2);
  assert.equal(narrow.sizes[narrow.rows.indexOf(line)], M.LINE_H * (1 + line.wraps.length));
  const off = M.buildRows(files, { mode: "unified", width: 400, wrap: false });
  assert.equal(off.sizes[off.rows.findIndex((r) => r.t === "line")], M.LINE_H);
  assert.equal(off.widest, 300);
  assert.ok(M.codeColumns(900, "split") < M.codeColumns(900, "unified"));
});

test("comment bodies: markdown laid out to lines with known heights", () => {
  const md = "Intro with `code` and **bold** and a [link](https://x.y).\n\n- one\n- two\n\n> quoted\n\n```suggestion\nreturn x\n```\n<!-- hidden -->";
  const lines = M.layoutBody(md, 400);
  assert.deepEqual(lines.map((l) => l.kind), ["text", "blank", "text", "text", "blank", "quote", "blank", "label", "code"]);
  assert.deepEqual(lines[0].spans.map((s) => s.s), ["", "code", "", "b", "", "link", ""]);
  assert.equal(lines[2].spans[0].text, "• one");
  assert.equal(lines[7].spans[0].text, "Suggested change");
  const narrow = M.layoutBody("word ".repeat(80), 200);
  assert.ok(narrow.length > 5);
  for (const l of narrow) assert.ok(M.textWidth(l.spans.map((s) => s.text).join(""), "") <= 200 + 1);
  const t = M.threadOf(node({ comments: { nodes: [{ author: { login: "a" }, body: "one" }, { author: { login: "b" }, body: "two" }] } }));
  const laid = M.layoutThread(t, 400);
  assert.equal(laid.height, M.BODY_PAD + M.BODY_LINE + M.SEP_H + M.WHO_H + M.BODY_LINE + M.BODY_PAD + M.TAIL_GAP);
  assert.equal(M.excerpt("**Nit:** use `x`\n\nmore"), "Nit: use x more");
});

test("one file without its header, as a diff tab draws it", () => {
  const [app, , , gone] = M.parsePatch(PATCH);
  const placed = M.placeThreads([app], [M.threadOf(node({})), M.threadOf(node({ id: "T9", line: 900 })), M.threadOf(node({ id: "T5", path: "elsewhere.go" }))]);
  const one = M.buildRows([app], { mode: "unified", width: 900, placed, header: false });
  assert.equal(one.rows.some((r) => r.t === "file"), false, "no header row");
  assert.equal(one.fileAt.size, 0);
  assert.equal(one.rows[0].thread.id, "T9", "a thread off the diff's lines comes first");
  assert.equal(one.rows[one.threadAt.get("T1") - 1].line.new, 2, "a thread sits under its line");
  assert.equal(one.threadAt.has("T5"), false, "another file's threads are not this tab's");
  const closed = M.buildRows([app], { mode: "unified", width: 900, placed, header: false, closedFiles: new Set(["src/app.js"]) });
  assert.equal(closed.rows.length, one.rows.length, "without a header the file can't be closed");
  assert.deepEqual(M.buildRows([gone], { mode: "split", width: 900, header: false }).rows.filter((r) => r.t === "pair").map((r) => r.pair.l.text), ["bye", "now"]);
});

test("a file without hunks says why", () => {
  const files = M.parsePatch(["diff --git a/a.js b/a.js", "index 1111111..2222222 100644", "--- a/a.js", "+++ b/a.js", ""].join("\n"));
  const note = (opts) => M.buildRows(files, { width: 900, header: false, ...opts }).rows.map((r) => r.text);
  assert.deepEqual(note({}), ["No lines changed."]);
  assert.deepEqual(note({ ignoredWhitespace: true }), ["Only whitespace changed."]);
  assert.deepEqual(M.buildRows([], { width: 900, header: false }).rows, [], "no file, no rows: the tab says there are no changes");
});

test("ages, paths", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  assert.equal(M.formatAge("2026-11-08T10:00:00Z", now), "2h ago");
  assert.equal(M.formatAge("2026-11-05T12:00:00Z", now), "3d ago");
  assert.equal(M.relativeFile("a.js", "/r/sub", "/r", "sub/"), "sub/a.js");
  assert.equal(M.relativeFile("/r/sub/a.js", "/r/sub", "/r", "sub/"), "sub/a.js");
  assert.equal(M.relativeFile("/tmp/r/a.js", "/tmp/r", "/private/tmp/r", ""), "a.js");
});

test("vendored helpers: word marks and wrapping", () => {
  assert.deepEqual(wordChanges("return first + count;", "return second + count;"), { old: [{ start: 7, end: 12 }], next: [{ start: 7, end: 13 }] });
  assert.deepEqual(wrapBreaks("const value = 42;", 8), [6, 14]);
  assert.deepEqual([...wrapBreaks('\t"github.com/cli/internal/config"', 20, 6)], [17, 31], "never a row of indent alone");
  assert.deepEqual(wrapTokens([{ text: "abcde", kind: "string" }], [2]), [[{ text: "ab", kind: "string" }], [{ text: "cde", kind: "string" }]]);
});
