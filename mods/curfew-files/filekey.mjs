// What a file tab (the curfew-file mod) shows, as Files names it: its props, and the one string
// filetab.js remembers each tab by. Pure, so node tests it (filekey.test.mjs).

const isAbsolute = (p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
const absolute = (p) => (isAbsolute(String(p.file)) ? String(p.file) : `${String(p.folder ?? "").replace(/[\\/]+$/, "")}/${String(p.file).replace(/^\.\//, "")}`);

/** A file tab's props for a file of the tree: the diff tab's shape without its kind (`file`
 *  absolute, `on` only for a space on another machine). */
export const fileProps = (folder, file, on) => ({ folder, file, ...(on ? { on } : {}) });

/** What a file tab shows, as one string: the file by its absolute path, and its machine. */
export function fileKey(p) {
  return JSON.stringify(["file", p.on ?? null, absolute(p)]);
}
