// The toolbar's Edit (edit.mjs): the file tab a worktree diff tab opens, the one Files opens for
// that file, and none for a pull request's diff, another machine's, a deleted file, a file outside
// the folder, or before the patch is read. Paths go through relativeFile as main.js's do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { editProps } from "../edit.mjs";
import { relativeFile, parsePatch } from "../model.js";
import { fileProps, fileKey } from "../filekey.mjs";

const ROOT = "/r/shop";
const ADDED = parsePatch(["diff --git a/src/new.js b/src/new.js", "new file mode 100644", "index 0000000..1111111", "--- /dev/null", "+++ b/src/new.js", "@@ -0,0 +1 @@", "+export const c = 3;", ""].join("\n"))[0];
const MODIFIED = parsePatch(["diff --git a/src/cart.js b/src/cart.js", "index 1111111..2222222 100644", "--- a/src/cart.js", "+++ b/src/cart.js", "@@ -1 +1 @@", "-export const a = 1;", "+export const a = 2;", ""].join("\n"))[0];
const DELETED = parsePatch(["diff --git a/src/old.js b/src/old.js", "deleted file mode 100644", "index 1111111..0000000", "--- a/src/old.js", "+++ /dev/null", "@@ -1 +0,0 @@", "-export const b = 2;", ""].join("\n"))[0];

// As the diff tab has it once loaded: its props as init reads them, git's top and the folder's prefix.
function edit(props, { root = ROOT, prefix = "", ...read } = {}) {
  const file = "file" in read ? read.file : MODIFIED, folder = typeof props.folder === "string" ? props.folder.replace(/\/$/, "") : null;
  const path = props.file ? relativeFile(props.file, folder, root, prefix) : file?.path ?? null;
  return editProps({ kind: props.kind === "pr" ? "pr" : "changes", folder, on: props.on ?? null, path, prefix, file });
}

test("Edit opens a worktree diff's file in a file tab, as Files would: one tab per file", () => {
  // Changes' diff tab: the folder is git's top, the file from it.
  assert.deepEqual(edit({ kind: "changes", folder: ROOT, file: "src/cart.js" }), { folder: ROOT, file: `${ROOT}/src/cart.js` });
  // Files' diff tab: the folder it shows, the file absolute; Files' own file tab has the same key.
  const files = edit({ kind: "changes", folder: `${ROOT}/src`, file: `${ROOT}/src/cart.js` }, { prefix: "src/" });
  assert.deepEqual(files, fileProps(`${ROOT}/src`, `${ROOT}/src/cart.js`, null));
  assert.equal(fileKey(files), JSON.stringify(["file", null, `${ROOT}/src/cart.js`]), "the key Files' tab is remembered by");
  assert.deepEqual(edit({ kind: "changes", folder: `${ROOT}/src/`, file: "./cart.js" }, { prefix: "src/" }), { folder: `${ROOT}/src`, file: `${ROOT}/src/cart.js` }, "from the folder, not git's top");
  // A folder behind a symlink: spelled as the folder is, not as git's real path.
  assert.deepEqual(edit({ kind: "changes", folder: "/tmp/shop", file: "/tmp/shop/a.js" }, { root: "/private/tmp/shop" }), { folder: "/tmp/shop", file: "/tmp/shop/a.js" });
  // No file asked for: the one the tab shows, the patch's first.
  assert.deepEqual(edit({ kind: "changes", folder: ROOT }, { file: ADDED }), { folder: ROOT, file: `${ROOT}/src/new.js` });
  for (const file of [ADDED, MODIFIED, { ...MODIFIED, untracked: true }, null]) assert.ok(edit({ kind: "changes", folder: ROOT, file: "src/cart.js" }, { file }), String(file?.status));
});

test("no Edit for a pull request's diff, another machine's, a deleted file, a file outside the folder, or before the patch", () => {
  assert.equal(edit({ kind: "pr", repo: "o/shop", number: 7, folder: ROOT, file: "src/cart.js" }), null);
  assert.equal(edit({ kind: "changes", folder: ROOT, file: "src/cart.js", on: "vps" }), null, "another machine's");
  assert.equal(edit({ kind: "changes", folder: ROOT, file: "src/old.js" }, { file: DELETED }), null, "deleted in this diff");
  assert.equal(edit({ kind: "changes", folder: ROOT }, { file: DELETED }), null);
  assert.equal(edit({ kind: "changes", folder: ROOT, file: "src/cart.js" }, { file: undefined }), null, "the patch not read yet");
  assert.equal(edit({ kind: "changes", folder: `${ROOT}/src`, file: `${ROOT}/lib/x.js` }, { prefix: "src/" }), null, "outside the folder");
  assert.equal(edit({ kind: "changes", folder: `${ROOT}/src`, file: "../lib/x.js" }, { prefix: "src/" }), null);
  assert.equal(edit({ kind: "changes", folder: ROOT, file: `${ROOT}/../etc/x` }), null);
  assert.equal(edit({ kind: "changes", folder: ROOT, file: "/etc/hosts" }), null, "outside the repository");
  assert.equal(edit({ kind: "changes", folder: null, file: "src/cart.js" }), null, "no folder");
  assert.equal(edit({ kind: "changes", folder: ROOT }, { file: null }), null, "no file at all");
  for (const p of [undefined, {}, { kind: "changes" }, { kind: "changes", folder: ROOT, path: 3, file: null }]) assert.equal(editProps(p), null);
});
