// The pure half of curfew-diff: a unified diff parsed into files and hunks, review threads placed
// under their lines, the thread filter (just the hunks with review threads), changed code
// comments dimmed, shown or folded to a row per run (que's Comments modes), the rows a virtual
// list draws (and each row's height, worked out here so the list never measures), and a small
// markdown layout for review comment bodies. The tab shows one file (rows without its header);
// the rows can still hold several under their headers. No Herdr imports, so `node --test tests/`
// covers it.
import { wrapBreaks, hangFor } from "./vendor.js";

// The heights que draws at (design.md, diff tabs), in px.
export const LINE_H = 18, FILE_H = 32, GAP_H = 26, NOTE_H = 26, RUN_H = 20;
export const HEAD_GAP = 6, HEAD_H = 26, TAIL_GAP = 10;
export const BODY_LINE = 17, BODY_BLANK = 6, WHO_H = 18, SEP_H = 13, BODY_PAD = 8;
export const CHAR_W = 7.23; // Menlo at 12px
export const CODE_W = 6.63; // Menlo at 11px, a comment's code
// Where a comment card starts: under the code, past the numbers and the sign (que's 106 and 60).
export const CARD_LEFT = { unified: 106, split: 60 }, CARD_MAX = 640, CARD_RIGHT = 16;
export const MAX_LINES = 20000;

// ---- parsing (patch.js, shared with curfew-changes) ------------------------------------------

export { parsePatch } from "./patch.js";

/** A hunk's lines side by side: a removed line beside the added line it became, context on both. */
export function splitPairs(lines) {
  const out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (l.kind === "ctx") { out.push({ l, r: l }); i++; continue; }
    const dels = [], adds = [];
    while (lines[i]?.kind === "del") dels.push(lines[i++]);
    while (lines[i]?.kind === "add") adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ l: dels[k] ?? null, r: adds[k] ?? null });
  }
  return out;
}

// ---- review threads --------------------------------------------------------------------------

/** A thread from GitHub's `reviewThreads` node, in the shape the view uses. */
export function threadOf(node, index = 0) {
  const comments = (node?.comments?.nodes ?? []).map((c) => ({ author: c?.author?.login ?? "ghost", body: c?.body ?? "", at: c?.createdAt ?? null, url: c?.url ?? null }));
  return {
    id: node?.id ?? `thread-${index}`,
    path: node?.path ?? null,
    side: node?.diffSide === "LEFT" ? "old" : "new",
    // As que does: the line now, else the one it was written on.
    line: node?.line ?? node?.originalLine ?? null,
    resolved: Boolean(node?.isResolved),
    outdated: Boolean(node?.isOutdated),
    comments,
  };
}

/** `threadOf` for every thread of a `pullRequest { reviewThreads }` GraphQL answer. */
export function threadsOf(answer) {
  const nodes = answer?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  return nodes.map(threadOf).filter((t) => t.path && t.comments.length);
}

const anchorKey = (side, line) => `${side}:${line}`;

/** The anchor keys a diff line answers to: a context line is on both sides. */
export function lineKeys(line) {
  if (!line) return [];
  if (line.kind === "add") return [anchorKey("new", line.new)];
  if (line.kind === "del") return [anchorKey("old", line.old)];
  return [anchorKey("new", line.new), anchorKey("old", line.old)];
}

/**
 * Where each thread goes: `files` maps a path to `{ at, unplaced }`, `at` keyed by side and line
 * (`new:12`); a thread whose line is not in the diff is `unplaced` under its file's header, and
 * one on a file the diff does not have is in `elsewhere`.
 */
export function placeThreads(files, threads) {
  const byPath = new Map(), elsewhere = [];
  const known = new Map(files.map((f) => {
    const keys = new Set();
    for (const h of f.hunks) for (const l of h.lines) for (const k of lineKeys(l)) keys.add(k);
    return [f.path, keys];
  }));
  for (const t of threads) {
    const keys = known.get(t.path);
    if (!keys) { elsewhere.push(t); continue; }
    if (!byPath.has(t.path)) byPath.set(t.path, { at: new Map(), unplaced: [] });
    const slot = byPath.get(t.path), key = t.line == null ? null : anchorKey(t.side, t.line);
    if (key && keys.has(key)) slot.at.set(key, [...(slot.at.get(key) ?? []), t]);
    else slot.unplaced.push(t);
  }
  return { files: byPath, elsewhere };
}

/** Whether a hunk has a line a review thread is on: the thread filter keeps those. */
export function hunkHasThreads(hunk, placed) {
  if (!placed?.at.size) return false;
  return hunk.lines.some((l) => lineKeys(l).some((k) => placed.at.has(k)));
}

/** The threads under one diff line (unified) or one split row. */
export function threadsAt(placed, ...lines) {
  if (!placed) return [];
  const out = [];
  for (const line of lines) for (const k of lineKeys(line)) for (const t of placed.at.get(k) ?? []) if (!out.includes(t)) out.push(t);
  return out;
}

// ---- comment bodies --------------------------------------------------------------------------

// Rough advances of the system sans at 12px: enough to break lines before they run out of room.
const NARROW = new Set("iljtfr.,:;'|!()[]{} \"`");
function sansWidth(ch) {
  const c = ch.codePointAt(0);
  if (c > 0x2000) return 15; // emoji and wide symbols
  if (NARROW.has(ch)) return 3.9;
  if (ch === "m" || ch === "w") return 9.6;
  if (ch === "M" || ch === "W") return 11;
  if (/[A-Z]/.test(ch)) return 8.1;
  if (/[0-9]/.test(ch)) return 7.1;
  return 6.6;
}
export const textWidth = (text, style) => (style === "code" ? [...text].length * CODE_W : [...text].reduce((w, ch) => w + sansWidth(ch) * (style === "b" ? 1.06 : 1), 0));

// Inline markdown: `code`, **bold**, *italic*, [links](url), images, bare URLs; tags dropped.
export function inlineSpans(text) {
  const spans = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\(([^)]*)\)|(https?:\/\/[^\s)]+)/g;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) spans.push({ text: text.slice(at, m.index), s: "" });
    if (m[1] !== undefined) spans.push({ text: m[1], s: "code" });
    else if (m[2] !== undefined || m[3] !== undefined) spans.push({ text: m[2] ?? m[3], s: "b" });
    else if (m[4] !== undefined) spans.push({ text: m[4], s: "i" });
    else if (m[5] !== undefined) spans.push({ text: m[5] ? `image: ${m[5]}` : "image", s: "link" });
    else if (m[6] !== undefined) spans.push({ text: m[6], s: "link" });
    else spans.push({ text: m[8], s: "link" });
    at = m.index + m[0].length;
  }
  if (at < text.length) spans.push({ text: text.slice(at), s: "" });
  return spans.filter((s) => s.text);
}

// Greedy word wrap of spans into lines no wider than `width`; a word wider than a line breaks.
function wrapSpans(spans, width, indent = 0) {
  const lines = [[]];
  let used = 0;
  const push = (text, s) => {
    const last = lines.at(-1), prev = last.at(-1);
    if (prev && prev.s === s) prev.text += text; else last.push({ text, s });
  };
  for (const span of spans) {
    for (const word of span.text.split(/(\s+)/)) {
      if (!word) continue;
      const space = /^\s+$/.test(word);
      if (space) { if (used > 0) { push(" ", span.s); used += textWidth(" ", span.s); } continue; }
      let w = textWidth(word, span.s);
      if (used > 0 && used + w > width) {
        const last = lines.at(-1), tail = last.at(-1);
        if (tail) tail.text = tail.text.replace(/\s+$/, "");
        lines.push([]); used = indent;
      }
      if (w <= width - used) { push(word, span.s); used += w; continue; }
      // A word longer than the line: cut it.
      let piece = "";
      for (const ch of word) {
        const cw = textWidth(ch, span.s);
        if (used + cw > width && (piece || used > indent)) { if (piece) push(piece, span.s); piece = ""; lines.push([]); used = indent; }
        piece += ch; used += cw;
      }
      if (piece) push(piece, span.s);
    }
  }
  return lines.filter((l, i) => l.length || i === 0);
}

/**
 * A comment's markdown as lines to draw, each `{ kind, spans, indent }` with a height of its own
 * (`BODY_LINE`, or `BODY_BLANK` between blocks): paragraphs and list items word-wrapped to
 * `width`, fenced code (a suggestion says so) cut to its columns, quotes indented and muted.
 */
export function layoutBody(markdown, width) {
  const out = [];
  const src = String(markdown ?? "").replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<summary>([\s\S]*?)<\/summary>/gi, "$1\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^>]*>/gi, "");
  const blank = () => { if (out.length && out.at(-1).kind !== "blank") out.push({ kind: "blank", spans: [], indent: 0 }); };
  let para = null, code = null;
  const flush = () => {
    if (!para) return;
    const indent = para.indent;
    for (const spans of wrapSpans(inlineSpans(para.text), Math.max(40, width - indent), 0)) out.push({ kind: para.kind, spans, indent });
    para = null;
  };
  for (const raw of src.split("\n")) {
    const fence = /^\s*```\s*([\w-]*)/.exec(raw);
    if (fence) {
      if (code) { code = null; blank(); continue; }
      flush(); blank();
      code = { lang: fence[1] };
      if (fence[1] === "suggestion") out.push({ kind: "label", spans: [{ text: "Suggested change", s: "b" }], indent: 0 });
      continue;
    }
    if (code) {
      const cols = Math.max(8, Math.floor((width - 12) / CODE_W)), text = raw.replace(/\t/g, "    ");
      if (!text) { out.push({ kind: "code", spans: [{ text: " ", s: "code" }], indent: 6 }); continue; }
      for (let i = 0; i < text.length; i += cols) out.push({ kind: "code", spans: [{ text: text.slice(i, i + cols), s: "code" }], indent: 6 });
      continue;
    }
    if (!raw.trim()) { flush(); blank(); continue; }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(raw);
    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    const quote = /^\s*>\s?(.*)$/.exec(raw);
    if (heading) { flush(); para = { kind: "text", text: `**${heading[1].replace(/\*\*/g, "")}**`, indent: 0 }; flush(); continue; }
    if (bullet) {
      flush();
      const depth = Math.min(3, Math.floor(bullet[1].replace(/\t/g, "  ").length / 2));
      const mark = /\d/.test(bullet[2]) ? bullet[2] : "•";
      para = { kind: "text", text: `${mark} ${bullet[3]}`, indent: 4 + depth * 12 };
      continue;
    }
    if (quote) {
      if (para?.kind !== "quote") { flush(); para = { kind: "quote", text: quote[1], indent: 10 }; }
      else para.text += ` ${quote[1]}`;
      continue;
    }
    if (para && para.kind !== "quote") para.text += ` ${raw.trim()}`;
    else { flush(); para = { kind: "text", text: raw.trim(), indent: 0 }; }
  }
  flush();
  while (out.length && out.at(-1).kind === "blank") out.pop();
  while (out.length && out[0].kind === "blank") out.shift();
  return out.length ? out : [{ kind: "text", spans: [{ text: "(no text)", s: "i" }], indent: 0 }];
}

export const lineHeight = (line) => (line.kind === "blank" ? BODY_BLANK : BODY_LINE);

/** The card's inner text width at a list width, and its left edge. */
export function cardBox(width, mode) {
  const left = CARD_LEFT[mode] ?? CARD_LEFT.unified;
  const cardWidth = Math.max(160, Math.min(CARD_MAX, width - left - CARD_RIGHT));
  // The text's measure is an estimate of the system font: leave it room to be wrong.
  return { left, width: cardWidth, text: Math.floor((cardWidth - 22) * 0.92) };
}

/** A thread's body laid out: each comment's lines (the first comment's author is in the head). */
export function layoutThread(thread, textWidthPx) {
  const comments = thread.comments.map((c, i) => ({ ...c, lines: layoutBody(c.body, textWidthPx), first: i === 0 }));
  let height = BODY_PAD;
  for (const c of comments) {
    if (!c.first) height += SEP_H + WHO_H;
    for (const l of c.lines) height += lineHeight(l);
  }
  return { comments, height: height + BODY_PAD + TAIL_GAP };
}

// ---- rows ------------------------------------------------------------------------------------

/** How many characters of code fit beside the numbers at a list width (0: no wrapping). */
export function codeColumns(width, mode) {
  if (!width) return 0;
  const code = mode === "split" ? (width - 1) / 2 - 44 - 16 - 16 : width - 44 - 44 - 18 - 16;
  return Math.max(12, Math.floor((code - 10) / CHAR_W));
}

/**
 * The rows the virtual list draws, with their heights. `opts`: `mode` ("unified" | "split"),
 * `width` (the list's), `wrap`, `placed` (placeThreads), `hide` (comments hidden), `only` (the
 * thread filter: just the hunks with review threads), `closedFiles` and `closedThreads` (Sets),
 * `comments` (`{ mode, keepRemoved }`, how changed comment lines draw) and `openRuns` (the
 * folded comment runs opened, by id), `header` (false: no file header row, as a one-file tab
 * draws it; closing a file needs its header) and `ignoredWhitespace` (git left whitespace out: a
 * file without hunks says so). Returns `{ rows, sizes, fileAt, threadAt, runAt, widest, truncated }`.
 */
export function buildRows(files, opts = {}) {
  const mode = opts.mode === "split" ? "split" : "unified";
  const placedFiles = opts.placed?.files ?? new Map();
  const closedFiles = opts.closedFiles ?? new Set(), closedThreads = opts.closedThreads ?? new Set();
  const cols = opts.wrap ? codeColumns(opts.width, mode) : 0;
  const box = cardBox(opts.width ?? 800, mode);
  const rows = [], sizes = [], fileAt = new Map(), threadAt = new Map(), runAt = new Map();
  const comments = opts.comments ?? DEFAULT_COMMENTS, header = opts.header !== false;
  let widest = 0, lines = 0, truncated = false;
  const push = (row, size) => { rows.push(row); sizes.push(size); return rows.length - 1; };
  const wraps = (text) => (cols && text ? wrapBreaks(text, cols, hangFor(text)) : null);
  const pushThreads = (threads) => {
    if (opts.hide) return;
    for (const t of threads) {
      const closed = closedThreads.has(t.id);
      threadAt.set(t.id, push({ t: "thead", key: `t:${t.id}`, thread: t, closed, box }, closed ? HEAD_GAP + HEAD_H + TAIL_GAP : HEAD_GAP + HEAD_H));
      if (!closed) {
        const body = layoutThread(t, box.text);
        push({ t: "tbody", key: `b:${t.id}`, thread: t, body, box }, body.height);
      }
    }
  };

  for (const file of files) {
    const placed = placedFiles.get(file.path);
    const hunks = opts.only ? file.hunks.filter((h) => hunkHasThreads(h, placed)) : file.hunks;
    if (opts.only && !hunks.length && !placed?.unplaced.length) continue;
    const threads = placed ? [...placed.at.values()].reduce((n, ts) => n + ts.length, 0) + placed.unplaced.length : 0;
    const closed = header && closedFiles.has(file.path);
    if (header) fileAt.set(file.path, push({ t: "file", key: `f:${file.path}`, file, closed, threads }, FILE_H));
    if (closed) continue;
    if (placed?.unplaced.length) pushThreads(placed.unplaced);
    if (file.binary) { push({ t: "note", key: `n:${file.path}`, text: "Binary file." }, NOTE_H); continue; }
    if (!file.hunks.length) {
      const text = file.status === "renamed" ? "Renamed, no lines changed." : opts.ignoredWhitespace ? "Only whitespace changed." : "No lines changed.";
      push({ t: "note", key: `n:${file.path}`, text }, NOTE_H);
      continue;
    }
    let after = 1;
    hunks.forEach((h, hi) => {
      const gap = h.newStart - after;
      const skipped = opts.only && file.hunks.indexOf(h) !== file.hunks.indexOf(hunks[hi - 1]) + 1;
      if (gap > 0 || (hi === 0 && h.fn)) push({ t: "gap", key: `g:${file.path}:${h.oldStart}:${h.newStart}`, count: Math.max(0, gap), fn: h.fn, skipped }, GAP_H);
      after = h.newStart + h.newCount;
      if (truncated) return;
      // Under Fold, a run of comment lines is one row, then its lines while it is open.
      const items = hunkItems(h, `${file.path}:${hi}`, comments, opts.openRuns, placed);
      const pushLine = (line) => {
        if (lines++ >= MAX_LINES) { truncated = true; return false; }
        widest = Math.max(widest, line.text.length);
        const w = wraps(line.text);
        push({ t: "line", key: `l:${file.path}:${line.old}:${line.new}`, line, path: file.path, wraps: w, look: lookOf(line, comments) }, LINE_H * (1 + (w?.length ?? 0)));
        pushThreads(threadsAt(placed, line));
        return true;
      };
      if (mode === "unified") {
        for (const item of items) {
          if (item.run) { runAt.set(item.run.id, push({ t: "run", key: item.run.id, run: item.run, path: file.path }, RUN_H)); continue; }
          if (!pushLine(item.line)) break;
        }
        return;
      }
      // Side by side, as que's splitRows: within a change the i-th removed line beside the i-th
      // added one; a context line on both; a run's row across both, ending the pairing.
      let dels = [], adds = [];
      const pushPair = (l, r) => {
        if (lines++ >= MAX_LINES) { truncated = true; return; }
        const lw = l ? wraps(l.text) : null, rw = r ? wraps(r.text) : null;
        widest = Math.max(widest, l?.text.length ?? 0, r?.text.length ?? 0);
        push({ t: "pair", key: `p:${file.path}:${l?.old}:${r?.new}`, pair: { l, r }, path: file.path, lw, rw, ll: l && lookOf(l, comments), rl: r && lookOf(r, comments) }, LINE_H * (1 + Math.max(lw?.length ?? 0, rw?.length ?? 0)));
        pushThreads(threadsAt(placed, l, r === l ? null : r));
      };
      const flush = () => { for (let k = 0; k < Math.max(dels.length, adds.length) && !truncated; k++) pushPair(dels[k] ?? null, adds[k] ?? null); dels = []; adds = []; };
      for (const item of items) {
        if (truncated) break;
        if (item.line?.kind === "del") dels.push(item.line);
        else if (item.line?.kind === "add") adds.push(item.line);
        else {
          flush();
          if (item.run) runAt.set(item.run.id, push({ t: "run", key: item.run.id, run: item.run, path: file.path, split: true }, RUN_H));
          else pushPair(item.line, item.line);
        }
      }
      flush();
    });
  }
  if (truncated) push({ t: "note", key: "n:truncated", text: `Showing the first ${MAX_LINES.toLocaleString("en-US")} lines.` }, NOTE_H);
  return { rows, sizes, fileAt, threadAt, runAt, widest, truncated };
}

// ---- comment lines (que's dim | show | fold) ---------------------------------------------------

/** How a diff draws changed comment lines: dimmed (the default), as code, or folded away. */
export const COMMENT_MODES = ["dim", "show", "fold"];
export const DEFAULT_COMMENTS = { mode: "dim", keepRemoved: true };

/** A changed line that is a comment line. */
export const isCommentLine = (l) => l.kind !== "ctx" && l.comment === true;

/** Whether a line is drawn dimmed, and whether it carries the removed tag (que's commentLook). */
export function lookOf(line, view = DEFAULT_COMMENTS) {
  const dimmed = isCommentLine(line) && view.mode !== "show";
  return { dimmed, kept: dimmed && view.mode === "fold" && view.keepRemoved && line.kind === "del" };
}

/**
 * A hunk as items: `{ line }`, or under Fold `{ run }` for each run of consecutive comment lines
 * (removed ones left out while they are kept), followed by its lines while it is open. A run is
 * open while `openRuns` has its id, or pinned open while a review thread points into it.
 */
export function hunkItems(hunk, prefix, view = DEFAULT_COMMENTS, openRuns = new Set(), placed = null) {
  const ls = hunk.lines;
  if (view.mode !== "fold") return ls.map((line) => ({ line }));
  const foldable = (l) => isCommentLine(l) && !(view.keepRemoved && l.kind === "del");
  const items = [];
  for (let i = 0; i < ls.length;) {
    if (!foldable(ls[i])) { items.push({ line: ls[i++] }); continue; }
    const start = i;
    while (i < ls.length && foldable(ls[i])) i++;
    const run = ls.slice(start, i), added = run.filter((l) => l.kind === "add");
    const numbers = (added.length ? added.map((l) => l.new) : run.map((l) => l.old)).filter((n) => n != null);
    const id = `c:${prefix}:${start}:${i}`;
    const pinned = Boolean(placed) && run.some((l) => lineKeys(l).some((k) => placed.at.has(k)));
    const open = pinned || openRuns.has(id);
    items.push({ run: { id, open, pinned, added: added.length, removed: run.length - added.length, first: numbers[0] ?? 0, last: numbers.at(-1) ?? 0 } });
    if (open) for (const line of run) items.push({ line });
  }
  return items;
}

/** `3 comment lines added`, `1 comment line removed`, `2 comment lines changed`. */
export function runWords(run) {
  const how = run.removed === 0 ? "added" : run.added === 0 ? "removed" : "changed";
  return `${plural(run.added + run.removed, "comment line")} ${how}`;
}

// ---- excerpts, ages, paths -------------------------------------------------------------------

/** The first words of a comment, plain: what a folded thread's head shows. */
export function excerpt(body, max = 140) {
  const lines = layoutBody(body, 100000).filter((l) => l.kind === "text" || l.kind === "quote" || l.kind === "label");
  const text = lines.map((l) => l.spans.map((s) => s.text).join("")).join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || "(no text)";
}

/** `3h ago` as que writes an age. */
export function formatAge(iso, now = Date.now()) {
  if (!iso) return "-";
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The git-root-relative path of `file` given as relative to `folder` (whose prefix is `prefix`) or absolute. */
export function relativeFile(file, folder, root, prefix = "") {
  if (!file) return null;
  if (file.startsWith("/")) {
    if (root && file.startsWith(`${root}/`)) return file.slice(root.length + 1);
    if (folder && file.startsWith(`${folder.replace(/\/$/, "")}/`)) return prefix + file.slice(folder.replace(/\/$/, "").length + 1);
    return file;
  }
  return prefix + file.replace(/^\.\//, "");
}
