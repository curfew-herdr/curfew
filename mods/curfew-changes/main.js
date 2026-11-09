// que's Changes view, in herdr: a clone of the shipped `changes` panel (its commit box kept),
// drawn flat on the review pane's surface the way que draws it: `[ CHANGES ]` with `+a −d · n files`
// in mono at the right, rows of glyph, path, a 5px attention dot while uncommitted, and `+a −d` in
// the diff tones. It lists what que's does: the worktree against its base (the merge base of
// origin's default branch and HEAD, to the working tree, untracked files included), the same
// scope as the diff tab. Files where only comments changed come last, under `comments only · n
// files · +a −d`. As in que, a file's diff opens as a tab of its own in the middle (the curfew-diff
// mod), not inside the panel, and a file whose tab is open selects that tab (difftab.js); the row
// whose diff tab is the one shown reads as selected. The base and the file set are base.js's, as
// the strip's count and the Files marks are. Key command `curfew-changes.open-<n>`: the n-th file.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, nextCommand } from "herdr";
import { parsePatch } from "./patch.js";
import { markFile, commentOnly } from "./comments.js";
import { READ, STATUS as STATUS_ARGS, MAX_UNTRACKED, MAX_FILES, diffFrom, readStatus } from "./base.js";
import { openDiff, shownDiff, diffKey, settle } from "./difftab.js";

const MONO = "Menlo";
// que's glyph tones (diff.ts): added good, modified neutral, deleted bad, untracked attention.
const GLYPH = (f, t) => (f.fresh ? ["?", t.blocked] : f.status === "A" ? ["A", t.done] : f.status === "D" || f.status === "U" ? [f.status, t.ansi9] : ["M", t.idle]);
const label = (t, text) => div().font_family(MONO).text_size(10).font_medium().text_color(t.dim).child(`[ ${text} ]`);

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
const STATUS = { added: "A", deleted: "D", modified: "M", renamed: "M" };
// A file's diff tab: the worktree's file against the base.
const diffProps = (root, path, on) => ({ kind: "changes", folder: root, file: path, ...(on ? { on } : {}) });

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.message = ""; this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const n = /^open-(\d+)$/.exec(c);
        if (n && this.files[Number(n[1]) - 1]) this.pick(this.files[Number(n[1]) - 1].path);
        cx.notify();
      }
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = [];
      this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(STATUS_ARGS);
        if (status.code !== 0) throw new Error(status.stderr);
        const from = await diffFrom(git);
        const diff = await git(["diff", "--no-color", "--no-ext-diff", "--no-renames", ...(from ? [from] : ["--cached"])]);
        if (diff.code !== 0) throw new Error(diff.stderr);
        const { fresh, conflicts, dirty } = readStatus(status.stdout);
        // Untracked files are all added, as que's diff has them; their text says whether they are comments only.
        let untracked = "";
        for (const path of fresh.slice(0, MAX_UNTRACKED)) {
          const r = await git(["diff", "--no-index", "--no-color", "--no-ext-diff", "--", "/dev/null", path]);
          if (r.code <= 1 && r.stdout) untracked += (untracked && !untracked.endsWith("\n") ? "\n" : "") + r.stdout;
        }
        const freshSet = new Set(fresh);
        const files = [];
        for (const f of [...parsePatch(diff.stdout), ...parsePatch(untracked)].map(markFile)) {
          const isFresh = freshSet.has(f.path);
          files.push({ path: f.path, status: conflicts.has(f.path) ? "U" : STATUS[f.status] ?? "M", fresh: isFresh, add: f.add, del: f.del, binary: f.binary, dirty: dirty.has(f.path) || isFresh, comments: commentOnly(f) });
        }
        // Every untracked and conflicted file is listed (base.js's set), past the lines read too.
        const listed = new Set(files.map((f) => f.path));
        for (const path of [...fresh, ...conflicts]) if (!listed.has(path)) { listed.add(path); files.push({ path, status: conflicts.has(path) ? "U" : "A", fresh: freshSet.has(path), add: 0, del: 0, dirty: true, comments: false }); }
        files.sort((a, b) => Number(a.comments) - Number(b.comments));
        const limited = files.length > MAX_FILES;
        files.length = Math.min(files.length, MAX_FILES);
        if (key() !== context) return;
        this.root = root; this.on = on; this.files = files; this.limited = limited; this.error = null;
        this.watch(root, cx);
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  pick(path) {
    if (this.root) openDiff(diffProps(this.root, path, this.on), path.split("/").pop());
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }


  render(cx) {
    settle();
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    const shown = this.root ? shownDiff() : null;
    const mono = (text, color) => div().flex_none().font_family(MONO).text_size(11).text_color(color).child(text);
    const sums = (f, el) => el.when(f.add > 0, (e) => e.child(mono(`+${f.add}`, t.done))).when(f.del > 0, (e) => e.child(mono(`−${f.del}`, t.ansi9)));
    return v_flex().id("changes").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().flex_none().px(12).pt(12).pb(6).gap(8).items_center()
        .child(label(t, "CHANGES")).child(div().flex_1())
        .when(add > 0, (el) => el.child(mono(`+${add}`, t.done)))
        .when(del > 0, (el) => el.child(mono(`−${del}`, t.ansi9)))
        .child(mono(`${add || del ? "· " : ""}${this.files.length} file${this.files.length === 1 ? "" : "s"}`, t.dim)))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).relative()
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().px(8).py(4).gap(1).children(this.files.flatMap((f, i) => {
          const parts = f.path.split("/"), name = parts.pop(), [glyph, tone] = GLYPH(f, t), on = Boolean(shown) && shown === diffKey(diffProps(this.root, f.path, this.on));
          // que: the files where only comments changed come last, under one faint line lined up with the paths.
          const only = this.files.filter((x) => x.comments);
          const group = f.comments && !this.files[i - 1]?.comments
            ? [div().h(22).flex_none().pl(30).flex().items_center().font_family(MONO).text_size(11).text_color(t.dim).truncate()
              .child(`comments only · ${only.length} file${only.length === 1 ? "" : "s"} · +${only.reduce((n, x) => n + x.add, 0)} −${only.reduce((n, x) => n + x.del, 0)}`)]
            : [];
          return [...group, sums(f, h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(4).cursor_pointer()
            .text_color(on ? t.foreground : t.muted).when(on, (e) => e.bg(t.selected)).when(!on, (e) => e.hover((s) => s.bg(t.hover)))
            .on_click(() => this.pick(f.path))
            .child(div().w(14).flex_none().font_family(MONO).text_size(11).font_medium().text_color(tone).child(glyph))
            .child(h_flex().flex_1().min_w(0).items_center().child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(name))
              // que: an uncommitted file carries a 5px attention dot after its name.
              .when(Boolean(f.dirty), (e) => e.child(div().ml(6).size(5).flex_none().rounded_full().bg(t.blocked)).tooltip("uncommitted"))))];
        })).when(!this.files.length, (e) => e.child(div().px(12).py(12).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No changes." : "No folder.")))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, el => el.child(div().px(12).py(4).font_family(MONO).text_size(11).text_color(t.dim).child("the first 1,000 changed files")))
      .when(Boolean(this.note), (e) => e.child(div().px(12).pb(8).text_size(11).text_color(t.ansi9).child(this.note)))
      .child(h_flex().flex_none().px(8).py(8).gap(6).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(28).px(8).flex().items_center().rounded(2).bg(t.background).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().font_family(MONO).text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(28).px(10).flex().items_center().rounded(2).border_1().border_color(enabled ? t.solid : t.border).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).font_medium().when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit")));
  }
}
