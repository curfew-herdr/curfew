// The file tab's pure half. Run: node --test mods/curfew-file/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CHARS, MAX_BYTES, LANG, absoluteFile, shownPath, languageOf, textOf, utf8Length, editable, fileKey, marked, afterRead, refused,
} from "./view.mjs";

const ROOT = "/r/shop";

test("the file is Files' absolute path, or a path from the folder", () => {
  assert.equal(absoluteFile(ROOT, `${ROOT}/src/cart.js`), `${ROOT}/src/cart.js`);
  assert.equal(absoluteFile(ROOT, "src/cart.js"), `${ROOT}/src/cart.js`);
  assert.equal(absoluteFile(`${ROOT}/`, "./package.json"), `${ROOT}/package.json`);
  assert.equal(absoluteFile(ROOT, "C:\\shop\\a.js"), "C:\\shop\\a.js", "a Windows path is absolute too");
  assert.equal(absoluteFile(null, "src/cart.js"), null, "a relative file needs a folder");
  assert.equal(absoluteFile(ROOT, ""), null);
  assert.equal(absoluteFile(ROOT, undefined), null);
});

test("the header shows the path from the folder, or the whole path outside it", () => {
  assert.equal(shownPath(ROOT, `${ROOT}/src/cart.js`), "src/cart.js");
  assert.equal(shownPath(`${ROOT}/`, "package.json"), "package.json");
  assert.equal(shownPath(ROOT, "/r/shopping/a.js"), "/r/shopping/a.js", "a sibling with the same start is outside");
  assert.equal(shownPath(null, "/etc/hosts"), "/etc/hosts");
  assert.equal(shownPath(ROOT, null), "");
});

test("the Editor's language comes from the name's extension, renamed where the Editor calls it otherwise", () => {
  assert.equal(languageOf("src/cart.js"), "js");
  assert.equal(languageOf("api.ts"), "js");
  assert.equal(languageOf("Main.TSX"), "js", "whatever its case");
  assert.equal(languageOf("usage.mjs"), "js");
  assert.equal(languageOf("Cargo.toml"), "yaml");
  assert.equal(languageOf("tsconfig.jsonc"), "json");
  assert.equal(languageOf("App.vue"), "html");
  assert.equal(languageOf("package.json"), "json");
  assert.equal(languageOf("lib.rs"), "rs");
  assert.equal(languageOf("README.md"), "md");
  assert.equal(languageOf("Makefile"), "txt");
  assert.equal(languageOf(".gitignore"), "txt", "a dotfile's name is not an extension");
  assert.equal(languageOf("v1.2/Dockerfile"), "txt", "a dot in a folder is not the file's");
  assert.equal(languageOf("C:\\shop\\a.py"), "py");
  for (const to of Object.values(LANG)) assert.ok(["js", "yaml", "json", "html"].includes(to));
});

test("a file shows its text, cut at 400,000 characters; a missing or binary file says so", () => {
  assert.deepEqual(textOf("a\nb\n"), { value: "a\nb\n" });
  assert.deepEqual(textOf(""), { value: "" });
  const long = "x".repeat(MAX_CHARS + 5);
  assert.equal(textOf(long).value, "x".repeat(MAX_CHARS) + "\n… (file truncated)");
  assert.deepEqual(textOf("x".repeat(MAX_CHARS)), { value: "x".repeat(MAX_CHARS) }, "exactly at the bound is whole");
  assert.deepEqual(textOf(null), { error: "This file is no longer available" });
  assert.deepEqual(textOf("PNG\0\0IHDR"), { error: "Binary file · no text preview" });
});

test("bytes are counted as UTF-8 writes them", () => {
  for (const s of ["", "abc", "é", "€", "😀", "a😀b€", "\uD800", "x\uDC00y", "\uD83D", "😀\uD83D"])
    assert.equal(utf8Length(s), Buffer.byteLength(s, "utf8"), JSON.stringify(s));
});

test("a read may be edited only on this machine, inside the folder, and whole", () => {
  const ok = { folder: ROOT, file: `${ROOT}/src/cart.js`, on: null, text: "let a = 1;\n" };
  assert.deepEqual(editable(ok), { ok: true });
  assert.deepEqual(editable({ ...ok, folder: `${ROOT}/` }), { ok: true }, "a folder with its slash");
  assert.deepEqual(editable({ ...ok, on: undefined, text: "" }), { ok: true }, "an empty file");
  assert.deepEqual(editable({ ...ok, on: "vps" }), { ok: false, why: "On another machine" }, "writeTextFile writes here only");
  for (const at of [{ folder: null }, { folder: 5 }, { folder: "" }, { folder: "/" }, { file: "/r/shopping/a.js" }, { file: "src/cart.js" },
    { file: null }, { file: `${ROOT}/../etc/hosts` }, { file: `${ROOT}/src/../../etc/hosts` }, { folder: "/r/x/..", file: "/r/x/../shop/a.js" }])
    assert.deepEqual(editable({ ...ok, ...at }), { ok: false, why: "Outside the project folder" }, JSON.stringify(at));
  assert.deepEqual(editable({ ...ok, text: null }), { ok: false, why: "This file is no longer available" });
  assert.deepEqual(editable({ ...ok, text: "PNG\0IHDR" }), { ok: false, why: "Binary file · no text preview" });
  assert.deepEqual(editable({ ...ok, text: "x".repeat(MAX_CHARS) }), { ok: true }, "exactly 400,000 characters is shown whole");
  assert.deepEqual(editable({ ...ok, text: "x".repeat(MAX_CHARS + 1) }), { ok: false, why: "Longer than 400,000 characters" }, "shown cut");
  const wide = "€".repeat((MAX_BYTES - 1) / 3); // three bytes each: one byte under 1 MiB, in fewer than 400,000 characters
  assert.deepEqual(editable({ ...ok, text: wide }), { ok: true });
  assert.deepEqual(editable({ ...ok, text: wide + "a" }), { ok: false, why: "1 MiB or larger" }, "exactly 1 MiB may be readTextFile's cut");
  assert.deepEqual(editable({ ...ok, text: "caf�\n" }), { ok: false, why: "Not valid UTF-8" }, "a replaced byte a save would write as U+FFFD");
});

test("the tab's key is the one Files knows the file by", () => {
  assert.equal(fileKey(null, `${ROOT}/a.js`), '["file",null,"/r/shop/a.js"]');
  assert.equal(fileKey(undefined, `${ROOT}/a.js`), '["file",null,"/r/shop/a.js"]');
  assert.equal(fileKey("vps", "/srv/a.js"), '["file","vps","/srv/a.js"]');
});

test("a dirty mark is written only when it flips, and as a new object", () => {
  const k = fileKey(null, `${ROOT}/a.js`), other = fileKey("vps", "/srv/b.js"), before = { [other]: true };
  const set = marked(before, k, true);
  assert.deepEqual(set, { [other]: true, [k]: true });
  assert.deepEqual(before, { [other]: true }, "the one read is not changed");
  assert.equal(marked(set, k, true), null, "already marked");
  const cleared = marked(set, k, false);
  assert.deepEqual(cleared, { [other]: true });
  assert.notEqual(cleared, set);
  assert.equal(marked(cleared, k, false), null, "already clear");
  assert.deepEqual(marked(undefined, k, true), { [k]: true }, "nothing shared yet");
  assert.equal(marked(undefined, k, false), null);
  assert.deepEqual(marked(["x"], k, true), { [k]: true }, "not an object: a fresh one");
  assert.deepEqual(marked({ [k]: "yes" }, k, true), { [k]: true }, "a mark is exactly true");
  assert.deepEqual(marked({ [k]: false }, k, false), {}, "and a clear one is gone");
});

test("a read leaves what the tab has, shows in a tab without edits, and waits on a choice with them", () => {
  assert.equal(afterRead({ disk: undefined }, "a"), "show", "the first read");
  assert.equal(afterRead({ disk: undefined }, null), "show", "a file gone at the first read says so");
  assert.equal(afterRead({ disk: "a" }, "a"), "same");
  assert.equal(afterRead({ disk: null }, null), "same", "still gone");
  assert.equal(afterRead({ disk: "a" }, "b"), "show", "a read-only tab takes the new text");
  assert.equal(afterRead({ disk: "a", value: "a" }, "b"), "show", "an editable one without edits too");
  assert.equal(afterRead({ disk: "a", value: "a" }, null), "show", "and says when it is gone");
  assert.equal(afterRead({ disk: "a", value: "ab" }, "a"), "same", "edits to a file that is as it was");
  assert.equal(afterRead({ disk: "a", value: "ab" }, "c"), "conflict");
  assert.equal(afterRead({ disk: "a", value: "ab" }, null), "conflict", "a file gone keeps the edits");
  assert.equal(afterRead({ disk: "a", value: "ab" }, "b\0"), "conflict", "so does one turned binary");
  assert.equal(afterRead({ disk: "a", value: "ab" }, "ab"), "match", "the file holds the edits");
  assert.equal(afterRead({ disk: "a", value: "abc", writing: "ab" }, "ab"), "ours", "the tab's own save, edits made since kept");
  assert.equal(afterRead({ disk: "a", value: "abc", writing: null }, null), "conflict", "no save on its way is not a file gone");
});

test("a refused save is saved after all, failed, or a conflict, by the file read again", () => {
  assert.equal(refused({ text: "ab", expected: "a" }, "ab"), "saved");
  assert.equal(refused({ text: "ab", expected: "a" }, "a"), "failed", "the file as expected: the write failed");
  assert.equal(refused({ text: "ab", expected: "a" }, "c"), "conflict");
  assert.equal(refused({ text: "ab", expected: "a" }, null), "conflict", "deleted meanwhile");
  assert.equal(refused({ text: "ab", expected: null }, null), "failed", "Overwrite of a file gone, still gone");
  assert.equal(refused({ text: "ab", expected: null }, "c"), "conflict", "and back meanwhile");
});
