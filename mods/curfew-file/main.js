// que's file tab, in herdr: a tab in the middle whose only pane is this mod, showing one file,
// editable where that is safe. Files opens it for a file with no changes (a changed one opens its
// diff tab, curfew-diff), or selects it where it is already open (curfew-files' filetab.js).
//   props { folder, file, on? }: `file` absolute or relative to `folder`; `on`, a space on
//   another machine: the file is read there, and only read.
// A 36px header as the diff tab's toolbar: the path from the folder in Menlo 11, its folders `dim`
// and cut from their start so the name (`muted`) stays whole, the whole path the tooltip; at its
// right, Save while there are edits, a dim Changed on disk with Reload and Overwrite in a conflict,
// or a dim Read-only with the reason for its tooltip. Under it the file in herdr's Editor,
// highlighted by its extension (view.mjs) in the diff tab's colors. Read when the tab opens and
// again when the file's folder changes on this machine (an edit in another editor shows here):
// readTextFile's 1 MiB, the first 400,000 characters shown; a missing, binary or unreadable file
// says so in dim text.
// It takes edits where a save would give back exactly what was read (view.mjs' editable: this
// machine, under the folder, whole UTF-8 text under 1 MiB, and the Editor's value as it was given),
// else it is read-only as before. ⌘S or Save writes with writeTextFile's compare-and-swap against
// the text last read (`disk`), so a file changed since is never written over: that, or a change on
// disk while there are edits, is a conflict, and the edits stay until Reload (the file's text) or
// Overwrite (the edits over it). A change with no edits shows, as before; the tab's own save coming
// back is nothing new. Closing with edits saves them the same way, an error toast if it can't.
// The tab bar's dirty mark: shared `curfew-file.dirty`, the file's key (fileKey) -> true while there
// are edits, written only when that flips.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { props, readTextFile, writeTextFile, watchFolder, theme, shared, setShared, notify } from "herdr";
import { absoluteFile, shownPath, languageOf, textOf, editable, fileKey, marked, afterRead, refused, UNREADABLE, REWRITES } from "./view.mjs";

const MONO = "Menlo", BAR_H = 36, DIRTY = "curfew-file.dirty";

// Two theme colours mixed: `w` of b into a (curfew-diff's, for its in-between tones).
function mix(a, b, w) {
  const ch = (c, i) => parseInt(String(c).slice(1 + 2 * i, 3 + 2 * i), 16);
  if (![a, b].every((c) => /^#[0-9a-f]{6}/i.test(String(c)))) return a;
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - w) + ch(b, i) * w).toString(16).padStart(2, "0")).join("");
}

// The diff tab's code colours (its palette()), by the Editor's names for them.
function syntax(t) {
  const text = mix(t.foreground, t.muted, 0.3);
  return {
    keyword: t.ansi12, constant: t.ansi12, boolean: t.ansi12, string: mix(t.ansi3, t.ansi11, 0.35),
    number: mix(t.ansi10, t.foreground, 0.45), function: mix(t.ansi11, t.foreground, 0.55),
    type: mix(t.ansi6, t.ansi14, 0.5), comment: t.ansi2, punctuation: text,
  };
}

export default class CurfewFile extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.folder = typeof p.folder === "string" ? p.folder : null;
    this.on = typeof p.on === "string" ? p.on : null;
    this.file = absoluteFile(this.folder, p.file);
    this.path = shownPath(this.folder, p.file);
    this.name = String(this.file ?? "").split(/[\\/]/).pop();
    this.key = fileKey(this.on, this.file);
    // The text last read (`disk`: undefined before the first read, null for a file gone), the
    // editor and whether it takes edits (`writable`, else `why`), the edits (`dirty`), a newer text
    // on disk while there are edits (`conflict`: { text }), and a save on its way (`writing`: its text).
    this.code = null; this.error = null; this.writable = false; this.why = null;
    this.disk = undefined; this.dirty = false; this.conflict = null; this.writing = null; this.resave = null;
    const stale = marked(shared(DIRTY), this.key, false); // a mark left by a copy before this one (quit mid-close)
    if (stale) setShared(DIRTY, stale);
    if (this.file) { this.load(cx); this.watch(cx); }
  }

  // The tab goes, and the host doesn't wait for a choice: edits are saved as ⌘S would, an error
  // toast naming the file when they can't be (a conflict's never are). The editor goes first: its
  // text is all the save needs, and cleanup has 250 ms.
  async close() {
    this.closed = true;
    const text = this.writable && this.dirty ? this.code.value() : null, expected = this.disk, conflict = this.conflict;
    this.mark(false);
    this.code?.release(); this.code = null;
    if (text === null) return;
    if (conflict) { notify({ title: `Could not save ${this.name}`, body: "It changed on disk while you edited it", level: "error" }); return; }
    try { await writeTextFile(this.file, text, expected); }
    catch (e) {
      let now = expected;
      try { now = await readTextFile(this.file); } catch {}
      if (refused({ text, expected }, now) !== "saved") notify({ title: `Could not save ${this.name}`, body: String(e?.message ?? e), level: "error" });
    }
  }

  // Reads the file, and afterRead says what that does: the first read makes the editor, a later one
  // (the file changed on disk) changes the tab only where the text differs, so a tab left alone
  // stays as it is.
  load(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(this.file, { on: this.on });
        if (!this.closed) this.read(text, cx);
      } catch { if (!this.code) this.error = UNREADABLE; }
      finally {
        this.loading = false;
        if (!this.closed) cx.notify();
        if (this.again && !this.closed) { this.again = false; this.load(cx); }
      }
    });
  }

  // A read: nothing for the text the tab has or its own save; with edits, the file holding them
  // leaves none, and anything else (gone and binary too) waits as a conflict, the editor untouched.
  read(text, cx) {
    const value = this.writable ? this.code.value() : null;
    switch (afterRead({ disk: this.disk, value, writing: this.writing }, text)) {
      case "same": this.conflict = null; break;
      case "match": this.disk = text; this.conflict = null; this.mark(false, cx); break;
      case "conflict": this.conflict = { text }; break;
      case "show": this.show(text, cx); break;
    }
  }

  // A text with no edits in its way, shown: the editor's text replaced where it differs, the editor
  // made again only when it should take edits and doesn't, or the other way round.
  show(text, cx) {
    const shown = textOf(text), can = editable({ folder: this.folder, file: this.file, on: this.on, text });
    this.disk = text; this.conflict = null; this.error = shown.error ?? null;
    if (shown.error) this.drop();
    else {
      if (this.code && this.writable === can.ok) { if (this.code.value() !== shown.value) this.code.set_value(shown.value); }
      else this.make(shown.value, can.ok);
      this.why = can.ok ? null : can.why;
      // An Editor that gives the text back otherwise (its own line endings) would save that: read-only.
      if (this.writable && this.code.value() !== text) { this.make(shown.value, false); this.why = REWRITES; }
    }
    this.mark(false, cx);
  }

  // The editor for a text: it takes edits, and tells of them, only where they may be saved.
  make(value, writable) {
    this.drop();
    const code = EditorState.new({ language: languageOf(this.file), readonly: !writable, value, font_family: MONO, font_size: 12, syntax: syntax(theme()) });
    if (writable) code.on("change", (_e, cx) => { if (this.code === code) this.changed(cx); });
    this.code = code; this.writable = writable;
  }

  drop() { this.code?.release(); this.code = null; this.writable = false; }

  // An edit, or an undo back: dirty while the editor's text isn't the file's as last read. Edits
  // that come to a conflict's newer text end it.
  changed(cx) {
    const value = this.code.value();
    if (this.conflict && value === this.conflict.text) { this.disk = value; this.conflict = null; cx.notify(); }
    this.mark(value !== this.disk, cx);
  }

  // Edits or none, and the tab bar's mark for them, written only when that flips (setShared
  // re-renders every mod), over the marks as they are now.
  mark(dirty, cx) {
    if (dirty === this.dirty) return;
    this.dirty = dirty;
    const next = marked(shared(DIRTY), this.key, dirty);
    if (next) setShared(DIRTY, next);
    cx?.notify();
  }

  // ⌘S or Save, or Overwrite (`over`): the editor's text, written only while the file is still what
  // the tab last read (Overwrite: what the conflict found), so nothing changed since is written
  // over; a refusal reads the file again (refused). One save at a time: one asked for meanwhile
  // runs after it. In a conflict only Overwrite writes.
  save(cx, over = false) {
    if (!this.writable || this.closed || (over ? !this.conflict : this.conflict)) return;
    if (this.writing !== null) { this.resave = { over }; return; }
    const text = this.code.value(), expected = over ? this.conflict.text : this.disk;
    if (text === expected) return;
    this.writing = text;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(this.file, text, expected);
        if (!this.closed) this.saved(text, expected, cx);
      } catch (e) {
        let now = expected;
        try { now = await readTextFile(this.file); } catch {}
        if (this.closed) return;
        const was = refused({ text, expected }, now);
        if (was === "saved") this.saved(text, expected, cx);
        else if (was === "conflict") this.read(now, cx);
        else notify({ title: `Could not save ${this.name}`, body: String(e?.message ?? e), level: "error" });
      } finally {
        this.writing = null;
        const again = this.resave;
        this.resave = null;
        if (!this.closed) { cx.notify(); if (again) this.save(cx, again.over); }
      }
    });
  }

  // A save landed: its text is the file's as last read, edits made since still edits. The conflict
  // it answered ends; one that came after it shows, if there are no edits left.
  saved(text, expected, cx) {
    this.disk = text;
    if (this.conflict && (this.conflict.text === expected || this.conflict.text === text)) this.conflict = null;
    this.mark(this.writable && this.code.value() !== text, cx);
    if (this.conflict && !this.dirty) this.show(this.conflict.text, cx);
  }

  // Reload: the edits go, and the file as the conflict found it shows (a file gone says so).
  reload(cx) {
    if (!this.conflict || this.writing !== null) return;
    this.show(this.conflict.text, cx);
    cx.notify();
  }

  // The file's folder, watched while the tab is open (this machine's files): a change under it
  // reads the file again. A folder herdr won't watch leaves the tab as read when it opened.
  watch(cx) {
    if (this.on) return;
    const dir = this.file.slice(0, Math.max(this.file.lastIndexOf("/"), 1));
    cx.spawn(async (cx) => {
      try {
        while (!this.closed) {
          await watchFolder(dir);
          if (!this.closed) this.load(cx);
        }
      } catch {}
    });
  }

  // A word in the header, drawn as curfew-bar's ghost buttons are: dim, the hover colour and the
  // foreground under the pointer, a press kept from the pane under it.
  button(id, label, tip, t, action) {
    return h_flex().id(id).h(22).px(6).flex_none().items_center().rounded(2)
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => action(cx)).child(label);
  }

  header(t) {
    const text = this.path, cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) + 1;
    const side = h_flex().ml_auto().pl(8).flex_none().gap(2).items_center();
    return h_flex().id("cf-header").h(BAR_H).flex_none().pl(16).pr(8).items_center().bg(t.background).border_b(1).border_color(t.border)
      .font_family(MONO).text_size(11).text_color(t.dim)
      .child(h_flex().id("cf-path").min_w(0).flex_shrink(1).overflow_hidden().whitespace_nowrap().tooltip(this.file ?? text)
        .when(cut > 0, (e) => e.child(div().min_w(0).flex_shrink(1).overflow_hidden().whitespace_nowrap().text_ellipsis_start().child(text.slice(0, cut))))
        .child(div().flex_none().text_color(t.muted).child(text.slice(cut))))
      .child(this.conflict
        ? side.child(div().pr(4).child("Changed on disk"))
          .child(this.button("cf-reload", "Reload", "Drop the edits for the file as it is on disk", t, (cx) => this.reload(cx)))
          .child(this.button("cf-overwrite", "Overwrite", "Save the edits over the file on disk", t, (cx) => this.save(cx, true)))
        : this.dirty ? side.child(this.button("cf-save", "Save", "Save (⌘S)", t, (cx) => this.save(cx)))
        : this.code && !this.writable ? side.child(div().id("cf-readonly").tooltip(this.why ?? "Read-only").child("Read-only"))
        : side);
  }

  // ⌘S comes up to the root from the Editor that has the keyboard: a tab that takes edits saves
  // (not in a conflict), and the key goes no further.
  render() {
    const t = theme();
    const message = !this.file ? "No file to show." : this.error ?? "Loading file…";
    return v_flex().id("curfew-file").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => { if (e.keystroke === "cmd-s" && this.writable) { cx.stop_propagation(); this.save(cx); } })
      .child(this.header(t))
      .child(this.code ? Editor.new(this.code).flex_1().min_h(0)
        : div().flex_1().min_h(0).bg(t.chrome).px(16).py(14).text_size(12).text_color(t.dim).child(message));
  }
}
