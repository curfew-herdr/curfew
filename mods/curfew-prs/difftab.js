// Diff tabs (the curfew-diff mod), opened as que's store opens them (openDiff): one tab per file,
// named after it, and a file whose tab is already open in the space selects that tab instead of
// adding another. Herdr shows a mod no other tab's props, so the tabs opened here are remembered
// in shared state, `curfew-diff.tabs`: tab id -> the key of the diff it shows. Byte-identical in
// curfew-changes, curfew-files and curfew-prs (a mod can't import another mod's files); each calls
// settle() as it renders.
import { spaces, panes, focused, run, shared, setShared } from "herdr";

const MOD = "curfew-diff", TABS = "curfew-diff.tabs", OPENING = "curfew-diff.opening";

const absolute = (p) => (String(p.file).startsWith("/") ? p.file : `${String(p.folder ?? "").replace(/\/+$/, "")}/${p.file}`);
const diffTabs = () => new Set(panes().filter((p) => p.mod === MOD).map((p) => p.tab));

/**
 * What a diff tab shows, as one string, from its props: a worktree file by its absolute path (and
 * machine), or a pull request's file. A pull request's never matches the worktree's same path.
 */
export function diffKey(p) {
  return JSON.stringify(p.kind === "pr" ? ["pr", p.repo, Number(p.number), p.file ?? null] : ["changes", p.on ?? null, absolute(p)]);
}

/** The key of the diff the shown tab shows, or null (a terminal, or a diff tab not opened here). */
export function shownDiff() {
  const space = spaces().find((s) => s.active), tab = space?.tabs.find((t) => t.active);
  return (tab && shared(TABS)?.[tab.id]) || null;
}

/** Selects the tab showing `props`' diff in the shown space, else opens one named `name`. */
export function openDiff(props, name) {
  settle();
  const at = focused()?.space;
  const space = spaces().find((s) => s.id === at) ?? spaces().find((s) => s.active);
  if (!space) return;
  const key = diffKey(props), known = shared(TABS) ?? {}, diffs = diffTabs();
  const tabs = space.tabs.filter((t) => diffs.has(t.id));
  // A worktree file's tab opened before tabs were remembered here: by its name.
  const tab = tabs.find((t) => known[t.id] === key) ?? (props.kind === "pr" ? null : tabs.find((t) => !(t.id in known) && t.name === name));
  if (tab) {
    if (known[tab.id] !== key) remember({ [tab.id]: key });
    run("tab.select", { id: tab.id });
    return;
  }
  const opening = (shared(OPENING) ?? []).filter((o) => Date.now() - o.at < 10000);
  if (opening.some((o) => o.key === key && o.space === space.id)) return; // on its way already
  const before = space.tabs.map((t) => t.id);
  run("tab.new", { space: space.id, name, mod: MOD, props });
  // Herdr lists the new tab once it has made it: settle() remembers it then.
  setShared(OPENING, [...opening, { space: space.id, before, key, name, at: Date.now() }]);
}

/** Remembers the tabs openDiff opened as soon as Herdr lists them. Cheap without any: call it on render. */
export function settle() {
  const opening = shared(OPENING);
  if (!Array.isArray(opening) || !opening.length) return;
  const diffs = diffTabs(), made = {}, left = [];
  for (const o of opening) {
    const space = spaces().find((s) => s.id === o.space);
    const tab = space?.tabs.find((t) => !o.before.includes(t.id) && t.name === o.name && diffs.has(t.id) && !(t.id in made));
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
