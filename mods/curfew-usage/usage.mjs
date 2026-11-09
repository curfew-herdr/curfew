// Claude plan usage as que reads and words it (que's usage.decode.ts and usage.ts), for main.js
// and its tests. No herdr or gpui imports.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fields = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

/** A window as Claude Code sends it (used_percentage; resets_at in Unix seconds), as que keeps it:
 *  pct clamped to 0–100, resetsAt in ms; undefined when either is malformed. */
function decodeWindow(v) {
  const { used_percentage: pct, resets_at: at } = fields(v);
  if (!isNum(pct) || !isNum(at) || at <= 0) return undefined;
  return { pct: Math.min(100, Math.max(0, pct)), resetsAt: Math.round(at * 1000) };
}

/** usage.json's reading without the windows that have reset by `now` (que's rule); null when
 *  none is left or the text isn't a reading. `at`: when it was written, or null. */
export function decodeUsage(text, now) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const limits = fields(fields(json).rateLimits);
  const live = (w) => (w && w.resetsAt > now ? w : undefined);
  const fiveHour = live(decodeWindow(limits.five_hour));
  const sevenDay = live(decodeWindow(limits.seven_day));
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay, at: isNum(json.updatedAt) ? json.updatedAt : null };
}

const pad2 = (n) => String(n).padStart(2, "0");
export const hhmm = (t) => `${pad2(new Date(t).getHours())}:${pad2(new Date(t).getMinutes())}`;
const weekdayClock = (t) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(t).getDay()]} ${hhmm(t)}`;

/** `in 2h 10m`, `in 45m`, `in 3d 4h`; `in <1m` under a minute, `now` once it has passed. */
export function until(t, now) {
  const ms = t - now;
  if (ms <= 0) return "now";
  if (ms < 60_000) return "in <1m";
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  if (h < 1) return `in ${m}m`;
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}
const untilShort = (t, now) => until(t, now).replace(/^in /, "");

/** The whole percentage shown. */
export const percent = (w) => Math.round(w.pct);

/** "attention" from 80%, "bad" from 100%, read off the shown percentage; null below or without one. */
export const level = (w) => (!w ? null : percent(w) >= 100 ? "bad" : percent(w) >= 80 ? "attention" : null);

/** The two windows, in the order they read. */
export const WINDOWS = [
  { key: "fiveHour", short: "5h", long: "5-hour", resets: (w, now) => `resets ${hhmm(w.resetsAt)} · ${until(w.resetsAt, now)}` },
  { key: "sevenDay", short: "wk", long: "weekly", resets: (w) => `resets ${weekdayClock(w.resetsAt)}` },
];

/** Each window's text on the chip: its percentage (`—` without one) and, when `wide` or at 100%,
 *  ` · 2h 10m` until it resets. */
export function pieces(u, wide, now) {
  return WINDOWS.map((spec) => {
    const w = u?.[spec.key];
    return {
      spec,
      w,
      pct: w ? `${percent(w)}%` : "—",
      until: w && (wide || level(w) === "bad") ? ` · ${untilShort(w.resetsAt, now)}` : "",
    };
  });
}

/** How the chip reads in `width` px at `charPx` a character plus `extra` px: every window's
 *  reset when it fits, else que's strip form (resets only at 100%), else the numbers alone. */
export function fit(u, now, width, charPx, extra) {
  const chars = (ps) => ps.reduce((n, p) => n + p.spec.short.length + 1 + p.pct.length + p.until.length, 0);
  const strip = pieces(u, false, now);
  const forms = [pieces(u, true, now), strip, strip.map((p) => ({ ...p, until: "" }))];
  return (width && forms.find((ps) => chars(ps) * charPx + extra <= width)) || forms[width ? 2 : 0];
}

/** The tooltip: each window's line from que's card, or why there's no reading yet. */
export function tooltipOf(u, now) {
  if (!u) return "Claude usage fills in after a session's first reply, on plans with usage limits";
  return WINDOWS.map(({ key, long, resets }) => (u[key] ? `${long} ${percent(u[key])}% · ${resets(u[key], now)}` : `${long} no reading`)).join("\n");
}
