// que's tab row, in herdr: the shown space's tabs, flat, over a dashed guide. A tab reads the
// program running in it (claude, zsh, node); the active one is bright with an accent underline;
// its × waits for the pointer (half strength on the active tab); + is always there; split beside
// and split below sit at the right end. A tab whose agent works, needs you or finished unseen
// carries a 5px dot in that tone.

import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, exec, openOverlay, theme, layout, settings, window as appWindow } from "herdr";

const icon = (name) => svg(`mods/curfew-tabs/${name}.svg`).size(16).flex_none();
const LOUD = new Set(["working", "blocked", "done"]);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// que's --fg-secondary (#c9c9c9) lies between foreground and muted; the theme has no name for it.
function between(a, b, w) {
  const ch = (c, i) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - w) + ch(b, i) * w).toString(16).padStart(2, "0")).join("");
}

// Its name if someone named it, else the program in it (its agent first) by process name;
// herdr calls every shell "Shell", que says which one (zsh).
function label(tab, ps, shell) {
  if (tab.named) return tab.name;
  const mine = ps.filter((p) => p.tab === tab.id);
  const p = mine.find((x) => x.program?.agent) ?? mine.find((x) => x.focused) ?? mine[0];
  if (!p) return tab.name;
  if (!p.terminal) return p.title || p.mod || tab.name;
  const g = p.program;
  return !g ? tab.name : g.shell ? shell ?? g.name : g.key === "program" ? g.name : g.key;
}

// A diff tab (the curfew-diff mod) carries a line icon before its name, as que's do: a pull
// request's (`#123`) the branch-merge mark, a file's the page with ±.
function modIcon(tab, ps) {
  if (!ps.some((p) => p.tab === tab.id && p.mod === "curfew-diff")) return null;
  return svg(`mods/curfew-diff/${tab.name.startsWith("#") ? "pr" : "diff-tab"}.svg`).size(14).flex_none();
}

// The tooltip: its folder, then the title its program set.
function tip(tab, ps) {
  const p = ps.find((x) => x.tab === tab.id && x.focused) ?? ps.find((x) => x.tab === tab.id);
  return [p?.cwd, p?.title].filter(Boolean).join("\n") || tab.name;
}

export default class QueTabs extends View {
  init(_props, cx) {
    this.hover = null;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("/bin/sh", ["-c", 'basename "$SHELL"']);
        if (r.code === 0 && r.stdout.trim()) { this.shell = r.stdout.trim(); cx.notify(); }
      } catch {}
    });
    // que's guide: 6px on, 6px off, in the border colour.
    this.dash = PathBuilder.stroke(1).move_to(0, 0.5).line_to("100%", 0.5).dash_array([6, 6]).build();
  }

  render() {
    const t = theme(), ps = panes();
    const space = spaces().find((s) => s.active);
    const secondary = between(t.foreground, t.muted, 0.45);
    const stop = (_e, cx) => cx.stop_propagation();
    // With the sidebar hidden the window buttons sit over this row: leave them room.
    const root = layout(), sidebar = find(root, "sidebar"), w = appWindow();
    const lights = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(8, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 8;
    const ghost = (id, name, text, action) => h_flex().id(id).size(22).flex_none().self_center().items_center().justify_center().rounded(2)
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(text)
      .on_mouse_down("left", stop).on_click(action).child(icon(name));
    const tab = (c) => {
      const hot = this.hover === c.id, mark = modIcon(c, ps);
      return h_flex().id(`tab-${c.id}`).relative().h_full().flex_none().items_center().text_size(13)
        .text_color(c.active ? t.foreground : hot ? secondary : t.muted)
        .tooltip(tip(c, ps))
        .on_hover((on, cx) => {
          const next = on ? c.id : this.hover === c.id ? null : this.hover;
          if (next !== this.hover) { this.hover = next; cx.notify(); }
        })
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_click(() => run("tab.select", { id: c.id }))
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } });
        })
        .child(h_flex().px(8).gap(6).items_center()
          .when(Boolean(mark), (el) => el.child(mark))
          .child(div().max_w(180).truncate().child(label(c, ps, this.shell)))
          .when(LOUD.has(c.status), (el) => el.child(div().size(5).flex_none().rounded_full().bg(t[c.status]))))
        .child(div().id(`close-${c.id}`).pr(8).opacity(c.active || hot ? 0.5 : 0).hover((s) => s.opacity(1))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
          .child("×"))
        .when(c.active, (el) => el.child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)));
    };
    return div().id("curfew-tabs").relative().size_full().bg(t.background)
      .child(globalThis.window.paint_path(this.dash, t.border).absolute().left(0).right(0).bottom(0).h(1))
      .child(h_flex().size_full().pl(lights).pr(8).gap(2).items_stretch()
        .child(h_flex().id("que-tab-scroll").min_w(0).flex_shrink(1).h_full().items_stretch().gap(2).overflow_x_scroll()
          .children((space?.tabs ?? []).map(tab)))
        .child(ghost("tab-new", "plus", "New tab", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).ml(4))
        .child(div().flex_1())
        .child(h_flex().flex_none().pl(6).gap(2).items_center()
          .child(ghost("split-beside", "split-beside", "Split beside", () => run("pane.split", { direction: "right" })))
          .child(ghost("split-below", "split-below", "Split below", () => run("pane.split", { direction: "down" })))));
  }
}
