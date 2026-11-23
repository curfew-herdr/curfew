// Curfew's project menu and space menu and their dialogs, Remove project and Close, opened by
// curfew-sidebar (a project's ⋯, or a right-click on its head; a space row's ⋯, or a right-click on
// it). Like the + menu (mods/curfew-new-session) this does no work itself: a choice runs one of
// herdr's commands or opens herdr's dialog, or goes back to the sidebar as a request in shared state,
// with a `curfew-sidebar.take` to wake it, and the overlay closes, since closing an overlay cancels
// its unfinished tasks.
// - props { kind: "menu", key, project }: a popup with New workspace… and Remove project…, in the
//   + menu's rows; ↑/↓ move, Enter picks, Esc closes (herdr's menu's keys). The choice goes
//   through shared("curfew-project-action") as { id, at, key, action: "new" | "remove" }.
// - props { kind: "space", space, git, workspace }: herdr's space menu in the same rows, as herdr's
//   menu mod can't ask about a worktree: its items and icons, Rename, New worktree and Open worktree
//   (git: the space's checkout, "main" or "linked"), Remove worktree (a linked one) and Close, each
//   run as herdr's menu runs it. Close of a workspace (workspace: the sidebar can delete its
//   worktree) goes back as { id, at, action: "close", space }, for the Close dialog; any other
//   Close is herdr's space.close, which asks in its own dialog.
// - props { kind: "remove", key, project, path, workspaces, worktrees, outside, busy }: que's
//   "Remove <project>?" (words.mjs), drawn like quiet hours' settings dialog. The sidebar worked out
//   what it would close and delete (its remove.mjs) before opening this, so it runs no git. A
//   checkbox, off by default, adds the project's worktrees under ~/.herdr/worktrees. Remove (Enter)
//   goes through shared("curfew-remove-project") as { id, at, key, spaces, worktrees }; Cancel (Esc)
//   closes; Space toggles the checkbox. The commands `curfew-project.toggle`, `.remove` and
//   `.cancel` do the same while it is open (for keys and scripts, as the + menu's commands do).
// - props { kind: "close", space, name, key, path, dirty }: "Close <name>?" (words.mjs), drawn as
//   Remove is. A checkbox, on by default, also deletes its worktree (path; dirty: it has
//   uncommitted changes, said checked or not). Close (Enter) goes through
//   shared("curfew-close-workspace") as { id, at, space, key, path, delete }: the sidebar closes the
//   space and deletes, this runs no git and no space.close. Cancel (Esc) closes; Space toggles the
//   checkbox; `curfew-project.toggle`, `.close` and `.cancel` do the same while it is open.
// No kind (herdr-app check gives no props): nothing is drawn.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { layout, theme, props, run, openOverlay, closeOverlay, shared, setShared, home, nextCommand } from "herdr";
import { closeWords, removeWords } from "./words.mjs";

// que's --fg-secondary (#c9c9c9) lies between foreground and muted; the theme has no name for it.
// The tone of a head's label.
function secondary(t) {
  const ch = (c, i) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(t.foreground, i) * 0.55 + ch(t.muted, i) * 0.45).toString(16).padStart(2, "0")).join("");
}

const ACTION = "curfew-project-action";
const REMOVE = "curfew-remove-project";
const CLOSE = "curfew-close-workspace";
const STALE = 30_000; // the sidebar drops older requests, so they go when a new one is added
const MONO = "Menlo";
// The labels' font: a layout names its own with "label_font" in any block's props (sumi-work
// does); without one they are Menlo, as in Curfew.
const labelFont = () => {
  const seek = (node) => {
    const own = node?.content?.props?.label_font;
    if (typeof own === "string" && own) return own;
    for (const child of node?.children ?? []) { const found = seek(child); if (found) return found; }
    return null;
  };
  try { return seek(layout()) ?? MONO; } catch { return MONO; }
};
// One of this folder's icons, or by its path one of herdr's that its space menu draws, from the
// person's install (not copied here).
const icon = (name, size = 14) => svg(name.includes("/") ? name : `mods/curfew-project/${name}.svg`).size(size).flex_none();
const PEN = "mods/workspace-chrome/square-pen.svg";
const BRANCH = "mods/workspace-chrome/git-branch.svg";
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

// A menu's rows, [id, icon, label, pick]: a project's (kind "menu"), or a space's, herdr's menu's
// items (its `case "space"`) with the worktree dialog's sizes from its choose.
function items(kind, p) {
  if (kind === "menu")
    return [
      ["new", "plus", "New workspace…", () => handOver(ACTION, { key: p.key, action: "new" })],
      ["remove", "close", "Remove project…", () => handOver(ACTION, { key: p.key, action: "remove" })],
    ];
  const space = p?.space;
  const small = { width: 440, height: 260 };
  const worktree = (action, size) => () => openOverlay({ mod: "worktree", kind: "dialog", ...size, props: { space, action } });
  return [
    ["rename", PEN, "Rename", () => run("space.rename", { id: space })],
    ...(p?.git ? [["new-worktree", BRANCH, "New worktree", worktree("new", small)], ["open-worktree", BRANCH, "Open worktree", worktree("open", { width: 560, height: 480 })]] : []),
    ...(p?.git === "linked" ? [["remove-worktree", BRANCH, "Remove worktree", worktree("remove", small)]] : []),
    ["close", "close", "Close", () => (p?.workspace === true ? handOver(ACTION, { action: "close", space }) : run("space.close", { id: space }))],
  ];
}

// ---- the dialogs' parts ---------------------------------------------------------------------------

const gap = (h) => div().h(h).flex_none();
const hairline = (t) => div().h(1).flex_none().bg(t.border);
const tag = (text, color) => div().flex_none().font_family(labelFont()).text_size(11).text_color(color).child(text);
const title = (text) => div().min_w(0).truncate().text_size(14).font_semibold().child(text);
const body = (t, text) => div().text_color(t.muted).child(text);
// What checking the box costs, under it: what is kept, then what is lost in the blocked tone.
const kept = (t, w) => h_flex().gap(4).flex_none().text_size(12.5)
  .child(div().text_color(t.muted).child(w.kept ?? ""))
  .when(Boolean(w.lost), (el) => el.child(div().text_color(t.blocked).child(w.lost)));
// quiet hours' buttons; a danger one in the bad tone (Remove; Close once it deletes), faded while
// it is off (a workspace being made).
const button = (t, id, text, danger, off, action) =>
  h_flex().id(id).h(26).px(11).items_center().rounded(2).border(1).text_size(12.5).font_medium()
    .border_color(danger ? tint(t.ansi9, "73") : t.border)
    .bg(danger ? tint(t.ansi9, "29") : t.popover)
    .text_color(danger ? t.ansi9 : t.foreground)
    .when(off, (el) => el.opacity(0.4))
    .when(!off, (el) => el.cursor_pointer().hover((s) => (danger ? s.bg(t.ansi9).border_color(t.ansi9).text_color(t.foreground) : s.bg(t.hover).border_color(t.input))))
    .on_click(action)
    .child(text);
// The card, quiet hours' settings dialog, with its head: what it is, and esc.
const card = (t, head) =>
  v_flex().w_full().flex_none().bg(t.popover).border(1).border_color(t.input).rounded(2).px(20).pt(16).pb(16).text_size(13).text_color(t.foreground)
    .child(h_flex().h(18).flex_none().justify_between().items_center()
      .child(div().font_family(labelFont()).text_size(10.5).text_color(secondary(t)).child(head))
      .child(div().font_family(labelFont()).text_size(10.5).text_color(t.dim).child("esc")))
    .child(gap(12));

export default class CurfewProject extends View {
  init(_props, cx) {
    this.kind = props()?.kind ?? null;
    this.at = 0; // the menu's highlighted row
    this.checked = this.kind === "close"; // the dialog's checkbox: Close's starts on, Remove's off
    this.done = false; // one choice per menu, one Remove or Close per dialog
    this.opened = Date.now();
    if (!["menu", "space", "remove", "close"].includes(this.kind)) return;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.kind !== "remove" && this.kind !== "close") return;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        cx.notify(); // cx first: it throws in a build a reload has replaced, which must not act
        // One sent before this dialog was on screen (waiting for the mod, say) was no choice made in it.
        if (Date.now() - this.opened < 300) continue;
        if (command === "toggle") this.toggle(cx);
        else if (command === this.kind) this.confirm(); // .remove in Remove, .close in Close
        else if (command === "cancel") this.dismiss();
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  // ---- the menus --------------------------------------------------------------------------------

  // One choice per menu. A request for the sidebar (a project's choice, a workspace's Close) goes
  // over, then the menu closes; a space's other choices close the menu first, as herdr's does, so
  // the prompt or dialog they open has the keyboard.
  choose(it) {
    const p = props();
    if (this.done || !it || typeof (this.kind === "space" ? p?.space : p?.key) !== "string") return;
    this.done = true;
    const request = this.kind !== "space" || (it[0] === "close" && p.workspace === true);
    if (!request) closeOverlay(p.overlay);
    it[3]();
    if (request) closeOverlay(p.overlay);
  }

  renderMenu(t) {
    const list = items(this.kind, props());
    const name = this.kind === "space" ? "space" : "project";
    // It opens under the pointer: the second click of a double click on ⋯ is not a choice.
    const ready = () => Date.now() - this.opened > 300;
    return v_flex().id(`curfew-${name}-menu`).w_full().min_h(0).bg(t.popover).p(5).text_size(12.8)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") return this.choose(list[this.at]);
        else if (e.key === "escape") return this.dismiss();
        else return;
        cx.notify();
      })
      .children(list.map(([id, glyph, label], i) =>
        h_flex().id(`${name}-${id}`).h(31).px(9).gap(10).rounded(7).items_center().flex_none().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .on_hover((on, cx) => {
            if (on && this.at !== i) {
              this.at = i;
              cx.notify();
            }
          })
          .on_click(() => {
            if (ready()) this.choose(list[i]);
          })
          .child(icon(glyph)).child(div().flex_1().child(label))));
  }

  // ---- the dialogs --------------------------------------------------------------------------------

  toggle(cx) {
    this.handle.focus(); // a click keeps Enter, Esc and Space here
    if (this.kind === "remove" && !(Array.isArray(props()?.worktrees) && props().worktrees.length > 0)) return;
    this.checked = !this.checked;
    cx.notify();
  }

  // Enter, and the dialog's own command.
  confirm() {
    if (this.kind === "remove") this.remove();
    else if (this.kind === "close") this.closeWorkspace();
  }

  remove() {
    const p = props();
    if (this.done || p?.busy || typeof p?.key !== "string") return;
    this.done = true;
    const worktrees = this.checked && Array.isArray(p.worktrees) ? p.worktrees.map((w) => w.path) : [];
    handOver(REMOVE, { key: p.key, spaces: Array.isArray(p.workspaces) ? p.workspaces : [], worktrees });
    closeOverlay(p.overlay);
  }

  // The space, its project's key and its worktree go back as they came; checked, the sidebar
  // deletes the worktree once the space has closed.
  closeWorkspace() {
    const p = props();
    if (this.done || typeof p?.space !== "string") return;
    this.done = true;
    handOver(CLOSE, { space: p.space, key: p.key, path: p.path, delete: this.checked });
    closeOverlay(p.overlay);
  }

  key(e, cx) {
    if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
    if (e.key === "escape") this.dismiss();
    else if (e.key === "enter") this.confirm();
    else if (e.key === "space" || e.key === " ") this.toggle(cx);
    else return;
    cx.stop_propagation();
  }

  checkbox(t, id, label) {
    return h_flex().id(id).h(24).flex_none().gap(8).items_center().cursor_pointer()
      .on_click((_e, cx) => this.toggle(cx))
      .child(h_flex().size(14).flex_none().items_center().justify_center().rounded(2).border(1)
        .border_color(this.checked ? t.accent : t.input).bg(this.checked ? t.accent : t.chrome)
        .when(this.checked, (el) => el.child(icon("check", 12).text_color(t.accent_foreground))))
      .child(div().flex_1().min_w(0).truncate().child(label ?? ""));
  }

  // Cancel, then the dialog's own button.
  buttons(t, id, text, danger, off, action) {
    return h_flex().flex_none().justify_end().gap(8)
      .child(button(t, `${id}-cancel`, "Cancel", false, false, () => this.dismiss()))
      .child(button(t, `${id}-go`, text, danger, off, action));
  }

  // A card sized to its content and centered in the overlay, which the sidebar opens tall enough
  // for it checked (a card taller than the overlay would be cut). The frame's four corner points
  // sit on its border (que's dialogs).
  framed(t, id, inner) {
    const corner = (el) => el.absolute().size(5).bg(t.dim);
    return v_flex().id(id).size_full().justify_center()
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .child(v_flex().relative().w_full().flex_none().p(3).child(inner)
        .child(corner(div().top(0).left(0)))
        .child(corner(div().top(0).right(0)))
        .child(corner(div().bottom(0).left(0)))
        .child(corner(div().bottom(0).right(0))));
  }

  renderRemove(t) {
    const p = props();
    const w = removeWords(p, this.checked, home());
    const busy = Boolean(p?.busy);
    // Checked: what goes, under the checkbox.
    const list = v_flex().flex_none().pl(22)
      .child(v_flex().id("remove-list").max_h(8 * 22).overflow_y_scroll()
        .children(w.list.map((x, i) => h_flex().id(`remove-wt-${i}`).h(22).flex_none().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(x.name))
          .when(x.closed, (el) => el.child(tag("closed", t.dim)))
          .when(x.dirty, (el) => el.child(tag("uncommitted changes", t.blocked))))))
      .child(kept(t, w).pt(6))
      .when(Boolean(w.outside), (el) => el.child(div().pt(2).text_size(12.5).text_color(t.muted).child(w.outside)));
    return this.framed(t, "curfew-remove-project", card(t, "REMOVE PROJECT")
      .child(title(w.title))
      .child(gap(8))
      .child(body(t, w.body))
      .when(Boolean(w.checkbox), (el) => el.child(gap(14)).child(hairline(t)).child(gap(10)).child(this.checkbox(t, "remove-worktrees", w.checkbox)).when(this.checked, (c) => c.child(list)))
      .child(gap(14))
      .child(hairline(t))
      .child(gap(12))
      .when(Boolean(w.busy), (el) => el.child(div().text_size(12.5).text_color(t.blocked).child(w.busy)).child(gap(10)))
      .child(this.buttons(t, "remove", "Remove", true, busy, () => this.remove())));
  }

  // Every line has a fixed height, the path cut at its start rather than wrapped: the card is 245
  // tall, 271 checked, dirty or not (6 frame, 2 border, 32 padding, then 18 + 12 + 22 + 8 + 21,
  // 25 + 24 + 22 for the checkbox and the path, 26 for what checking costs, 27 + 26 for the buttons).
  renderClose(t) {
    const p = props();
    const w = closeWords(p, this.checked, home());
    // Under the checkbox: the worktree it deletes, and whether it has changes, checked or not;
    // checked, what that costs.
    const what = v_flex().flex_none().pl(22)
      .child(h_flex().h(22).flex_none().gap(8).items_center()
        .child(tag(w.where, t.dim).flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_start())
        .when(Boolean(w.dirty), (el) => el.child(tag(w.dirty, t.blocked))))
      .when(this.checked, (el) => el.child(gap(6)).child(kept(t, w).h(20).items_center()));
    return this.framed(t, "curfew-close-workspace", card(t, "CLOSE WORKSPACE")
      .child(title(w.title).line_height("22px"))
      .child(gap(8))
      .child(body(t, w.body).truncate().line_height("21px"))
      .child(gap(14))
      .child(hairline(t))
      .child(gap(10))
      .child(this.checkbox(t, "close-worktree", w.checkbox))
      .child(what)
      .child(gap(14))
      .child(hairline(t))
      .child(gap(12))
      .child(this.buttons(t, "close", w.button, this.checked, false, () => this.closeWorkspace())));
  }

  render() {
    const t = theme();
    if (this.kind === "menu" || this.kind === "space") return this.renderMenu(t);
    if (this.kind === "remove") return this.renderRemove(t);
    if (this.kind === "close") return this.renderClose(t);
    return div();
  }
}
