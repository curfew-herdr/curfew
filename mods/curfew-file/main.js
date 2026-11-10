// que's file tab, in herdr: a tab in the middle whose only pane is this mod, showing one file
// read-only. Files opens it for a file with no changes (a changed one opens its diff tab,
// curfew-diff), or selects it where it is already open (curfew-files' filetab.js).
//   props { folder, file, on? }: `file` absolute or relative to `folder`; `on`, a space on
//   another machine: the file is read there.
// A 36px header as the diff tab's toolbar: the path from the folder in Menlo 11, its folders `dim`
// and cut from their start so the name (`muted`) stays whole, the whole path the tooltip. Under it
// the file in herdr's Editor, read-only (select and copy), highlighted by its extension
// (view.mjs) in the diff tab's colors. Read once, when the tab opens, as Files' in-panel preview
// was: readTextFile's 1 MiB, the first 400,000 characters shown; a missing, binary or unreadable
// file says so in dim text.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { props, readTextFile, theme } from "herdr";
import { absoluteFile, shownPath, languageOf, textOf, UNREADABLE } from "./view.mjs";

const MONO = "Menlo", BAR_H = 36;

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
    const folder = typeof p.folder === "string" ? p.folder : null;
    this.on = typeof p.on === "string" ? p.on : null;
    this.file = absoluteFile(folder, p.file);
    this.path = shownPath(folder, p.file);
    this.code = null; this.error = null;
    if (this.file) this.load(cx);
  }

  close() { this.closed = true; this.code?.release(); this.code = null; }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const shown = textOf(await readTextFile(this.file, { on: this.on }));
        if (this.closed) return;
        if (shown.error) this.error = shown.error;
        else this.code = EditorState.new({ language: languageOf(this.file), readonly: true, value: shown.value, font_family: MONO, font_size: 12, syntax: syntax(theme()) });
      } catch { this.error = UNREADABLE; }
      finally { if (!this.closed) cx.notify(); }
    });
  }

  header(t) {
    const text = this.path, cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) + 1;
    return h_flex().id("cf-header").h(BAR_H).flex_none().pl(16).pr(8).items_center().bg(t.background).border_b(1).border_color(t.border)
      .font_family(MONO).text_size(11).text_color(t.dim)
      .child(h_flex().id("cf-path").min_w(0).flex_shrink(1).overflow_hidden().whitespace_nowrap().tooltip(this.file ?? text)
        .when(cut > 0, (e) => e.child(div().min_w(0).flex_shrink(1).overflow_hidden().whitespace_nowrap().text_ellipsis_start().child(text.slice(0, cut))))
        .child(div().flex_none().text_color(t.muted).child(text.slice(cut))));
  }

  render() {
    const t = theme();
    const message = !this.file ? "No file to show." : this.error ?? "Loading file…";
    return v_flex().id("curfew-file").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.header(t))
      .child(this.code ? Editor.new(this.code).flex_1().min_h(0)
        : div().flex_1().min_h(0).bg(t.chrome).px(16).py(14).text_size(12).text_color(t.dim).child(message));
  }
}
