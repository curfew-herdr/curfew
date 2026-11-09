// Adapted from herdr-code-review's tabbed-changes (MIT, Copyright (c) 2026 Sangit Barua; see NOTICE):
// the word diff a changed pair is marked with, token splitting and wrapping, and a small memo.
// No Herdr imports, so `node --test` can load it.

const segments = (text) => [...text.matchAll(/\s+|[A-Za-z0-9_$]+|[^A-Za-z0-9_$\s]/gu)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
// Touching spans join, and so do spans split only by one or two spaces, so a changed phrase is one block.
const mergeSpans = (items, text = "") => {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && (last.end === item.start || /^ {1,2}$/.test(text.slice(last.end, item.start)))) last.end = item.end;
    else out.push({ start: item.start, end: item.end });
  }
  return out;
};
const solid = (text) => text.replace(/\s+/g, "").length;

/** The spans of a changed pair that differ, per side; a mostly rewritten line gets none. */
export function wordChanges(oldText, newText) {
  if (oldText === newText) return { old: [], next: [] };
  if (oldText.length > 8000 || newText.length > 8000) return { old: [], next: [] };
  const a = segments(oldText), b = segments(newText), n = a.length, m = b.length;
  if (n > 160 || m > 160 || n * m > 16000) return { old: [], next: [] };
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = a[i].text === b[j].text ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const removed = [], added = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].text === b[j].text) { i++; j++; }
    else if (i < n && (j === m || table[i + 1][j] >= table[i][j + 1])) removed.push(a[i++]);
    else added.push(b[j++]);
  }
  const share = (spans, text) => { const total = solid(text); return total ? spans.reduce((s, x) => s + solid(text.slice(x.start, x.end)), 0) / total : 0; };
  const oldSpans = mergeSpans(removed, oldText), newSpans = mergeSpans(added, newText);
  if (solid(oldText) + solid(newText) >= 40 && Math.max(share(oldSpans, oldText), share(newSpans, newText)) > 0.6) return { old: [], next: [] };
  return { old: oldSpans, next: newSpans };
}

/** Cuts tokens at the spans' edges, marking the pieces inside a span `changed`. */
export function splitTokens(tokens, spans = []) {
  if (!spans.length) return tokens;
  const out = [];
  let at = 0;
  for (const token of tokens) {
    const end = at + token.text.length, edges = [at, end];
    for (const span of spans) if (span.end > at && span.start < end) edges.push(Math.max(at, span.start), Math.min(end, span.end));
    const sorted = [...new Set(edges)].sort((x, y) => x - y);
    for (let k = 0; k < sorted.length - 1; k++) out.push({ ...token, text: token.text.slice(sorted[k] - at, sorted[k + 1] - at), changed: spans.some((s) => s.start < sorted[k + 1] && s.end > sorted[k]) });
    at = end;
  }
  return out;
}

/** Continuation rows hang in by the line's own indent plus two. */
export function hangFor(text) {
  let n = 0;
  for (const ch of text ?? "") { if (ch === " ") n++; else if (ch === "\t") n += 4; else break; }
  return Math.min(n, 32) + 2;
}

/** Where a line breaks to fit `columns`: at whitespace when it can, inside a long word when it must. */
export function wrapBreaks(text, columns, hang = 0) {
  if (!text || !columns) return null;
  const indent = Math.min(hang, Math.floor(columns / 2));
  // The line's own indent is never a place to break: a row of nothing but indent helps no one.
  const lead = text.length - text.replace(/^[ \t]+/, "").length;
  let start = 0, offset = 0, used = 0, space = 0;
  const breaks = [];
  while (offset < text.length) {
    const point = text.codePointAt(offset);
    const size = point === 9 ? 4 : point >= 0x2e80 ? 2 : 1;
    if (used + size > columns && offset > start) {
      offset = start = space > start ? space : offset;
      breaks.push(start);
      used = indent;
      continue;
    }
    offset += point > 0xffff ? 2 : 1;
    used += size;
    if ((point === 32 || point === 9) && offset > lead) space = offset;
  }
  if (breaks.length && indent > 0) breaks.hang = indent;
  return breaks.length ? breaks : null;
}

/** Tokens cut into one list per wrapped row. */
export function wrapTokens(tokens, breaks) {
  if (!breaks) return [tokens];
  const rows = [[]];
  let offset = 0, index = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    let start = 0;
    while (index < breaks.length && breaks[index] <= end) {
      const cut = breaks[index++] - offset;
      if (cut > start) rows.at(-1).push({ ...token, text: token.text.slice(start, cut) });
      rows.push([]);
      start = cut;
    }
    if (start < token.text.length) rows.at(-1).push({ ...token, text: token.text.slice(start) });
    offset = end;
  }
  return rows;
}

/** A bounded least-recently-used memo. */
export class Memo {
  constructor(limit = 512, maxKey = 10000) { this.limit = limit; this.maxKey = maxKey; this.entries = new Map(); }
  get(key, compute) {
    if (this.entries.has(key)) { const value = this.entries.get(key); this.entries.delete(key); this.entries.set(key, value); return value; }
    const value = compute();
    if (key.length > this.maxKey) return value;
    this.entries.set(key, value);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
    return value;
  }
}
