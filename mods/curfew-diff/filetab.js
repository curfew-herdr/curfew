// File tabs (the curfew-file mod), opened as difftab.js opens diff tabs: one tab per file, named
// after it, and a file whose tab is already open in the space selects that tab instead of adding
// another. Herdr shows a mod no other tab's props, so the tabs opened here are remembered in
// shared state, `curfew-file.tabs`: tab id -> the key of the file it shows (filekey.mjs).
// Byte-identical, with filekey.mjs, in curfew-files and curfew-diff (a mod can't import another
// mod's files): Files opens them, and selects a changed file's where it is open (selectFile);
// a diff tab's Edit opens its file in one. Each calls settleFiles() as it renders.
// Unlike difftab.js there is no finding a tab by its name: file tabs were remembered from the
// first, and a name can't tell two folders' index.js apart.
import { spaces, panes, focused, run, shared, setShared } from "herdr";
import { fileKey } from "./filekey.mjs";

export { fileKey };

const MOD = "curfew-file", TABS = "curfew-file.tabs", OPENING = "curfew-file.opening";

const fileTabs = () => new Set(panes().filter((p) => p.mod === MOD).map((p) => p.tab));

/** The key of the file the shown tab shows, or null (a terminal, a diff, or a file tab not opened here). */
export function shownFile() {
  const space = spaces().find((s) => s.active), tab = space?.tabs.find((t) => t.active);
  return (tab && shared(TABS)?.[tab.id]) || null;
}

// The space a tab opens in: the focused one, else the shown one.
function here() {
  const at = focused()?.space;
  return spaces().find((s) => s.id === at) ?? spaces().find((s) => s.active);
}

/** Selects the tab showing `props`' file in the shown space when one is open there; whether it did. */
export function selectFile(props) {
  settleFiles();
  const space = here(), key = fileKey(props), known = shared(TABS) ?? {}, files = fileTabs();
  const tab = space?.tabs.find((t) => files.has(t.id) && known[t.id] === key);
  if (tab) run("tab.select", { id: tab.id });
  return Boolean(tab);
}

/** Selects the tab showing `props`' file in the shown space, else opens one named `name`. */
export function openFile(props, name) {
  if (selectFile(props)) return;
  const space = here();
  if (!space) return;
  const key = fileKey(props);
  const opening = (shared(OPENING) ?? []).filter((o) => Date.now() - o.at < 10000);
  if (opening.some((o) => o.key === key && o.space === space.id)) return; // on its way already
  const before = space.tabs.map((t) => t.id);
  run("tab.new", { space: space.id, name, mod: MOD, props });
  // Herdr lists the new tab once it has made it: settleFiles() remembers it then.
  setShared(OPENING, [...opening, { space: space.id, before, key, name, at: Date.now() }]);
}

/** Remembers the tabs openFile opened as soon as Herdr lists them. Cheap without any: call it on render. */
export function settleFiles() {
  const opening = shared(OPENING);
  if (!Array.isArray(opening) || !opening.length) return;
  const files = fileTabs(), made = {}, left = [];
  for (const o of opening) {
    const space = spaces().find((s) => s.id === o.space);
    const tab = space?.tabs.find((t) => !o.before.includes(t.id) && t.name === o.name && files.has(t.id) && !(t.id in made));
    if (tab) made[tab.id] = o.key;
    else if (space && Date.now() - o.at < 10000) left.push(o);
  }
  if (left.length === opening.length) return;
  setShared(OPENING, left);
  if (Object.keys(made).length) remember(made);
}

// Closed tabs are forgotten as others are remembered; another machine's are kept (its spaces may
// not be listed while it is away).
function remember(entries) {
  const live = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
  const next = { ...entries };
  for (const [tab, k] of Object.entries(shared(TABS) ?? {})) if (!(tab in next) && (live.has(tab) || tab.includes("/"))) next[tab] = k;
  setShared(TABS, next);
}
