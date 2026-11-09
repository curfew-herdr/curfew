// Ported from que's src/daemon/comment-lines.test.ts, on hunks instead of whole-file tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { languageFor, markHunk, markFile, specFor, splitCounts, commentOnly, commentOnlyLast, countParts } from "../comments.js";
import { parsePatch } from "../model.js";

/** Every line of `source` as a changed line of `kind` in a file named `path`. */
function changed(source, path, kind = "add") {
  const lines = source.replace(/\n$/, "").split("\n").map((text, i) => ({ kind, old: kind === "del" ? i + 1 : null, new: kind === "add" ? i + 1 : null, text }));
  return markHunk({ lines }, specFor(path)).lines;
}
const marked = (lines) => lines.map((l) => [l.text, l.comment === true]);
const flags = (lines) => lines.map((l) => l.comment === true);

test("languages by name and extension, as que's", () => {
  assert.equal(languageFor("src/a.ts"), "typescript");
  assert.equal(languageFor("Dockerfile"), "docker");
  assert.equal(languageFor("tsconfig.base.json"), "jsonc");
  assert.equal(languageFor("data.json"), "json");
  assert.equal(languageFor("LICENSE"), null);
  assert.equal(specFor("data.json"), null, "json has no comments");
});

test("marks line comments, indented or not", () => {
  assert.deepEqual(marked(changed("// Retry the upload twice.\n  // Then give up.\n", "a.ts")), [
    ["// Retry the upload twice.", true], ["  // Then give up.", true],
  ]);
});

test("marks every line of a block comment, its inner lines included", () => {
  assert.deepEqual(flags(changed('/*\n  const notCode = "inside the comment"\n  retries = 3\n*/\n', "a.ts")), [true, true, true, true]);
});

test("marks a doc comment above the code it documents, but not the code", () => {
  assert.deepEqual(flags(changed("/**\n * How many times an upload is tried.\n * @default 3\n */\nexport const retries = 3\n", "a.ts")), [true, true, true, true, false]);
});

test("marks a Python comment and counts a docstring as code, since it is a string", () => {
  assert.deepEqual(marked(changed('def upload(path):\n    """Send the file, retrying twice."""\n    # Back off between tries.\n    return send(path)\n', "a.py")), [
    ["def upload(path):", false], ['    """Send the file, retrying twice."""', false], ["    # Back off between tries.", true], ["    return send(path)", false],
  ]);
  assert.deepEqual(flags(changed('"""\n# not a comment, a docstring\n"""\n', "a.py")), [false, false, false]);
});

test("marks a removed comment line", () => {
  assert.deepEqual(marked(changed("// Retries are fixed for now.\nexport const retries = 3\n", "a.ts", "del")), [
    ["// Retries are fixed for now.", true], ["export const retries = 3", false],
  ]);
});

test("treats code with a trailing comment as code", () => {
  assert.deepEqual(marked(changed("export const retries = 3 // twice is not enough\n", "a.ts")), [["export const retries = 3 // twice is not enough", false]]);
});

test("never marks a file with no language, even where its text looks like a comment", () => {
  assert.deepEqual(marked(changed("// Retry twice.\n", "notes.txt")), [["// Retry twice.", false]]);
});

test("leaves context lines unmarked", () => {
  const [line] = markHunk({ lines: [{ kind: "ctx", old: 1, new: 1, text: "// Retry twice." }] }, specFor("a.ts")).lines;
  assert.equal(line.comment, undefined);
});

test("counts a blank line between two comment lines as a comment line", () => {
  assert.deepEqual(flags(changed("// Retry twice.\n\n// Then give up.\n", "a.ts")), [true, true, true]);
});

test("counts a blank line between code lines, or between a comment and code, as code", () => {
  assert.deepEqual(flags(changed("const retries = 3\n\nconst backoffMs = 250\n// Jitter keeps clients apart.\n\nconst jitter = true\n", "a.ts")), [false, false, false, true, false, false]);
});

test("counts a blank line at the edge of a run as code", () => {
  assert.deepEqual(flags(changed("\n// Retry twice.\n", "a.ts")), [false, true]);
});

test("flags the comment lines of a patch, the context carrying a block open", () => {
  const [file] = parsePatch(["diff --git a/r.ts b/r.ts", "--- a/r.ts", "+++ b/r.ts", "@@ -1,4 +1,4 @@", " /*", "- * Retry once.", "+ * Retry twice.", "  */", "-export const retries = 1", "+export const retries = 3", ""].join("\n"));
  markFile(file);
  assert.deepEqual(file.hunks[0].lines.map((l) => [l.kind, l.comment === true]), [["ctx", false], ["del", true], ["add", true], ["ctx", false], ["del", false], ["add", false]]);
  assert.deepEqual(splitCounts(file), { codeAdditions: 1, codeDeletions: 1, commentAdditions: 1, commentDeletions: 1 });
});

test("a hunk that starts inside a block comment is found by the close nobody opened", () => {
  const lines = changed(" * the rest of a doc comment\n * and more of it\n */\nconst x = 1\n", "a.ts");
  assert.deepEqual(flags(lines), [true, true, true, false]);
});

test("other syntaxes: shell, SQL, Lua, markup; strings hide markers", () => {
  assert.deepEqual(flags(changed("# set up\necho $# args\n", "a.sh")), [true, false]);
  assert.deepEqual(flags(changed("-- totals\nSELECT 1;\n", "q.sql")), [true, false]);
  assert.deepEqual(flags(changed("--[[\nold code\n]]\nprint(1)\n", "a.lua")), [true, true, true, false]);
  assert.deepEqual(flags(changed("<!-- note -->\n# Title\n", "README.md")), [true, false]);
  assert.deepEqual(flags(changed('const url = "http://x" /* tail\nstill comment */ + y\n', "a.ts")), [false, false]);
});

test("comment-only files go last, and the counts split as que writes them", () => {
  const patch = (name, body) => [`diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`, "@@ -1,1 +1,2 @@", ...body].join("\n");
  const files = parsePatch([patch("a.ts", ["+// only a note", " x"]), patch("b.ts", ["+const y = 1", " x"])].join("\n")).map(markFile);
  assert.equal(commentOnly(files[0]), true);
  assert.equal(commentOnly(files[1]), false);
  const { code, commentOnly: only } = commentOnlyLast(files);
  assert.deepEqual([code.map((f) => f.path), only.map((f) => f.path)], [["b.ts"], ["a.ts"]]);
  const words = (parts) => parts.map((p) => [...p.items.map((i) => `${i.sign}${i.n}`), p.word].filter(Boolean).join(" ")).join(" ");
  assert.equal(words(countParts({ codeAdditions: 2, codeDeletions: 1, commentAdditions: 7, commentDeletions: 2 }, { add: 9, del: 3 })), "+2 −1 code · +7 −2 comments");
  assert.equal(words(countParts({ codeAdditions: 0, codeDeletions: 0, commentAdditions: 2, commentDeletions: 0 }, { add: 2, del: 0 })), "+2 comments");
  assert.equal(words(countParts({ codeAdditions: 3, codeDeletions: 0, commentAdditions: 0, commentDeletions: 0 }, { add: 3, del: 0 })), "+3 −0");
});

// Ported from que's src/renderer/src/diff-rows.test.ts ("comment lines"), on hunks only.
import { buildRows, hunkItems, runWords, lookOf, placeThreads, threadOf } from "../model.js";

/** Lines from a picture: ' ' context, '-' removed, '+' added, '<' a removed comment line, '>' an added one. */
function linesOf(picture, oldStart = 1, newStart = 1) {
  let o = oldStart, n = newStart;
  return [...picture].map((c, i) => {
    if (c === "<") return { kind: "del", old: o++, new: null, text: `  // note ${i}`, comment: true };
    if (c === ">") return { kind: "add", old: null, new: n++, text: `  // note ${i}`, comment: true };
    if (c === "-") return { kind: "del", old: o++, new: null, text: `  line ${i}` };
    if (c === "+") return { kind: "add", old: null, new: n++, text: `  line ${i}` };
    return { kind: "ctx", old: o++, new: n++, text: `  line ${i}` };
  });
}
const fileOf = (picture) => ({ path: "a.ts", status: "modified", binary: false, add: 0, del: 0, hunks: [{ oldStart: 1, newStart: 1, oldCount: 0, newCount: picture.length, fn: "", lines: linesOf(picture) }] });
const fold = (keepRemoved) => ({ mode: "fold", keepRemoved });
const kinds = (items) => items.map((it) => (it.run ? `run ${it.run.added}+${it.run.removed}-${it.run.open ? " open" : ""}` : `${it.line.kind}${it.line.old ?? ""}/${it.line.new ?? ""}`));

test("dim and show draw every line; dim marks comment lines, show draws them as code", () => {
  const h = fileOf(" <>> + ").hunks[0];
  for (const mode of ["dim", "show"]) assert.equal(hunkItems(h, "p", { mode, keepRemoved: true }).length, 7);
  assert.deepEqual(lookOf(h.lines[1], { mode: "dim", keepRemoved: true }), { dimmed: true, kept: false });
  assert.deepEqual(lookOf(h.lines[1], { mode: "show", keepRemoved: true }), { dimmed: false, kept: false });
  assert.deepEqual(lookOf(h.lines[0], { mode: "dim", keepRemoved: true }), { dimmed: false, kept: false });
});

test("fold: a run of added comment lines is one row with its line range", () => {
  const items = hunkItems(fileOf("  >>>+  ").hunks[0], "p", fold(true));
  assert.deepEqual(kinds(items), ["ctx1/1", "ctx2/2", "run 3+0-", "add/6", "ctx3/7", "ctx4/8"]);
  assert.deepEqual(items[2].run, { id: "c:p:2:5", open: false, pinned: false, added: 3, removed: 0, first: 3, last: 5 });
  assert.equal(runWords(items[2].run), "3 comment lines added");
});

test("fold: a removed run when removed comments are not kept, numbered in the old file", () => {
  const items = hunkItems(fileOf(" +<< ").hunks[0], "p", fold(false));
  assert.deepEqual(kinds(items), ["ctx1/1", "add/2", "run 0+2-", "ctx4/3"]);
  assert.deepEqual([items[2].run.first, items[2].run.last, runWords(items[2].run)], [2, 3, "2 comment lines removed"]);
});

test("fold: a mixed run counts both ways and is numbered by the lines it adds", () => {
  const [, , run] = hunkItems(fileOf(" -<>> ").hunks[0], "p", fold(false));
  assert.deepEqual(run.run, { id: "c:p:2:5", open: false, pinned: false, added: 2, removed: 1, first: 2, last: 3 });
  assert.equal(runWords(run.run), "3 comment lines changed");
});

test("fold: removed comment lines stay drawn (tagged) while they are kept", () => {
  const h = fileOf(" -<>> ").hunks[0];
  assert.deepEqual(kinds(hunkItems(h, "p", fold(true))), ["ctx1/1", "del2/", "del3/", "run 2+0-", "ctx4/4"]);
  assert.deepEqual(lookOf(h.lines[2], fold(true)), { dimmed: true, kept: true });
});

test("fold: a run opens in place and folds again; a thread pins it open", () => {
  const f = fileOf(" +>> ");
  const [run] = hunkItems(f.hunks[0], "p", fold(true)).filter((i) => i.run);
  assert.deepEqual(kinds(hunkItems(f.hunks[0], "p", fold(true), new Set([run.run.id]))), ["ctx1/1", "add/2", "run 2+0- open", "add/3", "add/4", "ctx2/5"]);
  const placed = placeThreads([f], [threadOf({ id: "T", path: "a.ts", line: 4, diffSide: "RIGHT", comments: { nodes: [{ body: "x" }] } })]);
  const pinned = hunkItems(f.hunks[0], "p", fold(true), new Set(), placed.files.get("a.ts")).find((i) => i.run).run;
  assert.deepEqual([pinned.open, pinned.pinned], [true, true]);
});

test("rows: a folded run is one 20px row, across both sides in split", () => {
  const f = fileOf(" ->>+ ");
  const uni = buildRows([f], { mode: "unified", width: 900, comments: fold(true) });
  assert.deepEqual(uni.rows.map((r) => r.t), ["file", "line", "line", "run", "line", "line"]);
  assert.equal(uni.sizes[3], 20);
  const split = buildRows([f], { mode: "split", width: 900, comments: fold(true) });
  assert.deepEqual(split.rows.map((r) => r.t), ["file", "pair", "pair", "run", "pair", "pair"]);
  const runId = split.rows[3].key;
  assert.equal(split.runAt.get(runId), 3);
  const opened = buildRows([f], { mode: "unified", width: 900, comments: fold(true), openRuns: new Set([runId]) });
  assert.deepEqual(opened.rows.map((r) => r.t), ["file", "line", "line", "run", "line", "line", "line", "line"]);
  assert.equal(opened.rows[4].look.dimmed, true);
});
