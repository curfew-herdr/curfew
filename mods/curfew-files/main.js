// que's Files view, in herdr: a clone of the shipped `files` panel (the same lazy tree; its bounded
// read-only previews are curfew-file's tabs now), drawn flat the way que draws it: `FILES` with the
// changed count in mono, 22px rows of 13px text, 12px of indent per level, a chevron per directory
// and per file its Seti icon in its type's color, as VS Code's default icon theme draws it
// (icons.mjs, seti/), both in one 16px column; a changed file reads bright
// with its glyph, an unchanged one muted, a deleted one faint; a directory counts its changes.
// The changes are the ones the Changes view lists (base.js: que's base, untracked included), with
// its glyphs. As in que, a changed file opens its diff as a tab in the middle (curfew-diff), or
// selects its tab where it is open (difftab.js); an unchanged one opens there read-only as a file
// tab (curfew-file), or selects its tab (filetab.js). A row reads selected while its tab shows.
// The panel shows only the tree.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, window } from "herdr";
import { READ, changedFiles } from "./base.js";
import { openDiff, shownDiff, diffKey, settle } from "./difftab.js";
import { openFile, shownFile, fileKey, settleFiles } from "./filetab.js";
import { fileProps } from "./filekey.mjs";
import { fileIcon } from "./icons.mjs";

const MONO = "Menlo";
// que's glyph tones (Changes'): added good, deleted and conflicted bad, untracked attention, modified neutral.
const TONE = (mark, t) => (mark === "A" ? t.done : mark === "D" || mark === "U" ? t.ansi9 : mark === "?" ? t.blocked : t.idle);

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const PER_FOLDER = 500, TOTAL = 5000;

// A changed file's diff tab: `file` is absolute.
const diffProps = (folder, file, on) => ({ kind: "changes", folder, file, ...(on ? { on } : {}) });

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          const root = top.stdout.trim();
          // Reads that write nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const changed = await changedFiles((args) => exec("git", [...READ, ...args], { cwd: root, on })).catch(() => null);
          for (const [path, mark] of changed?.files ?? []) marks[`${root}/${path}`] = mark;
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  rows(prefix, depth, out, t, marks, shown) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), full = `${this.root}/${path}`, mark = this.marks[full];
      const tally = entry.dir ? marks.filter((m) => m.startsWith(full + "/")).length : 0;
      const color = entry.dir ? this.secondary : mark === "D" ? t.dim : mark ? t.foreground : t.muted;
      // Its tab shows: a changed file's diff, or any file's file tab.
      const on = !entry.dir && ((Boolean(mark && shown.diff) && shown.diff === diffKey(diffProps(this.root, full, this.on)))
        || (Boolean(shown.file) && shown.file === fileKey(fileProps(this.root, full, this.on))));
      const glyph = entry.dir ? null : fileIcon(entry.name);
      out.push(h_flex().id(`file-${path}`).h(22).flex_none().pl(4 + depth * 12).pr(8).gap(4).items_center().rounded(4).cursor_pointer()
        .text_size(13).text_color(color).when(on, (e) => e.bg(t.selected)).when(!on, (e) => e.hover(s => s.bg(t.hover)))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : mark ? openDiff(diffProps(this.root, full, this.on), entry.name) : openFile(fileProps(this.root, full, this.on), entry.name))
        .child(h_flex().size(16).flex_none().items_center().justify_center().child(glyph
          ? svg(`mods/curfew-files/seti/${glyph.icon}.svg`).size(20).flex_none().text_color(glyph.color)
          : svg(`mods/curfew-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim)))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark) && !entry.dir, el => el.child(div().flex_none().font_family(MONO).text_size(11).font_medium().text_color(TONE(mark, t)).child(mark)))
        .when(tally > 0, el => el.child(div().flex_none().font_family(MONO).text_size(11).text_color(t.dim).child(String(tally)))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t, marks, shown);
    }
    return out;
  }

  render(cx) {
    settle(); settleFiles();
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), marks = Object.keys(this.marks);
    // que's --fg-secondary (#c9c9c9) lies between foreground and muted; the theme has no name for it.
    const ch = (c, i) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
    this.secondary = "#" + [0, 1, 2].map((i) => Math.round(ch(t.foreground, i) * 0.55 + ch(t.muted, i) * 0.45).toString(16).padStart(2, "0")).join("");
    const mono = (text, color) => div().font_family(MONO).text_size(11).text_color(color).child(text);
    return v_flex().id("files").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13)
      .child(h_flex().flex_none().px(12).pt(12).pb(6).gap(8).items_center()
        .child(div().flex_none().font_family(MONO).text_size(10).font_medium().text_color(this.secondary).child("FILES"))
        .child(div().flex_1())
        .child(mono([this.root?.split(/[\\/]/).pop(), marks.length ? `${marks.length} changed` : ""].filter(Boolean).join(" · "), t.dim)))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().px(8).py(4).children(this.rows("", 0, [], t, marks, { diff: shownDiff(), file: shownFile() }))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().px(4).py(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files." : "No folder."))))
        .when(this.limited, el => el.child(div().px(4).py(8).font_family(MONO).text_size(11).text_color(t.dim).child("500 a folder, 5,000 in all"))));
  }
}
