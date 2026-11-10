// A file tab's props and key. Run: node --test mods/curfew-files/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileProps, fileKey } from "./filekey.mjs";

const ROOT = "/r/shop";

test("a file tab's props are the diff's without a kind, `on` only for another machine", () => {
  assert.deepEqual(fileProps(ROOT, `${ROOT}/src/cart.js`, null), { folder: ROOT, file: `${ROOT}/src/cart.js` });
  assert.deepEqual(fileProps(ROOT, `${ROOT}/src/cart.js`, "vps"), { folder: ROOT, file: `${ROOT}/src/cart.js`, on: "vps" });
});

test("a file is one key however its props spell it", () => {
  const key = fileKey(fileProps(ROOT, `${ROOT}/src/cart.js`, null));
  assert.equal(key, JSON.stringify(["file", null, `${ROOT}/src/cart.js`]));
  assert.equal(fileKey({ folder: ROOT, file: "src/cart.js" }), key, "relative to the folder");
  assert.equal(fileKey({ folder: `${ROOT}/`, file: "./src/cart.js" }), key);
  assert.equal(fileKey({ folder: `${ROOT}/src`, file: `${ROOT}/src/cart.js` }), key, "an absolute file whatever the folder");
});

test("another file, another machine's copy, or the file's diff are other keys", () => {
  const key = fileKey({ folder: ROOT, file: "src/cart.js" });
  assert.notEqual(fileKey({ folder: ROOT, file: "lib/cart.js" }), key);
  assert.notEqual(fileKey({ folder: ROOT, file: "src/cart.js", on: "vps" }), key);
  assert.notEqual(key, JSON.stringify(["changes", null, `${ROOT}/src/cart.js`]), "never a diff tab's key (difftab.js)");
  assert.equal(fileKey({ folder: "C:\\shop", file: "C:\\shop/a.js" }), JSON.stringify(["file", null, "C:\\shop/a.js"]), "a Windows path is absolute");
});
