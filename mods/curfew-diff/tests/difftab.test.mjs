// difftab.js (carried by curfew-changes, curfew-files and curfew-prs; base.test.mjs keeps the copies
// identical) against a fake `herdr`: one tab per file, an open file's tab selected instead of a
// second one, and the tabs it opened remembered once Herdr lists them.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The window: spaces with tabs, the panes in them, focus, shared state, and the commands run.
const FAKE = `
const w = globalThis.fakeHerdr;
export const spaces = () => w.spaces;
export const panes = () => w.panes;
export const focused = () => w.focused;
export const run = (name, args) => { w.runs.push([name, args]); return null; };
export const shared = (key) => w.shared[key];
export const setShared = (key, value) => { w.shared[key] = value; return null; };
`;
registerHooks({
  resolve: (specifier, context, next) => (specifier === "herdr" ? { url: `data:text/javascript,${encodeURIComponent(FAKE)}`, shortCircuit: true } : next(specifier, context)),
});
const w = (globalThis.fakeHerdr = {});
const { openDiff, settle, shownDiff, diffKey } = await import("../../curfew-changes/difftab.js");

const ROOT = "/r/shop";
const changes = (file) => ({ kind: "changes", folder: ROOT, file });
const pr = (file) => ({ kind: "pr", repo: "o/shop", number: 7, folder: ROOT, file });

beforeEach(() => {
  Object.assign(w, {
    spaces: [{ id: "s1", active: true, tabs: [{ id: "t-shell", name: "zsh", active: true }] }],
    panes: [{ pane: "p-shell", tab: "t-shell", terminal: "t1" }],
    focused: { space: "s1", tab: "t-shell" },
    shared: {},
    runs: [],
  });
});

// What Herdr does after a tab.new: the tab appears, shown, with its mod pane.
function herdrMakes(id) {
  const [name, args] = w.runs.at(-1);
  assert.equal(name, "tab.new");
  const space = w.spaces.find((s) => s.id === args.space);
  for (const t of space.tabs) t.active = false;
  space.tabs.push({ id, name: args.name, active: true });
  w.panes.push({ pane: `p-${id}`, tab: id, terminal: null, mod: args.mod });
}

test("a file opens a tab of its own, named after it; opened again, that tab is selected", () => {
  openDiff(changes("src/cart.js"), "cart.js");
  assert.deepEqual(w.runs, [["tab.new", { space: "s1", name: "cart.js", mod: "curfew-diff", props: changes("src/cart.js") }]]);
  openDiff(changes("src/cart.js"), "cart.js");
  assert.equal(w.runs.length, 1, "a second click while Herdr makes the tab adds nothing");
  herdrMakes("t-cart");
  settle();
  assert.equal(w.shared["curfew-diff.tabs"]["t-cart"], diffKey(changes("src/cart.js")));
  assert.deepEqual(w.shared["curfew-diff.opening"], []);
  assert.equal(shownDiff(), diffKey(changes("src/cart.js")));
  w.spaces[0].tabs.forEach((t) => (t.active = t.id === "t-shell"));
  openDiff({ kind: "changes", folder: `${ROOT}/src`, file: `${ROOT}/src/cart.js` }, "cart.js");
  assert.deepEqual(w.runs.at(-1), ["tab.select", { id: "t-cart" }], "the same file from Files (an absolute path) is the same tab");
  assert.equal(w.runs.filter(([n]) => n === "tab.new").length, 1);
});

test("another file, or the pull request's copy of the same path, is another tab", () => {
  openDiff(changes("src/cart.js"), "cart.js");
  herdrMakes("t-cart");
  settle();
  openDiff(changes("lib/cart.js"), "cart.js");
  herdrMakes("t-cart2");
  openDiff(pr("src/cart.js"), "cart.js");
  herdrMakes("t-cart-pr");
  settle();
  assert.deepEqual(w.runs.map(([n]) => n), ["tab.new", "tab.new", "tab.new"]);
  const known = w.shared["curfew-diff.tabs"];
  assert.equal(new Set(Object.values(known)).size, 3);
  assert.equal(known["t-cart-pr"], JSON.stringify(["pr", "o/shop", 7, "src/cart.js"]));
  openDiff(pr("src/cart.js"), "cart.js");
  assert.deepEqual(w.runs.at(-1), ["tab.select", { id: "t-cart-pr" }]);
});

test("a diff tab from before tabs were remembered is found by its name, never for a pull request", () => {
  w.spaces[0].tabs.push({ id: "t-old", name: "cart.js", active: false });
  w.panes.push({ pane: "p-old", tab: "t-old", terminal: null, mod: "curfew-diff" });
  openDiff(pr("src/cart.js"), "cart.js");
  assert.equal(w.runs.at(-1)[0], "tab.new", "a pull request's file never takes a worktree tab by name");
  openDiff(changes("src/cart.js"), "cart.js");
  assert.deepEqual(w.runs.at(-1), ["tab.select", { id: "t-old" }]);
  assert.equal(w.shared["curfew-diff.tabs"]["t-old"], diffKey(changes("src/cart.js")));
  // A terminal tab that happens to share the name is not a diff tab.
  w.spaces[0].tabs.push({ id: "t-term", name: "notes.md", active: false });
  openDiff(changes("notes.md"), "notes.md");
  assert.equal(w.runs.at(-1)[0], "tab.new");
});

test("closed tabs are forgotten; a tab Herdr never made is given up", () => {
  w.shared["curfew-diff.tabs"] = { "t-gone": "x", "vps/t-remote": "y" };
  openDiff(changes("a.js"), "a.js");
  herdrMakes("t-a");
  settle();
  assert.deepEqual(Object.keys(w.shared["curfew-diff.tabs"]).sort(), ["t-a", "vps/t-remote"], "another machine's are kept");
  w.shared["curfew-diff.opening"] = [{ space: "s1", before: [], key: "k", name: "never.js", at: Date.now() - 60000 }];
  settle();
  assert.deepEqual(w.shared["curfew-diff.opening"], []);
});
