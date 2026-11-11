// The pure half of curfew-file (no herdr, no gpui: view.test.mjs runs it under node): the file a
// tab's props name, the path its header shows, the Editor's language for it, and what of its text
// it shows. The bound and the words are the ones Files' in-panel preview had (the shipped files
// mod's): readTextFile reads up to 1 MiB, and of that the first 400,000 characters show.
// And its editing: whether a read may be edited and saved back (editable), the key Files knows the
// tab's file by and the tab bar's dirty marks (fileKey, marked), and what a read of the file, or a
// save writeTextFile refused, does to a tab with edits or without (afterRead, refused).

export const MAX_CHARS = 400000;
// readTextFile's bound: a text this long or longer may be the start of a longer file, so it is never written back.
export const MAX_BYTES = 1048576;
export const UNREADABLE = "Cannot preview this file (binary, too large, or unreadable)";
// Why a text the Editor gives back otherwise than it was given (its own line endings) stays read-only.
export const REWRITES = "The editor would change its line endings";

// The Editor's language for an extension that isn't one of its own names (the shipped files mod's table).
export const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

const trim = (folder) => String(folder ?? "").replace(/[\\/]+$/, "");
const isAbsolute = (p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");

/** The file the props name, as an absolute path: `file` absolute, or relative to `folder`; else null. */
export function absoluteFile(folder, file) {
  if (typeof file !== "string" || !file) return null;
  if (isAbsolute(file)) return file;
  const base = trim(folder);
  return base ? `${base}/${file.replace(/^\.\//, "")}` : null;
}

/** The path the header shows: from the folder when the file is under it, else the whole path. */
export function shownPath(folder, file) {
  const full = absoluteFile(folder, file);
  if (!full) return "";
  const base = trim(folder);
  return base && full.startsWith(`${base}/`) ? full.slice(base.length + 1) : full;
}

/** The Editor's language for a file: its name's extension, lower case, renamed where LANG says; "txt" without one. */
export function languageOf(path) {
  const name = String(path ?? "").split(/[\\/]/).pop();
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return LANG[ext] ?? (ext || "txt");
}

/** What a read shows: `{ value }`, cut to MAX_CHARS with a last line saying so, or `{ error }` for
 *  a file that is gone (readTextFile's null) or binary (a NUL in it). */
export function textOf(text) {
  if (typeof text !== "string") return { error: "This file is no longer available" };
  if (text.includes("\0")) return { error: "Binary file · no text preview" };
  return { value: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n… (file truncated)" : text };
}

/** A text's length in UTF-8 bytes, as writeTextFile writes it (a lone surrogate as U+FFFD's three). */
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Whether a read may be edited and saved back: `{ ok: true }`, else `{ ok: false, why }` (the
 *  Read-only label's tooltip). Only a file on this machine (writeTextFile writes here only), under
 *  the tab's folder with no `..` on the way, read whole: text, shown uncut, under readTextFile's
 *  1 MiB, and UTF-8 throughout (a U+FFFD may be bytes the read replaced, which a save would too). */
export function editable({ folder, file, on, text }) {
  if (on) return { ok: false, why: "On another machine" };
  const base = typeof folder === "string" ? trim(folder) : "";
  if (!base || typeof file !== "string" || !file.startsWith(`${base}/`) || file.split(/[\\/]/).includes(".."))
    return { ok: false, why: "Outside the project folder" };
  const shown = textOf(text);
  if (shown.error) return { ok: false, why: shown.error };
  if (text.length > MAX_CHARS) return { ok: false, why: "Longer than 400,000 characters" };
  if (utf8Length(text) >= MAX_BYTES) return { ok: false, why: "1 MiB or larger" };
  if (text.includes("�")) return { ok: false, why: "Not valid UTF-8" };
  return { ok: true };
}

/** The string Files knows a file tab by (curfew-files' filekey.mjs, which a mod can't import): its
 *  machine and absolute path. The key of its dirty mark too. */
export const fileKey = (on, file) => JSON.stringify(["file", on ?? null, file]);

/** The tab bar's dirty marks (shared `curfew-file.dirty`: a file's key -> true) with one file's set
 *  or dropped: a new object, or null when they already say so (setShared re-renders every mod). */
export function marked(marks, key, dirty) {
  const now = marks && typeof marks === "object" && !Array.isArray(marks) ? marks : {};
  if (dirty ? now[key] === true : !(key in now)) return null;
  const next = { ...now };
  if (dirty) next[key] = true; else delete next[key];
  return next;
}

/** What a read of the file does to an open tab, from the text it last read (`disk`), the editor's
 *  own while it may be edited (`value`) and a save on its way (`writing`): "same" (nothing changed;
 *  a conflict is over), "ours" (that save, landing before its answer), "match" (the file holds the
 *  edits now: none are left), "show" (no edits: the new text shows), or "conflict" (edits: they
 *  stay, and the new text, or the file gone, waits on Reload or Overwrite). */
export function afterRead({ disk, value = null, writing = null }, text) {
  if (text === disk) return "same";
  if (typeof writing === "string" && text === writing) return "ours";
  if (typeof value !== "string" || value === disk) return "show";
  return text === value ? "match" : "conflict";
}

/** What a save writeTextFile refused comes to, by the file read again (`now`): "saved" (it holds
 *  the text after all), "failed" (it is still what the save expected: the write itself failed), or
 *  "conflict" (it changed: afterRead says what that does). */
export function refused({ text, expected }, now) {
  if (now === text) return "saved";
  return now === expected ? "failed" : "conflict";
}
