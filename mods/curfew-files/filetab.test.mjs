// filetab.js against a fake `herdr`, as difftab.test.mjs tests difftab.js: one file tab per file,
// an open file's tab selected instead of a second one, the tabs it opened remembered once Herdr
// lists them, and never a diff tab or a tab it didn't open.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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
const { openFile, settleFiles, shownFile, fileKey } = await import("./filetab.js");
const { fileProps } = await import("./filekey.mjs");

const ROOT = "/r/shop";
const file = (path, on = null) => fileProps(ROOT, `${ROOT}/${path}`, on);

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

test("a file opens a file tab of its own, named after it; opened again, that tab is selected", () => {
  openFile(file("README.md"), "README.md");
  assert.deepEqual(w.runs, [["tab.new", { space: "s1", name: "README.md", mod: "curfew-file", props: file("README.md") }]]);
  openFile(file("README.md"), "README.md");
  assert.equal(w.runs.length, 1, "a second click while Herdr makes the tab adds nothing");
  assert.equal(shownFile(), null, "not shown before Herdr lists it");
  herdrMakes("t-readme");
  settleFiles();
  assert.equal(w.shared["curfew-file.tabs"]["t-readme"], fileKey(file("README.md")));
  assert.deepEqual(w.shared["curfew-file.opening"], []);
  assert.equal(shownFile(), fileKey(file("README.md")));
  w.spaces[0].tabs.forEach((t) => (t.active = t.id === "t-shell"));
  assert.equal(shownFile(), null, "a terminal tab shows no file");
  openFile(file("README.md"), "README.md");
  assert.deepEqual(w.runs.at(-1), ["tab.select", { id: "t-readme" }]);
  assert.equal(w.runs.filter(([n]) => n === "tab.new").length, 1);
});

test("another file, or another machine's, is another tab; diff tabs and tabs of another space are left alone", () => {
  openFile(file("src/index.js"), "index.js");
  herdrMakes("t-a");
  settleFiles();
  openFile(file("lib/index.js"), "index.js");
  assert.equal(w.runs.at(-1)[0], "tab.new", "the same name in another folder is another file");
  herdrMakes("t-b");
  openFile(file("src/index.js", "vps"), "index.js");
  herdrMakes("t-c");
  settleFiles();
  assert.equal(new Set(Object.values(w.shared["curfew-file.tabs"])).size, 3);
  // A diff tab of the same file, and its record in difftab.js' map, are not a file tab.
  w.spaces[0].tabs.push({ id: "t-diff", name: "cart.js", active: false });
  w.panes.push({ pane: "p-diff", tab: "t-diff", terminal: null, mod: "curfew-diff" });
  w.shared["curfew-diff.tabs"] = { "t-diff": JSON.stringify(["changes", null, `${ROOT}/cart.js`]) };
  openFile(file("cart.js"), "cart.js");
  assert.equal(w.runs.at(-1)[0], "tab.new");
  // A file tab in another space: this space gets its own.
  w.spaces.push({ id: "s2", active: false, tabs: [] });
  w.focused = { space: "s2", tab: null };
  openFile(file("src/index.js"), "index.js");
  assert.equal(w.runs.at(-1)[0], "tab.new");
  assert.equal(w.runs.at(-1)[1].space, "s2");
});

test("a file tab nobody opened here (by tab.new elsewhere) is not taken by its name", () => {
  w.spaces[0].tabs.push({ id: "t-cli", name: "package.json", active: false });
  w.panes.push({ pane: "p-cli", tab: "t-cli", terminal: null, mod: "curfew-file" });
  openFile(file("package.json"), "package.json");
  assert.equal(w.runs.at(-1)[0], "tab.new");
  herdrMakes("t-mine");
  settleFiles();
  assert.deepEqual(Object.keys(w.shared["curfew-file.tabs"]), ["t-mine"], "the new tab, not the one before it");
});

test("closed tabs are forgotten; a tab Herdr never made is given up", () => {
  w.shared["curfew-file.tabs"] = { "t-gone": "x", "vps/t-remote": "y" };
  openFile(file("a.js"), "a.js");
  herdrMakes("t-a");
  settleFiles();
  assert.deepEqual(Object.keys(w.shared["curfew-file.tabs"]).sort(), ["t-a", "vps/t-remote"], "another machine's are kept");
  w.shared["curfew-file.opening"] = [{ space: "s1", before: [], key: "k", name: "never.js", at: Date.now() - 60000 }];
  settleFiles();
  assert.deepEqual(w.shared["curfew-file.opening"], []);
});
