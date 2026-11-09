// Which changed lines of a diff only touch comments, as que marks them (src/daemon/comment-lines.ts):
// a line is a comment line when all its visible text is comment, so the inner lines of a block or
// doc comment count too, and code with a trailing comment does not. A blank changed line counts
// with the comment run it sits in. A string is code, so a docstring is code. A file whose language
// is not known has no comment lines.
// que tokenizes the whole file with a grammar; a diff tab has only the hunks, so this scans each
// side's lines (context and that side's changes, in order) with the language's comment syntax,
// carrying block comments from line to line. A hunk that starts inside a block comment is found
// when its `*/` closes one nobody opened. No Herdr imports, so `node --test` can load it.
// curfew-changes keeps a byte-for-byte copy (mods cannot import across folders): change both.

// que's languages (src/daemon/syntax.ts), by file name then extension.
const BY_EXTENSION = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "jsonc", json5: "jsonc", md: "markdown", markdown: "markdown", css: "css", scss: "scss", html: "html", htm: "html",
  py: "python", pyi: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift", c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hh: "cpp", hpp: "cpp", hxx: "cpp", cs: "csharp", rb: "ruby", rake: "ruby", gemspec: "ruby",
  php: "php", sh: "shellscript", bash: "shellscript", zsh: "shellscript", yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql",
  dockerfile: "docker", vue: "vue", svelte: "svelte", lua: "lua",
};
const BY_NAME = { dockerfile: "docker", containerfile: "docker", gemfile: "ruby", rakefile: "ruby", ".bashrc": "shellscript", ".zshrc": "shellscript", ".profile": "shellscript" };

/** The language for a path, by file name then extension; null when none fits. */
export function languageFor(path) {
  const name = String(path ?? "").split("/").pop().toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (/^(tsconfig|jsconfig)(\..*)?\.json$/.test(name)) return "jsonc";
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

const C_LIKE = { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'", "`"] };
const HASH = { line: ["#"], block: [], quotes: ['"', "'"] };
const MARKUP = { line: [], block: [["<!--", "-->"]], quotes: [] };
const SPEC = {
  typescript: C_LIKE, tsx: C_LIKE, javascript: C_LIKE, jsx: C_LIKE, jsonc: C_LIKE, go: C_LIKE, rust: C_LIKE, java: C_LIKE,
  kotlin: C_LIKE, swift: C_LIKE, c: C_LIKE, cpp: C_LIKE, csharp: C_LIKE, scss: C_LIKE,
  css: { line: [], block: [["/*", "*/"]], quotes: ['"', "'"] },
  php: { line: ["//", "#"], block: [["/*", "*/"]], quotes: ['"', "'"] },
  python: { line: ["#"], block: [], quotes: ['"', "'"], strings: ['"""', "'''"] },
  shellscript: HASH, ruby: HASH, yaml: HASH, toml: HASH, docker: HASH,
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: ["'", '"'] },
  lua: { line: ["--"], block: [["--[[", "]]"]], quotes: ['"', "'"] },
  html: MARKUP, markdown: MARKUP, vue: MARKUP, svelte: MARKUP,
};

/** The comment syntax for a path's language, or null (no comment lines: plain, json). */
export const specFor = (path) => SPEC[languageFor(path)] ?? null;

/**
 * Scans one line. `state`: null (code), `{ block: [open, close] }` inside a block comment, or
 * `{ string: delim }` inside a multi-line string. Returns the line's kind ("blank" | "comment" |
 * "code"), the state after it, `closed`: a block close found while not inside one, and `opener`:
 * a block comment opened on it.
 */
export function scanLine(text, spec, state) {
  let i = 0, code = false, comment = false, closed = false, opener = false;
  const at = (s) => text.startsWith(s, i);
  const blockOf = () => spec.block.find(([open]) => at(open));
  while (i < text.length) {
    if (state?.block) {
      const close = state.block[1], end = text.indexOf(close, i);
      if (text.slice(i, end < 0 ? text.length : end).trim()) comment = true;
      if (end < 0) return { kind: code ? "code" : comment ? "comment" : "blank", state, closed, opener };
      comment = true; i = end + close.length; state = null; continue;
    }
    if (state?.string) {
      code = true;
      const end = text.indexOf(state.string, i);
      if (end < 0) return { kind: "code", state, closed, opener };
      i = end + state.string.length; state = null; continue;
    }
    const ch = text[i];
    if (ch === " " || ch === "\t") { i++; continue; }
    const block = blockOf();
    // A line comment marker is one only at the start of a word (`$#` and `a#b` are not).
    if (block) { state = { block }; i += block[0].length; comment = true; opener = true; continue; }
    if (spec.line.some((m) => at(m)) && (i === 0 || /[\s;,(){}]/.test(text[i - 1]))) { comment = true; break; }
    // A close with no open on this side: the hunk began inside a block comment.
    const shut = spec.block.find(([, close]) => at(close));
    if (shut && !code) { closed = true; comment = true; i += shut[1].length; continue; }
    const triple = spec.strings?.find((s) => at(s));
    if (triple) { code = true; state = { string: triple }; i += 3; continue; }
    if (spec.quotes.includes(ch)) {
      code = true;
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      i = j + 1; continue;
    }
    code = true; i++;
  }
  return { kind: code ? "code" : comment ? "comment" : "blank", state, closed, opener };
}

/** Each line's kind on one side of a hunk (context and that side's changes, in order). */
function sideKinds(lines, spec) {
  const kinds = new Array(lines.length);
  let state = null, opened = false;
  lines.forEach((line, k) => {
    const r = scanLine(line.text, spec, state);
    // A `*/` nobody opened: every line above it in the hunk was inside that comment.
    if (r.closed && !opened) for (let b = 0; b < k; b++) if (kinds[b] !== "blank") kinds[b] = "comment";
    if (r.opener) opened = true;
    kinds[k] = r.kind;
    state = r.state;
  });
  return kinds;
}

/**
 * Sets `comment` on a hunk's added and removed lines that are comment lines (que's rule for blank
 * lines: one counts when the nearest non-blank lines above and below it in its run of added, or
 * removed, lines both are comment lines).
 */
export function markHunk(hunk, spec) {
  for (const l of hunk.lines) delete l.comment;
  if (!spec) return hunk;
  const kind = new Map();
  for (const side of ["add", "del"]) {
    const lines = hunk.lines.filter((l) => l.kind === "ctx" || l.kind === side);
    sideKinds(lines, spec).forEach((k, i) => { if (lines[i].kind === side) kind.set(lines[i], k); });
  }
  const ls = hunk.lines;
  for (let i = 0; i < ls.length;) {
    if (ls[i].kind === "ctx") { i++; continue; }
    const start = i, k0 = ls[i].kind;
    while (i < ls.length && ls[i].kind === k0) i++;
    const run = ls.slice(start, i), kinds = run.map((l) => kind.get(l));
    const nearest = (from, step) => { for (let k = from + step; k >= 0 && k < kinds.length; k += step) if (kinds[k] !== "blank") return kinds[k]; return undefined; };
    run.forEach((l, k) => {
      if (kinds[k] === "comment" || (kinds[k] === "blank" && nearest(k, -1) === "comment" && nearest(k, 1) === "comment")) l.comment = true;
    });
  }
  return hunk;
}

/** Marks every hunk of a parsed file; returns the file. */
export function markFile(file) {
  const spec = file.binary ? null : specFor(file.path);
  for (const h of file.hunks) markHunk(h, spec);
  return file;
}

/** A file's changed lines, code apart from comments (que's splitCounts). */
export function splitCounts(files) {
  const s = { codeAdditions: 0, codeDeletions: 0, commentAdditions: 0, commentDeletions: 0 };
  for (const f of [].concat(files)) for (const h of f.hunks) for (const l of h.lines) {
    if (l.kind === "ctx") continue;
    const added = l.kind === "add";
    if (l.comment) s[added ? "commentAdditions" : "commentDeletions"]++;
    else s[added ? "codeAdditions" : "codeDeletions"]++;
  }
  return s;
}

/** Every changed line is a comment line (and there is one). */
export function commentOnly(file) {
  const s = splitCounts(file);
  return s.commentAdditions + s.commentDeletions > 0 && s.codeAdditions + s.codeDeletions === 0;
}

/** Files where code changed first, then the ones where only comments changed (que's commentOnlyLast). */
export function commentOnlyLast(files) {
  const code = [], only = [];
  for (const f of files) (commentOnly(f) ? only : code).push(f);
  return { code, commentOnly: only };
}

/**
 * The parts of que's split counts, in order: `+a −d code · +c −e comments`, a part or a side left
 * out when it is zero (comments alone read `+2 comments`). Each part: `[{ sign, n, tone }], word`.
 */
export function countParts(split, totals) {
  const comments = split.commentAdditions + split.commentDeletions;
  if (comments === 0) return [{ items: [{ sign: "+", n: totals.add, tone: "add" }, { sign: "−", n: totals.del, tone: "del" }], word: null }];
  const parts = [];
  const side = (sign, n, tone) => (n > 0 ? [{ sign, n, tone }] : []);
  if (split.codeAdditions + split.codeDeletions > 0) parts.push({ items: [...side("+", split.codeAdditions, "add"), ...side("−", split.codeDeletions, "del")], word: "code ·" });
  parts.push({ items: [...side("+", split.commentAdditions, null), ...side("−", split.commentDeletions, null)], word: "comments" });
  return parts;
}
