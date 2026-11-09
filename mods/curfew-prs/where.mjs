// The folder the review panel follows, curfew-changes' rule: the focused pane's, else the focused
// block's; for a mod pane (a diff tab has no folder) a terminal's in the same tab, else in the same
// space; else the shown space's folder. `on`: the machine it is on (null: this one).
import { spaces, panes, focused } from "herdr";

export function where() {
  const space = spaces().find((s) => s.active);
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : (space?.machine ?? null);
  const tabs = new Set(space?.tabs.map((tab) => tab.id) ?? []);
  const sibling =
    pane && !pane.cwd
      ? (panes().find((p) => p.tab === pane.tab && p.cwd) ?? panes().find((p) => tabs.has(p.tab) && p.cwd))
      : null;
  return { cwd: pane?.cwd || f?.cwd || sibling?.cwd || space?.folder || null, on };
}
