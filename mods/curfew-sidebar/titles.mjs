// que's workspace titles (src/shared/session-label.ts, src/shared/brief.ts and the server's
// labelFromTerminal): a row takes the name a Claude Code session gives itself in its terminal
// title, from its first prompt or /rename, and follows it when it changes. Claude Code writes
// `✳ <name>` when idle or waiting, `◐ <name>` or `◑ <name>` while busy, `Claude Code` until the
// session has a name, and an empty title on exit: the placeholder and the exit change nothing, so
// the last name stays. A space someone named (space.rename) keeps its name; main.js decides that.

/** One status glyph Claude Code puts before the session name, and the whitespace after it. */
const GLYPH = /^[✳◐◑]\s*/u;
/** The title Claude Code shows before the session has been named. */
const PLACEHOLDER = "Claude Code";
/** que's longest workspace title, in characters. */
export const MAX_TITLE_CHARS = 80;

/** A one-line title cut to MAX_TITLE_CHARS, ending in `…` when it was longer. */
export function capTitle(line) {
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line;
}

/** The session name in a raw terminal title; null for an empty title or the placeholder. */
export function sessionLabel(raw) {
  const body = String(raw ?? "").trim().replace(GLYPH, "").trim();
  if (body === "" || body === PLACEHOLDER) return null;
  return capTitle(body);
}

/** A Claude Code terminal, as herdr reports it: the agent's own report, else the program. */
export const isClaude = (p) => Boolean(p.terminal) && (p.app === "claude-code" || p.program?.key === "claude");

/** A pane's title as the program set it: herdr gives a terminal with no title its address
 *  (`t2c`) instead, which is no session name. */
export const paneTitle = (p) => (p.title === p.terminal ? "" : (p.title ?? ""));

/** The kept titles without what an address-as-title once left there (a session "named" its own
 *  terminal's address, before paneTitle). Returns { titles, seen, changed }. */
export function cleanKept(kept) {
  const titles = { ...(kept?.titles ?? {}) };
  const seen = { ...(kept?.seen ?? {}) };
  let changed = false;
  for (const [terminal, label] of Object.entries(seen)) {
    if (label !== terminal) continue;
    delete seen[terminal];
    for (const [space, title] of Object.entries(titles)) if (title === terminal) delete titles[space];
    changed = true;
  }
  return { titles, seen, changed };
}

/**
 * The titles after one look at the window. `titles`: space id -> title (kept across restarts);
 * `seen`: terminal -> the label it showed last time; `sessions`: the Claude terminals now, as
 * { space, terminal, title } in window order; `live`: the space ids that exist (an empty list
 * prunes nothing, as on a start before herdr has listed its spaces). A terminal whose label is new
 * or changed names its space (the last such in order wins, as que's last title change does); a
 * space without a title takes its first labelled session. Returns { titles, seen, changed }.
 */
export function nextTitles(titles, seen, sessions, live) {
  const out = { ...titles };
  const nextSeen = {};
  let changed = false;
  const set = (space, label) => {
    if (out[space] !== label) { out[space] = label; changed = true; }
  };
  for (const { space, terminal, title } of sessions) {
    const label = sessionLabel(title);
    if (!label) { if (terminal in seen) nextSeen[terminal] = seen[terminal]; continue; }
    nextSeen[terminal] = label;
    if (seen[terminal] !== label || out[space] === undefined) set(space, label);
  }
  if (live.length) {
    const keep = new Set(live);
    for (const space of Object.keys(out)) if (!keep.has(space)) { delete out[space]; changed = true; }
  }
  return { titles: out, seen: nextSeen, changed };
}
