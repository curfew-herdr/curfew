// A split pane's top edge, the way que marks the focused pane: a 1px accent line on the pane that
// has the keyboard, the terminal's own background on the others. layouts/curfew.json draws it only
// on split tabs (its pane frame has "lone": false), so a single pane has none, as in que.

import { View, div } from "gpui-kit";
import { panes, props, theme } from "herdr";

export default class QuePane extends View {
  render() {
    const t = theme();
    const p = panes().find((x) => x.pane === props()?.pane);
    return div().size_full().bg(p?.focused ? t.accent : t.background);
  }
}
