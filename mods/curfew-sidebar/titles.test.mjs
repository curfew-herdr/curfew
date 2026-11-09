// node --test ~/.config/herdr-app/mods/curfew-sidebar/titles.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionLabel, capTitle, isClaude, nextTitles, paneTitle, cleanKept, MAX_TITLE_CHARS } from "./titles.mjs";

test("a terminal with no title, which herdr reports as its address, names nothing", () => {
  assert.equal(paneTitle({ terminal: "t2c", title: "t2c" }), "");
  assert.equal(paneTitle({ terminal: "t2c", title: "✳ Small bug hunt" }), "✳ Small bug hunt");
  assert.equal(paneTitle({ terminal: "t2c" }), "");
  const r = nextTitles({}, {}, [{ space: "s1", terminal: "t2c", title: paneTitle({ terminal: "t2c", title: "t2c" }) }], ["s1"]);
  assert.deepEqual(r.titles, {});
});

test("cleanKept drops a name an address once left, and keeps real ones", () => {
  const kept = { titles: { s1: "Small bug hunt", s2: "t2c" }, seen: { t2p: "Small bug hunt", t2c: "t2c" } };
  assert.deepEqual(cleanKept(kept), { titles: { s1: "Small bug hunt" }, seen: { t2p: "Small bug hunt" }, changed: true });
  assert.equal(cleanKept({ titles: { s1: "A" }, seen: { t1: "A" } }).changed, false);
  assert.deepEqual(cleanKept(undefined), { titles: {}, seen: {}, changed: false });
});

test("sessionLabel reads Claude Code's title the way que does", () => {
  assert.equal(sessionLabel("✳ Small bug hunt"), "Small bug hunt");
  assert.equal(sessionLabel("◐ Fix the cart total"), "Fix the cart total");
  assert.equal(sessionLabel("◑  Fix the cart total "), "Fix the cart total");
  assert.equal(sessionLabel("Small bug hunt"), "Small bug hunt");
  assert.equal(sessionLabel("Claude Code"), null);
  assert.equal(sessionLabel("✳ Claude Code"), null);
  assert.equal(sessionLabel(""), null);
  assert.equal(sessionLabel(undefined), null);
  // Only one leading glyph is a status.
  assert.equal(sessionLabel("✳ ✳ stars"), "✳ stars");
});

test("a long title is cut to que's 80 characters with an ellipsis", () => {
  const long = "x".repeat(100);
  assert.equal(capTitle(long).length, MAX_TITLE_CHARS);
  assert.ok(capTitle(long).endsWith("…"));
  assert.equal(capTitle("short"), "short");
});

test("isClaude knows a Claude terminal by the agent's report or the program", () => {
  assert.equal(isClaude({ terminal: "t1", app: "claude-code" }), true);
  assert.equal(isClaude({ terminal: "t1", program: { key: "claude" } }), true);
  assert.equal(isClaude({ terminal: "t1", app: "codex", program: { key: "codex" } }), false);
  assert.equal(isClaude({ terminal: null, mod: "curfew-diff", app: "claude-code" }), false);
});

test("a session names its space, follows a rename, and keeps the name after it exits", () => {
  let r = nextTitles({}, {}, [{ space: "s1", terminal: "t1", title: "Claude Code" }], ["s1"]);
  assert.deepEqual(r.titles, {});
  assert.equal(r.changed, false);
  r = nextTitles(r.titles, r.seen, [{ space: "s1", terminal: "t1", title: "✳ Small bug hunt" }], ["s1"]);
  assert.deepEqual(r.titles, { s1: "Small bug hunt" });
  assert.equal(r.changed, true);
  r = nextTitles(r.titles, r.seen, [{ space: "s1", terminal: "t1", title: "◐ Small bug hunt" }], ["s1"]);
  assert.equal(r.changed, false);
  r = nextTitles(r.titles, r.seen, [{ space: "s1", terminal: "t1", title: "✳ Discount rounding" }], ["s1"]);
  assert.deepEqual(r.titles, { s1: "Discount rounding" });
  // Exit: an empty title, then no terminal at all.
  r = nextTitles(r.titles, r.seen, [{ space: "s1", terminal: "t1", title: "" }], ["s1"]);
  r = nextTitles(r.titles, r.seen, [], ["s1"]);
  assert.deepEqual(r.titles, { s1: "Discount rounding" });
});

test("with two sessions in a space, the one whose name changed last wins", () => {
  let r = nextTitles({}, {}, [
    { space: "s1", terminal: "t1", title: "✳ First" },
    { space: "s1", terminal: "t2", title: "✳ Second" },
  ], ["s1"]);
  assert.deepEqual(r.titles, { s1: "Second" });
  r = nextTitles(r.titles, r.seen, [
    { space: "s1", terminal: "t1", title: "✳ First, renamed" },
    { space: "s1", terminal: "t2", title: "✳ Second" },
  ], ["s1"]);
  assert.deepEqual(r.titles, { s1: "First, renamed" });
});

test("after a restart a kept title stays until a session's name changes", () => {
  // The terminal's label is already the kept one: nothing changes.
  let r = nextTitles({ s1: "Kept" }, {}, [{ space: "s1", terminal: "t9", title: "✳ Kept" }], ["s1"]);
  assert.equal(r.changed, false);
  // A different live name (seen for the first time) takes over, as a title change would.
  r = nextTitles({ s1: "Kept" }, {}, [{ space: "s1", terminal: "t9", title: "✳ Newer" }], ["s1"]);
  assert.deepEqual(r.titles, { s1: "Newer" });
});

test("titles of spaces that are gone are dropped, but not before herdr lists its spaces", () => {
  let r = nextTitles({ s1: "A", s2: "B" }, {}, [], []);
  assert.deepEqual(r.titles, { s1: "A", s2: "B" });
  r = nextTitles({ s1: "A", s2: "B" }, {}, [], ["s1"]);
  assert.deepEqual(r.titles, { s1: "A" });
  assert.equal(r.changed, true);
});
