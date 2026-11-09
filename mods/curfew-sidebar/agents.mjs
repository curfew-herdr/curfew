// The sidebar's AGENTS (main.js draws them): a row per agent herdr knows, the ones that need
// the person first. Pure functions with no herdr imports, so `node --test` runs them.
//
// A row is named as the quiet board names its rows (rowName in mods/quiet-hours/names.mjs, which
// this mod can't import: keep the two the same): its Claude Code session's own name (titles.mjs
// reads it); else its tab's, when someone named the tab; else the program. Its project is its
// space's: the repository's name from the git answer main.js already has, else the folder's name.

import { sessionLabel } from "./titles.mjs";

/** A Claude Code agent, as herdr reports it: the agent's own report, else the program. */
export const isClaudeAgent = (a) => a?.app === "claude-code" || a?.program?.key === "claude";

/** An agent's terminal title as its program set it. herdr gives a terminal with no title its
 *  address instead (`t2c`; on another machine `vps/t2c`), which is no name. */
export function agentTitle(a) {
  const title = a?.title ?? "";
  const address = a?.address ?? "";
  return title === address || title === address.split("/").pop() ? "" : title;
}

/** An agent's row name: its Claude Code session's name; else its tab's, when someone named the tab
 *  (`named`: the tab's `named`, from spaces()); else what runs there, else its tab. */
export function agentName(a, named) {
  return (isClaudeAgent(a) && sessionLabel(agentTitle(a))) || (named ? a.tab_name : a.program?.name || a.tab_name || `tab ${a.tab_index}`);
}

/** herdr's statuses as an agent row words them: the space rows' words, without their times or
 *  programs. Another status is shown as herdr gives it. */
const WORDS = { blocked: "needs input", working: "working", done: "done", idle: "idle" };
export const agentWord = (status) => WORDS[status] ?? String(status ?? "");

/** The rows' order: needs input, working, done, idle, anything else; herdr's order (space, tab,
 *  pane) within each. */
const ORDER = ["blocked", "working", "done", "idle"];
const rank = (a) => {
  const i = ORDER.indexOf(a?.status);
  return i < 0 ? ORDER.length : i;
};
export const sortAgents = (list) => [...list].sort((a, b) => rank(a) - rank(b));

/** A folder's own name; `~` for the home folder, and for no folder (herdr's empty folder is the
 *  home). `home`: null when unknown (a space on another machine). */
export function folderName(folder, home) {
  const trim = (path) => String(path ?? "").replace(/(.)\/+$/, "$1");
  const f = trim(folder);
  if (f === "" || (home && f === trim(home))) return "~";
  return f.split("/").pop() || f;
}

/** An agent's project from its space's git answer (`git`: { name } in a repository, null outside
 *  one, undefined before git has answered) and the space's folder: the repository's name, else the
 *  folder's; "" until git answers. */
export function agentProject(git, folder, home) {
  return git ? git.name : git === null ? folderName(folder, home) : "";
}
