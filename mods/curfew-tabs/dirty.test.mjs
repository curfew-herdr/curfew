// Which tabs carry the unsaved dot. Run: node --test mods/curfew-tabs/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { unsaved } from "./dirty.mjs";

const CART = JSON.stringify(["file", null, "/r/shop/src/cart.js"]), README = JSON.stringify(["file", null, "/r/shop/README.md"]);
const TABS = { "t-cart": CART, "t-readme": README, "vps/t-cart": JSON.stringify(["file", "vps", "/r/shop/src/cart.js"]) };

test("a file tab whose file has unsaved edits carries the dot; its others don't", () => {
  assert.equal(unsaved("t-cart", TABS, { [CART]: true }), true);
  assert.equal(unsaved("t-readme", TABS, { [CART]: true }), false);
  assert.equal(unsaved("vps/t-cart", TABS, { [CART]: true }), false, "another machine's copy is another file");
  assert.equal(unsaved("t-shell", TABS, { [CART]: true }), false, "a tab not a file tab");
});

test("only true marks a file; missing or odd shared values are no dot", () => {
  for (const mark of [false, 1, "true", null, {}]) assert.equal(unsaved("t-cart", TABS, { [CART]: mark }), false, JSON.stringify(mark));
  for (const dirty of [undefined, null, true, "x", [CART], 3]) assert.equal(unsaved("t-cart", TABS, dirty), false, JSON.stringify(dirty));
  for (const tabs of [undefined, null, "t-cart", ["t-cart"], { "t-cart": 3 }, { "t-cart": null }]) {
    assert.equal(unsaved("t-cart", tabs, { [CART]: true, 3: true, null: true }), false, JSON.stringify(tabs));
  }
});

test("nothing is found through an object's built-in names", () => {
  assert.equal(unsaved("constructor", {}, {}), false);
  assert.equal(unsaved("t-x", { "t-x": "toString" }, {}), false);
  assert.equal(unsaved("__proto__", {}, {}), false);
});
