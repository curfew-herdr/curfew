// The file tab's pure half. Run: node --test mods/curfew-file/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CHARS, LANG, absoluteFile, shownPath, languageOf, textOf } from "./view.mjs";

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
