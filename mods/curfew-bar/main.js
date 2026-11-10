// que's review pane chrome, in herdr. props.role "bar" (default): the pane's 40px strip over its
// Pull requests / Changes / Files stack: the view icons at the left, the current one bright with a
// 1px line under it, the open and draft pull requests beside Pull requests and the changed-file
// count beside Changes (the files the Changes view lists: que's base and file set, base.js), and »
// at the right end to fold the pane. The pull request count comes from
// the curfew-prs mod: its check.mjs (a mod can't import another's modules), which shares the
// stored worktrees with the panel, and the panel's `curfew-prs` shared signal.
// Left of », for a space on this machine: open the folder Changes and Files show (its repo's top)
// in the code editor, with the shown file tab's or worktree diff tab's file in front when it is
// inside. The editor (editor.mjs), found once per run: settings.json's `curfew.editor`, else the
// app macOS opens most of a few empty source files with (browsers never); none, plain `open`.
// props.role "rail": the folded pane, a 40px column: « to unfold it, then the view icons stacked,
// each with its count under it. The node ids are this layout's (layouts/curfew.json).

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  spaces, panes, focused, exec, watchFolder, theme, layout, run, props, shared, setShared, appHome, settings, readTextFile, notify,
} from "herdr";
import { READ, changedFiles } from "./base.js";
import { PROBES, PROBE_SCRIPT, probeAnswers, appName, editorSetting, chooseEditor, shownPath, openArgs } from "./editor.mjs";

const MONO = "Menlo";
const PANE = "review", RAIL = "review-rail", STACK = "review-body";
// The curfew-prs mod's: its check, its shared signal, and its tick (2.5 minutes).
const PRS_CHECK = () => `${appHome()}/mods/curfew-prs/check.mjs`, PRS_SIGNAL = "curfew-prs", PRS_EVERY = 150_000;
const samePath = (a, b) => String(a ?? "").replace(/\/+$/, "") === String(b ?? "").replace(/\/+$/, "");
const VIEWS = [
  { id: "prs", icon: "mods/curfew-prs/pull-request", name: "Pull requests" },
  { id: "changes", icon: "changes", name: "Changes" },
  { id: "files", icon: "folder", name: "Files" },
];
const icon = (name) => svg(`${name.includes("/") ? name : `mods/curfew-bar/${name}`}.svg`).size(16).flex_none();

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The folder Changes and Files show: the focused pane's, else the shown space's (as theirs do).
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

// The folder Pull requests follows (curfew-prs' where.mjs, which a mod can't import): the same,
// except that a mod pane (a diff tab has no folder) takes a terminal's in its tab, else its space's.
function prLocation() {
  const at = location(), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  if (!pane || pane.cwd) return at;
  const space = spaces().find((s) => s.active), tabs = new Set(space?.tabs.map((t) => t.id) ?? []);
  const sibling = panes().find((p) => p.tab === pane.tab && p.cwd) ?? panes().find((p) => tabs.has(p.tab) && p.cwd);
  return { ...at, cwd: f?.cwd || sibling?.cwd || at.cwd };
}

function open(view) {
  if (view) run("layout.select", { stack: STACK, child: view });
  run("layout.show", { id: PANE });
  run("layout.hide", { id: RAIL });
}

function fold() {
  run("layout.hide", { id: PANE });
  run("layout.show", { id: RAIL });
}

// The key of the file the shown tab shows when it is a file tab or a diff tab: the shared maps
// their openers remember them in (curfew-files' filetab.js and difftab.js).
function shownKey() {
  const tab = spaces().find((s) => s.active)?.tabs.find((t) => t.active);
  return tab ? shared("curfew-file.tabs")?.[tab.id] ?? shared("curfew-diff.tabs")?.[tab.id] ?? null : null;
}

// The editor: settings.json's `curfew.editor` (settings() holds only herdr's own keys, so the file
// is read too, as herdr's settings do), else what macOS opens PROBES' empty files with.
async function findEditor() {
  let app = editorSetting(settings());
  if (!app) try { app = editorSetting(JSON.parse((await readTextFile(`${appHome()}/settings.json`)) ?? "{}")); } catch {}
  return app ?? (await askMacos());
}

// LaunchServices' default app for each probe, in one osascript; the files and their folder go.
async function askMacos() {
  const tmp = await exec("mktemp", ["-d"], { timeout: 10000 }), dir = tmp.code === 0 ? tmp.stdout.trim() : "";
  if (!dir.startsWith("/")) return null;
  const files = PROBES.map((ext) => `${dir}/probe.${ext}`);
  try {
    if ((await exec("touch", files, { timeout: 10000 })).code !== 0) return null;
    const r = await exec("osascript", ["-l", "JavaScript", "-e", PROBE_SCRIPT, ...files], { timeout: 30000 });
    return r.code === 0 ? chooseEditor(probeAnswers(r.stdout)) : null;
  } finally {
    await exec("rm", ["-f", ...files], { timeout: 10000 }).catch(() => {});
    await exec("rmdir", [dir], { timeout: 10000 }).catch(() => {});
  }
}

export default class QueReview extends View {
  init(_props, cx) {
    this.key = null;
    this.count = undefined; // changed files where Changes looks; undefined: not a repo, or not known yet
    this.prKey = null;
    this.prRoot = null;
    this.prCount = undefined; // open and draft pull requests of the worktree Pull requests follows
    this.editorFound = null; // the editor's app once asked for: a promise of its path or name, or null
    this.app = null;
    cx.timer.every(PRS_EVERY, (cx) => this.checkPrs(cx));
  }

  // The worktree's open and draft pull requests, from curfew-prs' check (here only: it runs this
  // machine's node). A check the panel made lately is adopted, not repeated.
  checkPrs(cx) {
    const where = prLocation(), key = JSON.stringify(where);
    if (key !== this.prKey) { this.prKey = key; this.prCount = undefined; this.prRoot = null; }
    if (!where.cwd || where.on) return;
    if (this.prLoading) { this.prAgain = true; return; }
    this.prLoading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("node", [PRS_CHECK(), where.cwd], { timeout: 180_000 });
        const out = JSON.parse(r.stdout);
        if (this.prKey !== key) return;
        this.prRoot = out.root ?? null;
        this.prCount = out.root && typeof out.open === "number" ? out.open : undefined;
        if (out.ran && out.root) setShared(PRS_SIGNAL, { root: out.root, open: out.open, at: Date.now(), from: "curfew-bar" });
      } catch {}
      finally {
        this.prLoading = false;
        cx.notify();
        if (this.prAgain) { this.prAgain = false; this.checkPrs(cx); }
      }
    });
  }

  // The panel saved this worktree's pull requests: its count is the one to show.
  followPrs() {
    const s = shared(PRS_SIGNAL);
    if (!s || s.at === this.prSignal || typeof s.open !== "number") return;
    this.prSignal = s.at;
    // Without a root of its own (node didn't run), the folder followed being inside the panel's will do.
    const cwd = prLocation().cwd ?? "", root = String(s.root ?? "").replace(/\/+$/, "");
    if (this.prRoot ? samePath(s.root, this.prRoot) : root && (cwd === root || cwd.startsWith(`${root}/`))) this.prCount = s.open;
  }

  // The files the Changes view lists (base.js: que's base, untracked included, at most as many),
  // read again on every change under the repo, as the Changes view itself is. Names only: a status,
  // the base's few lookups and one `diff --name-status`, all reads that write nothing under .git.
  refresh(cx) {
    const where = location(), key = JSON.stringify(where);
    if (key !== this.key) { this.key = key; this.count = undefined; this.root = null; }
    if (!where.cwd) return;
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        let root = this.root;
        if (!root) {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: where.cwd, on: where.on, timeout: 10000 });
          if (this.key !== key) return;
          if (top.code !== 0) { this.count = undefined; return; }
          root = top.stdout.trim();
        }
        const { files } = await changedFiles((args) => exec("git", [...READ, ...args], { cwd: root, on: where.on, timeout: 10000 }));
        if (this.key !== key) return;
        this.count = files.size;
        if (!this.root) {
          this.root = root;
          if (!where.on) this.watch(root, key, cx);
        }
      } catch { if (this.key === key) this.count = undefined; }
      finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  watch(root, key, cx) {
    cx.spawn(async (cx) => {
      try {
        while (this.key === key) {
          await watchFolder(root);
          if (this.key === key) this.refresh(cx);
        }
      } catch {}
    });
  }

  // The editor's app (path or name), found once per run; null: none, so plain `open`.
  editor(cx) {
    if (!this.editorFound) {
      let found;
      this.editorFound = new Promise((resolve) => { found = resolve; });
      cx.spawn(async (cx) => {
        let app = null;
        try { app = await findEditor(); } catch {}
        this.app = app;
        cx.notify();
        found(app);
      });
    }
    return this.editorFound;
  }

  // The folder Changes and Files show, at its repo's top, in the editor; the shown tab's file in
  // front when it is inside. An `open` that fails says why.
  openEditor(cx) {
    const where = location(), key = JSON.stringify(where);
    if (!where.cwd || where.on) return;
    cx.spawn(async (cx) => {
      let app = null;
      try {
        let folder = this.key === key ? this.root : null;
        if (!folder) {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: where.cwd, timeout: 10000 });
          folder = top.code === 0 && top.stdout.trim() ? top.stdout.trim() : where.cwd;
        }
        app = await this.editor(cx);
        const r = await exec("open", openArgs(app, folder, shownPath(shownKey(), folder)), { timeout: 30000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `open exited with ${r.code}`);
      } catch (e) {
        notify({ title: `Couldn't open ${app ? appName(app) : "the editor"}`, body: String(e?.message ?? e), level: "error" });
      }
    });
  }

  ghost(id, name, text, t, action) {
    return h_flex().id(id).size(22).flex_none().self_center().items_center().justify_center().rounded(2)
      .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(text)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(icon(name));
  }

  countOf(view, t) {
    const n = view === "changes" ? this.count : view === "prs" ? this.prCount : undefined;
    return n === undefined ? null : div().font_family(MONO).text_size(11).text_color(t.dim).child(String(n));
  }

  bar(t) {
    const current = find(layout(), STACK)?.active ?? "changes", local = !location().on;
    const view = (v) => {
      const on = v.id === current, n = this.countOf(v.id, t);
      return h_flex().id(`view-${v.id}`).relative().h_full().px(8).gap(4).flex_none().items_center()
        .text_color(on ? t.foreground : t.dim).hover((s) => s.text_color(on ? t.foreground : t.muted))
        .tooltip(v.name)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => open(v.id))
        .child(icon(v.icon))
        .when(Boolean(n), (el) => el.child(n))
        .when(on, (el) => el.child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.foreground)));
    };
    return div().id("curfew-bar").relative().size_full().bg(t.chrome)
      .child(div().absolute().left(0).right(0).bottom(0).h(1).bg(t.border))
      .child(h_flex().size_full().pl(4).pr(6).gap(2).items_stretch()
        .children(VIEWS.map(view))
        .child(div().flex_1())
        .when(local, (el) => el.child(this.ghost("review-editor", "open-editor",
          this.app ? `Open in ${appName(this.app)}` : "Open in editor", t, (_e, cx) => this.openEditor(cx))))
        .child(this.ghost("review-fold", "chevrons-right", "Hide review", t, () => fold())));
  }

  rail(t) {
    return v_flex().id("curfew-bar-rail").size_full().bg(t.chrome).items_center().gap(4)
      .child(h_flex().h(40).w_full().flex_none().items_center().justify_center().border_b(1).border_color(t.border)
        .child(this.ghost("review-unfold", "chevrons-left", "Show review", t, () => open(null))))
      .children(VIEWS.map((v) => {
        const n = this.countOf(v.id, t);
        return v_flex().id(`rail-${v.id}`).w(28).py(6).gap(2).flex_none().items_center().rounded(2)
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(v.name)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => open(v.id))
          .child(icon(v.icon))
          .when(Boolean(n), (el) => el.child(n));
      }));
  }

  render(cx) {
    if (JSON.stringify(location()) !== this.key) this.refresh(cx);
    if (JSON.stringify(prLocation()) !== this.prKey) this.checkPrs(cx);
    this.followPrs();
    const t = theme(), rail = props()?.role === "rail";
    if (!rail && !location().on) this.editor(cx); // its name for the tooltip
    return rail ? this.rail(t) : this.bar(t);
  }
}
