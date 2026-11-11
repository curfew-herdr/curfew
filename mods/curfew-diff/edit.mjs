// The toolbar's Edit (main.js), its pure part, so node tests it (tests/edit.test.mjs): which file a
// diff tab's Edit opens, as the props Files gives a file tab (filekey.mjs, curfew-files' copy), so
// a file has one tab whichever opened it. main.js opens it (filetab.js).
import { fileProps } from "./filekey.mjs";

/**
 * What Edit opens, from what the diff tab knows: its props as init reads them (`kind`, `folder`,
 * `on`), the file's path from the repository's top (`path`, as git gives it) and the folder's
 * (`prefix`, git's --show-prefix: "" at the top, else `sub/`), and the patch (`file`: the file's
 * entry, null with nothing left to compare, undefined until it is read). A worktree diff's file
 * on this machine, under the folder with no `..`, not deleted in the patch: the folder and the
 * file, absolute under the folder as Files spells it, no `on`; else null (a pull request's diff,
 * another machine's, a file outside the folder, a deleted one, the patch not read yet).
 */
export function editProps({ kind, folder, on, path, prefix = "", file } = {}) {
  if (kind !== "changes" || on || typeof folder !== "string" || typeof path !== "string" || file === undefined || file?.status === "deleted") return null;
  const root = folder.replace(/\/+$/, ""), from = String(prefix ?? "");
  const rest = path.startsWith(from) ? path.slice(from.length) : "";
  if (!root || !rest || rest.split("/").some((s) => !s || s === "." || s === "..")) return null;
  return fileProps(root, `${root}/${rest}`, null);
}
