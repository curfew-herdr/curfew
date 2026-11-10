// The pure half of curfew-file (no herdr, no gpui: view.test.mjs runs it under node): the file a
// tab's props name, the path its header shows, the Editor's language for it, and what of its text
// it shows. The bound and the words are the ones Files' in-panel preview had (the shipped files
// mod's): readTextFile reads up to 1 MiB, and of that the first 400,000 characters show.

export const MAX_CHARS = 400000;
export const UNREADABLE = "Cannot preview this file (binary, too large, or unreadable)";

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
