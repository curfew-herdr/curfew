// Curfew's project menu and its Remove project dialog, opened by curfew-sidebar (a project's ⋯, or
// a right-click on its head). Like the + menu (mods/curfew-new-session) this does no work itself: a
// choice goes back to the sidebar as a request in shared state, with a `curfew-sidebar.take` to
// wake it, and the overlay closes, since closing an overlay cancels its unfinished tasks.
// - props { kind: "menu", key, project }: a popup with New workspace… and Remove project…, in the
//   + menu's rows; ↑/↓ move, Enter picks, Esc closes (herdr's menu's keys). The choice goes
//   through shared("curfew-project-action") as { id, at, key, action: "new" | "remove" }.
// - props { kind: "remove", key, project, path, workspaces, worktrees, outside, busy }: que's
//   "Remove <project>?" (words.mjs), drawn like quiet hours' settings dialog. The sidebar worked out
//   what it would close and delete (its remove.mjs) before opening this, so it runs no git. A
//   checkbox, off by default, adds the project's worktrees under ~/.herdr/worktrees. Remove (Enter)
//   goes through shared("curfew-remove-project") as { id, at, key, spaces, worktrees }; Cancel (Esc)
//   closes; Space toggles the checkbox. The commands `curfew-project.toggle`, `.remove` and
//   `.cancel` do the same while it is open (for keys and scripts, as the + menu's commands do).
// No kind (herdr-app check gives no props): nothing is drawn.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, run, closeOverlay, shared, setShared, home, nextCommand } from "herdr";
import { removeWords } from "./words.mjs";

const ACTION = "curfew-project-action";
const REMOVE = "curfew-remove-project";
const STALE = 30_000; // the sidebar drops older requests, so they go when a new one is added
const MONO = "Menlo";
const MENU = [
  ["new", "plus", "New workspace…"],
  ["remove", "close", "Remove project…"],
];
const icon = (name, size = 14) => svg(`mods/curfew-project/${name}.svg`).size(size).flex_none();
// The bad tone (ansi9) with an alpha, behind and around Remove: que's danger button.
const tint = (color, alpha) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color);

// Adds a request to a shared list (dropping stale ones), then wakes the sidebar to take it: it sees
// the change at its next render too, but that waits for the window to draw.
function handOver(name, request) {
  const now = Date.now();
  const queue = Array.isArray(shared(name)) ? shared(name) : [];
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  setShared(name, [...queue.filter((r) => now - (Number(r?.at) || 0) < STALE), { id, at: now, ...request }]);
  run("curfew-sidebar.take");
}

export default class CurfewProject extends View {
  init(_props, cx) {
    this.kind = props()?.kind ?? null;
    this.at = 0; // the menu's highlighted row
    this.checked = false; // the dialog's checkbox: off until asked
    this.done = false; // one choice per menu, one Remove per dialog
    this.opened = Date.now();
    if (this.kind !== "menu" && this.kind !== "remove") return;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.kind !== "remove") return;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        cx.notify(); // cx first: it throws in a build a reload has replaced, which must not act
        // One sent before this dialog was on screen (waiting for the mod, say) was no choice made in it.
        if (Date.now() - this.opened < 300) continue;
        if (command === "toggle") this.toggle(cx);
        else if (command === "remove") this.remove();
        else if (command === "cancel") this.dismiss();
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  // ---- the menu ---------------------------------------------------------------------------------

  choose(action) {
    const p = props();
    if (this.done || typeof p?.key !== "string") return;
    this.done = true;
    handOver(ACTION, { key: p.key, action });
    closeOverlay(p.overlay);
  }

  renderMenu(t) {
    // It opens under the pointer: the second click of a double click on ⋯ is not a choice.
    const ready = () => Date.now() - this.opened > 300;
    return v_flex().id("curfew-project-menu").w_full().min_h(0).bg(t.popover).p(5).text_size(12.8)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % MENU.length;
        else if (e.key === "up") this.at = (this.at + MENU.length - 1) % MENU.length;
        else if (e.key === "enter") return this.choose(MENU[this.at][0]);
        else if (e.key === "escape") return this.dismiss();
        else return;
        cx.notify();
      })
      .children(MENU.map(([action, name, label], i) =>
        h_flex().id(`project-${action}`).h(31).px(9).gap(10).rounded(7).items_center().flex_none().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .on_hover((on, cx) => {
            if (on && this.at !== i) {
              this.at = i;
              cx.notify();
            }
          })
          .on_click(() => {
            if (ready()) this.choose(action);
          })
          .child(icon(name)).child(div().flex_1().child(label))));
  }

  // ---- the Remove dialog --------------------------------------------------------------------------

  toggle(cx) {
    this.handle.focus(); // a click keeps Enter, Esc and Space here
    if (!(Array.isArray(props()?.worktrees) && props().worktrees.length > 0)) return;
    this.checked = !this.checked;
    cx.notify();
  }

  remove() {
    const p = props();
    if (this.done || p?.busy || typeof p?.key !== "string") return;
    this.done = true;
    const worktrees = this.checked && Array.isArray(p.worktrees) ? p.worktrees.map((w) => w.path) : [];
    handOver(REMOVE, { key: p.key, spaces: Array.isArray(p.workspaces) ? p.workspaces : [], worktrees });
    closeOverlay(p.overlay);
  }

  key(e, cx) {
    if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
    if (e.key === "escape") this.dismiss();
    else if (e.key === "enter") this.remove();
    else if (e.key === "space" || e.key === " ") this.toggle(cx);
    else return;
    cx.stop_propagation();
  }

  renderRemove(t) {
    const p = props();
    const w = removeWords(p, this.checked, home());
    const busy = Boolean(p?.busy);
    const gap = (h) => div().h(h).flex_none();
    const hairline = () => div().h(1).flex_none().bg(t.border);
    const tag = (text, color) => div().flex_none().font_family(MONO).text_size(11).text_color(color).child(text);
    // quiet hours' buttons; Remove in the bad tone, faded while a workspace is being made.
    const button = (id, text, danger, action) => {
      const off = danger && busy;
      return h_flex().id(id).h(26).px(11).items_center().rounded(2).border(1).text_size(12.5).font_medium()
        .border_color(danger ? tint(t.ansi9, "73") : t.border)
        .bg(danger ? tint(t.ansi9, "29") : t.popover)
        .text_color(danger ? t.ansi9 : t.foreground)
        .when(off, (el) => el.opacity(0.4))
        .when(!off, (el) => el.cursor_pointer().hover((s) => (danger ? s.bg(t.ansi9).border_color(t.ansi9).text_color(t.foreground) : s.bg(t.hover).border_color(t.input))))
        .on_click(action)
        .child(text);
    };
    const checkbox = h_flex().id("remove-worktrees").h(24).flex_none().gap(8).items_center().cursor_pointer()
      .on_click((_e, cx) => this.toggle(cx))
      .child(h_flex().size(14).flex_none().items_center().justify_center().rounded(2).border(1)
        .border_color(this.checked ? t.accent : t.input).bg(this.checked ? t.accent : t.chrome)
        .when(this.checked, (el) => el.child(icon("check", 12).text_color(t.accent_foreground))))
      .child(div().flex_1().min_w(0).truncate().child(w.checkbox ?? ""));
    // Checked: what goes, under the checkbox.
    const list = v_flex().flex_none().pl(22)
      .child(v_flex().id("remove-list").max_h(8 * 22).overflow_y_scroll()
        .children(w.list.map((x, i) => h_flex().id(`remove-wt-${i}`).h(22).flex_none().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(x.name))
          .when(x.closed, (el) => el.child(tag("closed", t.dim)))
          .when(x.dirty, (el) => el.child(tag("uncommitted changes", t.blocked))))))
      .child(h_flex().pt(6).gap(4).flex_none().text_size(12.5)
        .child(div().text_color(t.muted).child(w.kept ?? ""))
        .when(Boolean(w.lost), (el) => el.child(div().text_color(t.blocked).child(w.lost))))
      .when(Boolean(w.outside), (el) => el.child(div().pt(2).text_size(12.5).text_color(t.muted).child(w.outside)));
    const card = v_flex().w_full().flex_none().bg(t.popover).border(1).border_color(t.input).rounded(2).px(20).pt(16).pb(16).text_size(13).text_color(t.foreground)
      .child(h_flex().h(18).flex_none().justify_between().items_center()
        .child(div().font_family(MONO).text_size(10.5).text_color(t.dim).child("[ REMOVE PROJECT ]"))
        .child(div().font_family(MONO).text_size(10.5).text_color(t.dim).child("esc")))
      .child(gap(12))
      .child(div().min_w(0).truncate().text_size(14).font_semibold().child(w.title))
      .child(gap(8))
      .child(div().text_color(t.muted).child(w.body))
      .when(Boolean(w.checkbox), (el) => el.child(gap(14)).child(hairline()).child(gap(10)).child(checkbox).when(this.checked, (c) => c.child(list)))
      .child(gap(14))
      .child(hairline())
      .child(gap(12))
      .when(Boolean(w.busy), (el) => el.child(div().text_size(12.5).text_color(t.blocked).child(w.busy)).child(gap(10)))
      .child(h_flex().flex_none().justify_end().gap(8)
        .child(button("remove-cancel", "Cancel", false, () => this.dismiss()))
        .child(button("remove-go", "Remove", true, () => this.remove())));
    // Sized to its content and centred in the overlay, which the sidebar opens tall enough for the
    // checked list and a long path (a card taller than the overlay would be cut). The frame's four
    // corner points sit on its border (que's dialogs).
    const corner = (el) => el.absolute().size(5).bg(t.dim);
    return v_flex().id("curfew-remove-project").size_full().justify_center()
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(v_flex().relative().w_full().flex_none().p(3).child(card)
        .child(corner(div().top(0).left(0)))
        .child(corner(div().top(0).right(0)))
        .child(corner(div().bottom(0).left(0)))
        .child(corner(div().bottom(0).right(0))));
  }

  render() {
    const t = theme();
    if (this.kind === "menu") return this.renderMenu(t);
    if (this.kind === "remove") return this.renderRemove(t);
    return div();
  }
}
