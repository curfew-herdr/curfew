// Whether a tab holds edits not saved: a file tab (curfew-file) whose file's key is true in the
// shared `curfew-file.dirty` (file key -> true while its tab has unsaved edits), the key
// `curfew-file.tabs` remembers the tab by (tab id -> file key: curfew-files' filetab.js). Pure,
// so node tests it (dirty.test.mjs); main.js reads the two maps.

const has = (map, key) => map !== null && typeof map === "object" && !Array.isArray(map) && Object.hasOwn(map, key);

/** Whether tab `id` shows a file with unsaved edits, by the two maps; anything else in them is no. */
export function unsaved(id, tabs, dirty) {
  const key = has(tabs, id) ? tabs[id] : null;
  return typeof key === "string" && has(dirty, key) && dirty[key] === true;
}
