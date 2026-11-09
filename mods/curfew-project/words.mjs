// What the Remove project dialog says: que's words (its RemoveProjectDialog), with deleting the
// worktrees made opt-in. Plain functions of the dialog's props, so the rules (one or many, what the
// checkbox adds) are tested in node (words.test.mjs).

/** `path` with ~ for the home folder. */
export function tilde(path, home) {
  const p = String(path ?? "");
  return home && (p === home || p.startsWith(`${home}/`)) ? `~${p.slice(home.length)}` : p;
}

/**
 * The dialog's lines, from its props { project, path, workspaces, worktrees, outside, busy } (see
 * main.js) and whether its checkbox is checked:
 * - title, body;
 * - checkbox: its label, or null when there is no worktree it could delete;
 * - when checked: list, each worktree { name, closed (no space is open in it), dirty }; kept,
 *   "Branches are kept."; lost, "Uncommitted changes are lost." when a listed worktree is dirty;
 *   outside, the line for the worktrees outside the root that are only closed;
 * - busy: why Remove is off, or null.
 */
export function removeWords(p, checked, home) {
  const open = Array.isArray(p?.workspaces) ? p.workspaces.length : 0;
  const worktrees = Array.isArray(p?.worktrees) ? p.worktrees : [];
  const outside = Number(p?.outside) || 0;
  const repo = `The repository at ${tilde(p?.path, home)} is not touched.`;
  const on = Boolean(checked) && worktrees.length > 0;
  return {
    title: `Remove ${p?.project || "this project"}?`,
    body:
      open === 0
        ? `It has no open workspaces. ${repo}`
        : open === 1
          ? `Its 1 workspace closes and its terminals are killed. ${repo}`
          : `Its ${open} workspaces close and their terminals are killed. ${repo}`,
    checkbox: worktrees.length === 0 ? null : worktrees.length === 1 ? `Also delete its worktree ${worktrees[0].name}` : `Also delete its ${worktrees.length} worktrees`,
    list: on ? worktrees.map((w) => ({ name: w.name, closed: !w.open, dirty: Boolean(w.dirty) })) : [],
    kept: on ? "Branches are kept." : null,
    lost: on && worktrees.some((w) => w.dirty) ? "Uncommitted changes are lost." : null,
    outside: on && outside > 0 ? `${outside} ${outside === 1 ? "worktree" : "worktrees"} outside ~/.herdr/worktrees ${outside === 1 ? "is" : "are"} only closed.` : null,
    busy: p?.busy ? "A workspace is being made in it; remove it once that's done." : null,
  };
}
