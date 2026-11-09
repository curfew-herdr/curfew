// que's reading and wording rules for the usage chip. Run: node --test mods/curfew-usage/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeUsage, fit, level, pieces, tooltipOf, until } from "./usage.mjs";

const NOW = Date.UTC(2026, 10, 8, 19, 0, 0);
const secs = (ms) => Math.round(ms / 1000);
const file = (rateLimits, updatedAt = NOW - 60_000) => JSON.stringify({ updatedAt, sessionId: "s", rateLimits });
const H = 3_600_000;

test("reads both windows, resets_at from seconds to ms, the percentage clamped", () => {
  const u = decodeUsage(file({
    five_hour: { used_percentage: 104.2, resets_at: secs(NOW + 2 * H) },
    seven_day: { used_percentage: 18, resets_at: secs(NOW + 76 * H) },
  }), NOW);
  assert.deepEqual(u, { fiveHour: { pct: 100, resetsAt: NOW + 2 * H }, sevenDay: { pct: 18, resetsAt: NOW + 76 * H }, at: NOW - 60_000 });
});

test("a window whose reset has passed is dropped; with none left there is no reading", () => {
  const limits = { five_hour: { used_percentage: 90, resets_at: secs(NOW - 1000) }, seven_day: { used_percentage: 18, resets_at: secs(NOW + H) } };
  assert.equal(decodeUsage(file(limits), NOW).fiveHour, undefined);
  assert.equal(decodeUsage(file(limits), NOW + 2 * H), null);
});

test("malformed windows and files are no reading", () => {
  for (const text of ["", "nope", "null", file({}), file({ five_hour: { used_percentage: "5", resets_at: secs(NOW + H) } }), file({ five_hour: { used_percentage: 5 } })]) {
    assert.equal(decodeUsage(text, NOW), null, text);
  }
});

test("tones at 80% and 100% of the shown whole percentage", () => {
  assert.equal(level({ pct: 79.4 }), null);
  assert.equal(level({ pct: 79.5 }), "attention");
  assert.equal(level({ pct: 99.4 }), "attention");
  assert.equal(level({ pct: 99.5 }), "bad");
  assert.equal(level(undefined), null);
});

test("until reads like que's", () => {
  assert.equal(until(NOW - 1, NOW), "now");
  assert.equal(until(NOW + 30_000, NOW), "in <1m");
  assert.equal(until(NOW + 45 * 60_000, NOW), "in 45m");
  assert.equal(until(NOW + 2 * H + 10 * 60_000, NOW), "in 2h 10m");
  assert.equal(until(NOW + 2 * H + 9 * 60_000, NOW), "in 2h 9m");
  assert.equal(until(NOW + 76 * H, NOW), "in 3d 4h");
});

test("the chip: resets for every window when wide, only at 100% when narrow, — without a window", () => {
  const u = { fiveHour: { pct: 100, resetsAt: NOW + 38 * 60_000 }, sevenDay: { pct: 18, resetsAt: NOW + 76 * H } };
  const text = (wide) => pieces(u, wide, NOW).map((p) => `${p.spec.short} ${p.pct}${p.until}`).join("  ");
  assert.equal(text(true), "5h 100% · 38m  wk 18% · 3d 4h");
  assert.equal(text(false), "5h 100% · 38m  wk 18%");
  assert.equal(pieces(null, true, NOW).map((p) => `${p.spec.short} ${p.pct}${p.until}`).join("  "), "5h —  wk —");
  assert.match(tooltipOf(null, NOW), /fills in after a session's first reply/);
  assert.match(tooltipOf(u, NOW), /^5-hour 100% · resets \d\d:\d\d · in 38m\nweekly 18% · resets \w{3} \d\d:\d\d$/);
});

test("the chip fits its width: every reset, then que's strip form, then the numbers alone", () => {
  const u = { fiveHour: { pct: 100, resetsAt: NOW + 38 * 60_000 }, sevenDay: { pct: 18, resetsAt: NOW + 76 * H } };
  const text = (width) => fit(u, NOW, width, 6.7, 28).map((p) => `${p.spec.short} ${p.pct}${p.until}`).join("  ");
  assert.equal(text(0), "5h 100% · 38m  wk 18% · 3d 4h"); // not measured yet
  assert.equal(text(256), "5h 100% · 38m  wk 18% · 3d 4h");
  assert.equal(text(170), "5h 100% · 38m  wk 18%");
  assert.equal(text(120), "5h 100%  wk 18%");
});
