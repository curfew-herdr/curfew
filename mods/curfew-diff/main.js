// que's diff tab, in herdr: a tab in the middle whose only pane is this mod, showing one file. The
// review pane is the only list of files: Changes, Files and Pull requests open a file's tab, or
// select it where it is already open (their difftab.js). Read-only.
//   props { kind: "changes", folder, file, on? }: that file of the worktree against que's base
//     (base.js: the merge base of origin's default branch and HEAD, to the working tree, untracked
//     files included), read again when the file or the repository changes.
//   props { kind: "pr", repo: "owner/name", number, folder?, file }: that file of `gh pr diff`,
//     with its review threads, fetched once on open and again with the refresh button.
//   Without `file`, the first file as the lists order them (code before comment-only files).
// A 36px toolbar as que's: the path (its folders cut from their start, so the name stays whole),
// `+a −d` (code apart from comments), for a pull request `#n vs <base>`; at its right Comments ▾,
// Threads and Threaded hunks (a pull request's file with review threads), Unified | Split, Wrap,
// Whitespace and refresh. Under it the file's lines, unified or split, its review threads under
// their lines (each folds at its head). Changed lines that are only a code comment are drawn as
// que draws them: dimmed (the default), shown as code, or folded to one row per run (`Comments
// dimmed ▾`, remembered per project). A file with nothing left to compare reads `No changes in`.
// Props that start a tab in a state (tests, links): view "unified" | "split", wrap, whitespace,
// commentMode "dim" | "show" | "fold", keepRemoved, menu "open" (the Comments menu), openRuns
// "all", threads "shown" | "hidden", filter "all" | "threads", collapse "resolved" | "outdated" |
// "all" | [thread ids], thread (an id: opens scrolled to it). Without `collapse` every thread
// starts open, as que shows every line comment.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { props, exec, watchFolder, theme, shared, setShared } from "herdr";
import * as M from "./model.js";
import { tokenize, extOf } from "./highlight.js";
import { wordChanges, splitTokens, wrapTokens, Memo } from "./vendor.js";
import { markFile, splitCounts, commentOnlyLast, countParts } from "./comments.js";
import { READ, MAX_UNTRACKED, diffFrom } from "./base.js";

const MONO = "Menlo", PREFS = "curfew-diff.prefs", COMMENTS = "curfew-diff.comments";
// The Comments menu's words, as que's (MODE_WORD, MODES).
const MODE_WORD = { dim: "dimmed", show: "shown", fold: "folded" };
const MODES = [{ mode: "dim", label: "Dim", hint: "default" }, { mode: "show", label: "Show", hint: "as code" }, { mode: "fold", label: "Fold", hint: "one row each" }];
const BAR_H = 36;
const DEFAULTS = { view: "unified", wrap: true, whitespace: "show" };
const CONTROL = new Set("if else for while do return await import export from break continue switch case throw try catch finally yield async go defer select match loop".split(" "));
const QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){title url baseRefName headRefName reviewThreads(first:100){nodes{id path line originalLine startLine diffSide isResolved isOutdated comments(first:50){nodes{author{login} body createdAt url}}}}}}}`;
const icon = (name, size = 16) => svg(`mods/curfew-diff/${name}.svg`).size(size).flex_none();

// Two theme colours mixed: `w` of b into a (que's in-between tones, from the theme's own).
function mix(a, b, w) {
  const ch = (c, i) => parseInt(String(c).slice(1 + 2 * i, 3 + 2 * i), 16);
  if (![a, b].every((c) => /^#[0-9a-f]{6}/i.test(String(c)))) return a;
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - w) + ch(b, i) * w).toString(16).padStart(2, "0")).join("");
}

export default class CurfewDiff extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.kind = p.kind === "pr" ? "pr" : "changes";
    this.folder = typeof p.folder === "string" ? p.folder.replace(/\/$/, "") : null;
    this.on = typeof p.on === "string" ? p.on : null; // a space on another machine: git runs there
    this.repo = p.repo ?? null;
    this.number = Number(p.number) || null;
    this.wanted = typeof p.file === "string" && p.file ? p.file : null;
    // A pull request's paths are the repository's; a worktree's is worked out from its root.
    this.path = this.kind === "pr" && this.wanted ? this.wanted.replace(/^\.\//, "") : null;
    this.wantedThread = typeof p.thread === "string" ? p.thread : null; // a review thread's id: open there
    this.over = {
      view: p.view === "split" || p.view === "unified" ? p.view : undefined,
      wrap: typeof p.wrap === "boolean" ? p.wrap : undefined,
      whitespace: p.whitespace === "ignore" || p.whitespace === "show" ? p.whitespace : undefined,
    };
    this.hide = p.threads === "hidden";
    this.only = p.filter === "threads";
    this.commentOver = {
      mode: M.COMMENT_MODES.includes(p.commentMode) ? p.commentMode : undefined,
      keepRemoved: typeof p.keepRemoved === "boolean" ? p.keepRemoved : undefined,
    };
    this.menu = p.menu === "open";
    this.openRuns = new Set(); this.openAllRuns = p.openRuns === "all";
    this.collapse = p.collapse ?? null;
    this.closedThreads = new Set();
    this.file = null; this.threads = []; this.placed = null; this.loaded = false;
    this.built = null; this.dirty = true; this.width = 0;
    this.scroll = VirtualListScrollHandle.new();
    this.tokens = new Memo(4096); this.words = new Memo(1024);
    this.load(cx, true);
  }

  close() { this.watched = null; this.scroll.release(); }

  pref(name) { return this.over[name] ?? shared(PREFS)?.[name] ?? DEFAULTS[name]; }
  setPref(name, value, cx) {
    this.over[name] = undefined;
    setShared(PREFS, { ...(shared(PREFS) ?? {}), [name]: value });
    this.dirty = true; cx.notify();
  }

  // How changed comment lines draw, remembered per project as que does (props win until a pick).
  commentView() {
    const saved = (this.project && shared(COMMENTS)?.[this.project]) || {};
    return {
      mode: this.commentOver.mode ?? (M.COMMENT_MODES.includes(saved.mode) ? saved.mode : M.DEFAULT_COMMENTS.mode),
      keepRemoved: this.commentOver.keepRemoved ?? (typeof saved.keepRemoved === "boolean" ? saved.keepRemoved : M.DEFAULT_COMMENTS.keepRemoved),
    };
  }
  setCommentView(change, cx) {
    const next = { ...this.commentView(), ...change };
    this.commentOver = {};
    if (this.project) setShared(COMMENTS, { ...(shared(COMMENTS) ?? {}), [this.project]: next });
    else this.commentOver = next;
    this.menu = false; this.dirty = true; cx.notify();
  }

  // ---- loading -----------------------------------------------------------------------------

  load(cx, first = false) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const data = this.kind === "pr" ? await this.loadPr() : await this.loadChanges();
        this.apply(data, first);
        this.error = null;
        if (first && this.kind === "changes" && !this.on) this.watch(this.root, cx);
      } catch (e) { this.error = String(e?.message ?? e); }
      finally {
        this.loading = false; this.loaded = true; this.dirty = true; cx.notify();
        if (this.again) { this.again = false; this.load(cx); }
      }
    });
    cx.notify();
  }

  // Local worktrees refresh as they change, as que's do; a pull request only on the button.
  watch(root, cx) {
    if (!root || this.watched) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          const changed = await watchFolder(root);
          if (this.watched === root && this.touches(changed)) this.load(cx);
        }
      } catch { this.watched = null; }
    });
  }

  // Whether a change can move this file's diff: the file itself, a folder above it (the root:
  // everything), the repository's own files (the index, refs), or a path spelled otherwise.
  touches(paths) {
    if (!Array.isArray(paths) || !this.path || !this.root) return true;
    const root = this.root, file = `${root}/${this.path}`;
    return paths.some((p) => p === file || file.startsWith(`${p}/`) || p === `${root}/.git` || p.startsWith(`${root}/.git/`) || !p.startsWith(`${root}/`));
  }

  git(root) {
    return (args) => exec("git", [...READ, ...args], { cwd: root, on: this.on, timeout: 60000 });
  }

  // The file against que's base (base.js), uncommitted and untracked included: its own diff only.
  async loadChanges() {
    if (!this.folder) throw new Error("No folder to compare.");
    if (!this.root) {
      const top = await exec("git", ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd: this.folder, on: this.on });
      if (top.code !== 0) throw new Error("Not a git repository");
      const [root, prefix = ""] = top.stdout.split("\n");
      const git = this.git(root);
      // que remembers comment choices per project: the GitHub repo when origin is one, else the repo.
      const origin = await git(["remote", "get-url", "origin"]);
      const gh = origin.code === 0 ? /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(origin.stdout.trim()) : null;
      const common = gh ? null : await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      this.project = gh ? gh[1] : common?.code === 0 ? common.stdout.trim() : root;
      this.path = this.wanted ? M.relativeFile(this.wanted, this.folder, root, prefix) : null;
      this.root = root;
    }
    const git = this.git(this.root), only = this.path ? ["--", this.path] : [];
    const from = await diffFrom(git);
    this.loadedWs = this.pref("whitespace");
    const ws = this.loadedWs === "ignore" ? ["-w"] : [];
    const diff = await git(["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--no-renames", ...ws, ...(from ? [from] : ["--cached"]), ...only]);
    if (diff.code !== 0) throw new Error(diff.stderr.trim() || "git diff failed");
    let text = diff.stdout;
    const untracked = new Set();
    // Untracked: a file git diff doesn't know, compared with nothing.
    if (!this.path || !text.trim()) {
      const others = await git(["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", ...only]);
      for (const path of (others.code === 0 ? others.stdout.split("\0").filter(Boolean) : []).slice(0, MAX_UNTRACKED)) {
        const r = await git(["diff", "--no-index", "--no-color", "--no-ext-diff", "--", "/dev/null", path]);
        if (r.code <= 1 && r.stdout) text += (text && !text.endsWith("\n") ? "\n" : "") + r.stdout;
        untracked.add(path);
      }
    }
    return { text, threads: [], untracked };
  }

  async loadPr() {
    const [owner, name] = String(this.repo ?? "").split("/");
    if (!owner || !name || !this.number) throw new Error("A pull request needs repo (owner/name) and number.");
    const [diff, answer] = await Promise.all([
      exec("gh", ["pr", "diff", String(this.number), "-R", this.repo, "--color", "never"], { timeout: 120000 }),
      exec("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${this.number}`], { timeout: 60000 }),
    ]);
    if (diff.code !== 0) throw new Error(diff.stderr.trim() || "gh pr diff failed");
    let json = null, threads = [];
    try { json = JSON.parse(answer.stdout); threads = M.threadsOf(json); } catch {}
    this.project = this.repo;
    const pr = json?.data?.repository?.pullRequest ?? null;
    return { text: diff.stdout, threads, pr, threadError: answer.code !== 0 ? (answer.stderr.trim() || "review threads unavailable") : null };
  }

  apply(data, first) {
    const files = M.parsePatch(data.text).map(markFile);
    for (const f of files) if (data.untracked?.has(f.path)) f.untracked = true;
    // The file asked for; without one, the first as the lists order them, which then stays.
    const groups = commentOnlyLast(files);
    const file = this.path ? files.find((f) => f.path === this.path) ?? null : groups.code[0] ?? groups.commentOnly[0] ?? null;
    if (file && !this.path) this.path = file.path;
    this.file = file;
    this.split = file ? splitCounts(file) : null;
    this.threads = file ? data.threads.filter((t) => t.path === file.path) : [];
    this.placed = M.placeThreads(file ? [file] : [], this.threads);
    this.pr = data.pr ?? this.pr; this.threadError = data.threadError ?? null;
    if (first) {
      const c = this.collapse;
      for (const t of this.threads) if (c === "all" || (c === "resolved" && t.resolved) || (c === "outdated" && t.outdated) || (Array.isArray(c) && c.includes(t.id))) this.closedThreads.add(t.id);
      if (this.wantedThread) this.jumpThread(this.wantedThread);
    }
    if (this.openAllRuns) { this.openAllRuns = false; this.openRunsAll = true; }
  }

  // ---- state changes -----------------------------------------------------------------------

  // What the rows depend on that another tab can change (shared choices).
  buildKey() { return JSON.stringify([this.pref("view"), this.pref("wrap"), this.commentView()]); }

  rebuild() {
    this.builtKey = this.buildKey();
    this.built = M.buildRows(this.file ? [this.file] : [], {
      mode: this.pref("view"), width: Math.max(200, this.width - 10), wrap: this.pref("wrap"), placed: this.placed,
      hide: this.hide, only: this.only, closedThreads: this.closedThreads, header: false,
      ignoredWhitespace: this.kind === "changes" && this.loadedWs === "ignore",
      comments: this.commentView(), openRuns: this.openRuns,
    });
    // The `openRuns: "all"` prop: every folded run open (a test state).
    if (this.openRunsAll && this.built.runAt.size) {
      this.openRunsAll = false;
      for (const id of this.built.runAt.keys()) this.openRuns.add(id);
      return this.rebuild();
    }
    this.dirty = false;
  }

  clickRow(key, cx) {
    if (key.startsWith("t:")) { const id = key.slice(2); this.closedThreads.has(id) ? this.closedThreads.delete(id) : this.closedThreads.add(id); }
    else if (key.startsWith("c:")) {
      // A run a review thread points into stays open (que: "opened for a review comment").
      const row = this.built?.rows[this.built.runAt.get(key)];
      if (!row || row.run.pinned) return;
      this.openRuns.has(key) ? this.openRuns.delete(key) : this.openRuns.add(key);
    }
    else return;
    this.dirty = true; cx.notify();
  }

  // Shows a thread: comments on, the thread open, then scrolls to it (the `thread` prop).
  jumpThread(id) {
    const t = this.threads.find((x) => x.id === id);
    if (!t) return false;
    this.hide = false; this.only = false; this.closedThreads.delete(t.id);
    this.pending = { thread: t.id };
    this.dirty = true;
    return true;
  }

  // After the frames that lay the rows out (a list asked to scroll before it has them stays put).
  scrollPending(cx) {
    const p = this.pending;
    // Not before the list's width is known: rows built for another width change size under the scroll.
    if (!p || !this.built || !this.width || this.loading) return;
    this.pending = null;
    const find = () => this.built?.threadAt.get(p.thread);
    if (find() === undefined) return;
    cx.timer.after(40, (cx) => {
      const index = find();
      if (index !== undefined) this.scroll.scroll_to_item(index, "center");
      cx.notify();
      // A frame that never drew (a hidden tab, a sleeping screen) moved nothing: try again, a few times.
      cx.timer.after(200, (cx) => {
        const at = find(), seen = this.seen;
        if (at !== undefined && (!seen || at < seen.start || at >= seen.end) && (p.tries ?? 0) < 4) {
          this.pending = { ...p, tries: (p.tries ?? 0) + 1 };
          cx.notify();
        }
      });
    });
  }

  // ---- drawing: the code -------------------------------------------------------------------

  palette(t) {
    if (this.paletteFor === t) return this.colors;
    this.paletteFor = t;
    const text = mix(t.foreground, t.muted, 0.3);
    this.colors = {
      text, secondary: mix(t.foreground, t.muted, 0.45),
      keyword: t.ansi12, control: t.ansi13, constant: t.ansi12, string: mix(t.ansi3, t.ansi11, 0.35), number: mix(t.ansi10, t.foreground, 0.45),
      function: mix(t.ansi11, t.foreground, 0.55), type: mix(t.ansi6, t.ansi14, 0.5), comment: t.ansi2, punct: text,
      add: t.done, del: t.ansi9,
      addNum: mix(t.done, t.dim, 0.3), delNum: mix(t.ansi9, t.dim, 0.3),
      addDim: mix(t.done, t.dim, 0.65), delDim: mix(t.ansi9, t.dim, 0.65),
    };
    return this.colors;
  }

  codeRows(text, path, kind, pair, wraps, c, dimmed = false) {
    const ext = extOf(path);
    let tokens = this.tokens.get(`${ext}\0${text}`, () => tokenize(text, ext));
    if (pair !== undefined && kind !== "ctx" && !dimmed) {
      const [o, n] = kind === "del" ? [text, pair] : [pair, text];
      const w = this.words.get(`${o}\0${n}`, () => wordChanges(o, n));
      tokens = splitTokens(tokens, kind === "del" ? w.old : w.next);
    }
    const mark = kind === "add" ? c.add + "4d" : c.del + "4d";
    const hang = (wraps?.hang ?? 0) * M.CHAR_W;
    return v_flex().flex_1().min_w(0).pr(16).overflow_hidden().when(dimmed, (e) => e.opacity(0.5)).children(wrapTokens(tokens, wraps).map((row, i) =>
      h_flex().h(M.LINE_H).flex_none().whitespace_nowrap().when(dimmed && kind === "del", (e) => e.line_through())
        .when(i > 0 && hang > 0, (e) => e.child(div().w(hang).flex_none()))
        .children(row.map((tok) => {
          const color = tok.kind === "keyword" ? (CONTROL.has(tok.text) ? c.control : c.keyword) : c[tok.kind] ?? c.text;
          return div().flex_none().text_color(color).when(Boolean(tok.changed), (e) => e.bg(mark).rounded(2)).child(tok.text.replace(/\t/g, "    "));
        }))));
  }

  // A changed line's numbers and sign lean toward its tone; a dimmed comment line's only 35%.
  toneOf(kind, dimmed, c, t) {
    return kind === "add" ? (dimmed ? c.addDim : c.addNum) : kind === "del" ? (dimmed ? c.delDim : c.delNum) : t.dim;
  }

  num(n, width, tone, c, t, dimmed = false) {
    return div().w(width).h(M.LINE_H).flex_none().pr(8).text_right().text_color(this.toneOf(tone, dimmed, c, t)).child(n == null ? "" : String(n));
  }

  sign(kind, width, c, t, dimmed = false) {
    return div().w(width).h(M.LINE_H).flex_none().text_center().text_color(this.toneOf(kind, dimmed, c, t)).child(kind === "add" ? "+" : kind === "del" ? "−" : "");
  }

  // que's comment look: no tint, a 2px edge at the left; a removed one Fold keeps carries a tag.
  edge(t) { return div().absolute().left(0).top(0).bottom(0).w(2).bg(t.input); }
  removedTag(t) { return div().flex_none().px(12).h(M.LINE_H).font_family(MONO).text_size(10).text_color(t.blocked).child("COMMENT REMOVED"); }

  lineRow(r, size, t, c) {
    const { line } = r, dim = r.look?.dimmed ?? false, tone = dim ? null : line.kind === "add" ? c.add : line.kind === "del" ? c.del : null;
    return h_flex().w_full().h(size).items_start().relative().font_family(MONO).text_size(12).when(Boolean(tone), (e) => e.bg(tone + "1f"))
      .child(this.num(line.old, 44, line.kind, c, t, dim)).child(this.num(line.new, 44, line.kind, c, t, dim)).child(this.sign(line.kind, 18, c, t, dim))
      .child(this.codeRows(line.text, r.path, line.kind, line.pair, r.wraps, c, dim))
      .when(Boolean(r.look?.kept), (e) => e.child(this.removedTag(t)))
      .when(dim, (e) => e.child(this.edge(t)));
  }

  side(line, which, wraps, path, t, c, look) {
    if (!line) return div().flex_1().min_w(0).h_full().bg(t.raised + "99");
    const kind = line.kind, dim = look?.dimmed ?? false, tone = dim ? null : kind === "add" ? c.add : kind === "del" ? c.del : null;
    return h_flex().flex_1().min_w(0).h_full().items_start().relative().overflow_hidden().when(Boolean(tone), (e) => e.bg(tone + "1f"))
      .child(this.num(which === "old" ? line.old : line.new, 44, kind, c, t, dim)).child(this.sign(kind, 16, c, t, dim))
      .child(this.codeRows(line.text, path, kind, line.pair, wraps, c, dim))
      .when(Boolean(look?.kept), (e) => e.child(this.removedTag(t)))
      .when(dim, (e) => e.child(this.edge(t)));
  }

  pairRow(r, size, t, c) {
    return h_flex().w_full().h(size).font_family(MONO).text_size(12)
      .child(this.side(r.pair.l, "old", r.lw, r.path, t, c, r.ll))
      .child(div().w(1).h_full().flex_none().bg(t.border))
      .child(this.side(r.pair.r, "new", r.rw, r.path, t, c, r.rl));
  }

  // Under Fold, a run of comment lines: its line range where the numbers go, then `▸ 3 comment
  // lines added`, which opens it in place (`▾`); a run a review thread points into stays open.
  runRow(r, t) {
    const run = r.run, range = run.first === run.last ? `${run.first}` : `${run.first}–${run.last}`;
    const words = run.pinned ? "▾ comment lines · opened for a review comment" : `${run.open ? "▾" : "▸"} ${M.runWords(run)}`;
    return h_flex().id(`run-${run.id}`).w_full().h(M.RUN_H).relative().items_center().font_family(MONO).text_size(11).text_color(t.dim)
      .when(!run.pinned, (e) => e.cursor_pointer().hover((s) => s.text_color(t.foreground)))
      .child(div().w(r.split ? 60 : 106).flex_none().pr(r.split ? 24 : 26).text_right().text_color(t.dim).child(range))
      .child(div().flex_none().whitespace_nowrap().child(words))
      .child(this.edge(t));
  }

  gapRow(r, t) {
    const words = r.count > 0 ? (r.skipped ? `${M.plural(r.count, "line")} without threads` : M.plural(r.count, "unchanged line")) : "";
    return h_flex().w_full().h(M.GAP_H).pl(12).pr(16).gap(10).items_center().bg(t.background).border_t(1).border_b(1).border_color(t.border)
      .font_family(MONO).text_size(11).text_color(t.dim)
      .when(Boolean(words), (e) => e.child(div().flex_none().child(words)))
      .when(Boolean(r.fn), (e) => e.child(div().max_w(480).truncate().text_color(t.muted).child(r.fn)));
  }

  // ---- drawing: threads --------------------------------------------------------------------

  tag(word, tone, t) {
    return h_flex().flex_none().gap(4).items_center().child(div().size(5).rounded_full().bg(tone)).child(div().text_size(10).text_color(t.dim).child(word));
  }

  threadHead(r, size, t) {
    const th = r.thread, first = th.comments[0], replies = th.comments.length - 1, box = r.box;
    const loose = th.line != null && !this.placed?.files.get(th.path)?.at.has(`${th.side}:${th.line}`);
    return h_flex().id(`thead-${th.id}`).w_full().h(size).pl(box.left).pt(M.HEAD_GAP).items_start().cursor_pointer()
      .child(h_flex().w(box.width).h(M.HEAD_H).flex_none().px(10).gap(6).items_center().bg(t.background).border_color(t.input)
        .when(r.closed, (e) => e.border_1().rounded(4))
        .when(!r.closed, (e) => e.border_t(1).border_l(1).border_r(1).rounded_t(4))
        .hover((s) => s.bg(t.hover)).font_family(MONO).text_size(11)
        .child(div().w(10).flex_none().text_color(t.dim).child(r.closed ? "▸" : "▾"))
        .child(div().flex_none().text_color(t.muted).child(first.author))
        .child(div().flex_none().text_color(t.dim).child(`· ${M.formatAge(first.at)}`))
        .when(replies > 0, (e) => e.child(div().flex_none().text_color(t.dim).child(`· ${M.plural(replies, "reply").replace("replys", "replies")}`)))
        .when(loose, (e) => e.child(div().flex_none().text_color(t.dim).child(`· ${th.side === "old" ? "old " : ""}line ${th.line}`)))
        .when(r.closed, (e) => e.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(M.excerpt(first.body, 90))))
        .when(!r.closed, (e) => e.child(div().flex_1()))
        .when(th.outdated, (e) => e.child(this.tag("outdated", t.blocked, t)))
        .when(th.resolved, (e) => e.child(this.tag("resolved", t.done, t))));
  }

  bodyLine(l, t, c) {
    if (l.kind === "blank") return div().h(M.BODY_BLANK).flex_none();
    const row = h_flex().h(M.BODY_LINE).flex_none().whitespace_nowrap().overflow_hidden().items_center().pl(l.indent);
    const span = (s, base) => div().flex_none().child(s.text)
      .when(s.s === "b", (e) => e.font_semibold().text_color(t.foreground))
      .when(s.s === "i", (e) => e.italic())
      .when(s.s === "link", (e) => e.text_color(t.accent))
      .when(s.s === "code", (e) => e.font_family(MONO).text_size(11).text_color(t.foreground).bg(t.raised).rounded(2))
      .when(!s.s, (e) => e.text_color(base));
    if (l.kind === "code") return row.bg(t.chrome).font_family(MONO).text_size(11).text_color(c.secondary).children(l.spans.map((s) => div().flex_none().child(s.text)));
    if (l.kind === "quote") return row.border_l(2).border_color(t.input).children(l.spans.map((s) => span(s, t.muted)));
    if (l.kind === "label") return row.text_size(11).children(l.spans.map((s) => div().flex_none().text_color(t.muted).font_semibold().child(s.text)));
    return row.children(l.spans.map((s) => span(s, c.secondary)));
  }

  threadBody(r, size, t, c) {
    const box = r.box;
    return h_flex().w_full().h(size).pl(box.left).items_start()
      .child(v_flex().w(box.width).h(size - M.TAIL_GAP).flex_none().px(10).py(M.BODY_PAD).bg(t.background)
        .border_l(1).border_r(1).border_b(1).border_color(t.input).rounded_b(4).text_size(12)
        .children(r.body.comments.flatMap((cm) => [
          ...(cm.first ? [] : [
            div().h(M.SEP_H).flex_none().flex().items_center().child(div().w_full().h(1).bg(t.border)),
            h_flex().h(M.WHO_H).flex_none().items_center().font_family(MONO).text_size(11).text_color(t.muted).child(`${cm.author} · ${M.formatAge(cm.at)}`),
          ]),
          ...cm.lines.map((l) => this.bodyLine(l, t, c)),
        ])));
  }

  row(r, size, t, c) {
    switch (r.t) {
      case "gap": return this.gapRow(r, t);
      case "note": return div().w_full().h(size).px(16).flex().items_center().font_family(MONO).text_size(11).text_color(t.dim).child(r.text);
      case "line": return this.lineRow(r, size, t, c);
      case "pair": return this.pairRow(r, size, t, c);
      case "run": return this.runRow(r, t);
      case "thead": return this.threadHead(r, size, t);
      case "tbody": return this.threadBody(r, size, t, c);
      default: return div().h(size);
    }
  }

  // ---- drawing: chrome ---------------------------------------------------------------------

  tool(id, label, on, t, action) {
    return div().id(id).h(20).px(8).flex_none().flex().items_center().rounded(2).border_1().border_color(t.border).cursor_pointer()
      .font_family(MONO).text_size(11).text_color(on ? t.foreground : t.dim).when(on, (e) => e.bg(t.raised))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => action(cx)).child(label);
  }

  ghost(id, name, tip, t, action, spin = false) {
    return h_flex().id(id).size(22).flex_none().items_center().justify_center().rounded(2)
      .text_color(spin ? t.foreground : t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => action(cx))
      .child(spin ? icon(name).spin(800) : icon(name));
  }

  // que's path: in the foreground, its folders cut from their start so the file's name stays
  // whole, the whole of it the tooltip.
  pathLabel(t) {
    const f = this.file, text = f ? (f.from ? `${f.from} → ${f.path}` : f.path) : this.path ?? this.wanted ?? "";
    const cut = text.lastIndexOf("/") + 1;
    return h_flex().id("rd-path").min_w(120).flex_shrink(1).overflow_hidden().whitespace_nowrap().text_color(t.foreground).tooltip(text)
      .when(cut > 0, (e) => e.child(div().min_w(0).flex_shrink(1).overflow_hidden().whitespace_nowrap().text_ellipsis_start().child(text.slice(0, cut))))
      .child(div().flex_none().child(text.slice(cut)));
  }

  toolbar(t, c) {
    const f = this.file, view = this.pref("view"), wrap = this.pref("wrap");
    const has = this.threads.length > 0, lines = this.split ? this.split.commentAdditions + this.split.commentDeletions : 0;
    const against = this.kind === "pr" ? `#${this.number}${this.pr?.baseRefName ? ` vs ${this.pr.baseRefName}` : ""}` : null;
    const left = h_flex().flex_1().min_w(0).gap(8).items_center().overflow_hidden().whitespace_nowrap()
      .child(this.pathLabel(t))
      .when(Boolean(f), (e) => e.children(this.counts(this.split, f, t, c)))
      .when(Boolean(against), (e) => e.child(div().flex_none().text_color(t.dim).child(against)));
    return h_flex().id("rd-toolbar").h(BAR_H).flex_none().pl(16).pr(8).gap(8).items_center().bg(t.background).border_b(1).border_color(t.border)
      .font_family(MONO).text_size(11).text_color(t.dim)
      .child(left)
      .child(h_flex().flex_none().gap(8).items_center()
        // Code comments (que's Comments ▾) apart from a pull request's review threads.
        .when(lines > 0, (e) => e.child(this.tool("rd-comment-mode", `Comments ${MODE_WORD[this.commentView().mode]} ▾`, this.menu, t, (cx) => { this.menu = !this.menu; cx.notify(); })))
        .when(has, (e) => e.child(this.tool("rd-threads", "Threads", !this.hide, t, (cx) => { this.hide = !this.hide; this.dirty = true; cx.notify(); }).tooltip("Show the review threads")))
        .when(has, (e) => e.child(this.tool("rd-only", "Threaded hunks", this.only, t, (cx) => { this.only = !this.only; this.dirty = true; cx.notify(); }).tooltip("Only the hunks with review threads")))
        .child(h_flex().flex_none()
          .child(this.tool("rd-unified", "Unified", view === "unified", t, (cx) => this.setPref("view", "unified", cx)).rounded_r(0))
          .child(this.tool("rd-split", "Split", view === "split", t, (cx) => this.setPref("view", "split", cx)).rounded_l(0).border_l(0)))
        .child(this.tool("rd-wrap", "Wrap", wrap, t, (cx) => this.setPref("wrap", !wrap, cx)).tooltip("Wrap long lines"))
        // A pull request's diff comes from GitHub as it is; only a worktree's can leave whitespace out.
        .when(this.kind === "changes", (e) => e.child(this.tool("rd-whitespace", "Whitespace", this.pref("whitespace") === "ignore", t, (cx) => {
          this.setPref("whitespace", this.pref("whitespace") === "ignore" ? "show" : "ignore", cx);
        }).tooltip("Ignore whitespace")))
        .child(this.ghost("rd-refresh", "refresh", this.kind === "pr" ? "Fetch the pull request again" : "Refresh", t, (cx) => this.load(cx), this.loading)));
  }

  // que's split counts: `+a −d` without comment lines; with them `+2 −1 code · +7 −2 comments`,
  // a part or a side left out when it is zero, the comment counts faint.
  counts(split, totals, t, c) {
    return countParts(split, totals).flatMap((part) => [
      ...part.items.map((i) => div().flex_none().text_color(i.tone === "add" ? c.add : i.tone === "del" ? c.del : t.dim).child(`${i.sign}${i.n}`)),
      ...(part.word ? [div().flex_none().text_color(t.dim).child(part.word)] : []),
    ]);
  }

  // que's Comments menu, under its button: a bracketed head, Dim, Show and Fold with their hints,
  // the current one on the active fill, a hairline, and the removed-comments checkbox.
  commentMenu(t) {
    const view = this.commentView(), lines = this.split.commentAdditions + this.split.commentDeletions;
    const item = (id, label, hint, on, action) => h_flex().id(id).h(26).px(10).gap(12).items_center().rounded(2).cursor_pointer()
      .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => action(cx))
      .child(div().flex_1().text_color(t.foreground).child(label)).child(div().flex_none().text_color(t.dim).child(hint));
    return div().id("rd-menu-layer").absolute().inset_0()
      .child(div().id("rd-menu-backdrop").absolute().inset_0().on_click((_e, cx) => { this.menu = false; cx.notify(); }))
      .child(v_flex().id("rd-comment-menu").absolute().top(BAR_H - 4).right(8).w(280).p(4).gap(1)
        .bg(t.raised).border_1().border_color(t.input).rounded(4).shadow_md().font_family(MONO).text_size(12)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(div().px(10).pt(4).pb(6).text_size(10).font_medium().text_color(t.dim).child(`[ COMMENT CHANGES · ${M.plural(lines, "line").toUpperCase()} ]`))
        .children(MODES.map((m) => item(`rd-mode-${m.mode}`, m.label, m.hint, view.mode === m.mode, (cx) => this.setCommentView({ mode: m.mode }, cx))))
        .child(div().my(4).h(1).bg(t.border))
        .child(item("rd-keep-removed", `${view.keepRemoved ? "✓" : "  "} Always show removed comments`, "", false, (cx) => this.setCommentView({ keepRemoved: !view.keepRemoved }, cx))));
  }

  // The quiet line over an empty body: loading, an error, or nothing left to compare in this file.
  message() {
    if (this.error) return this.error;
    if (!this.loaded) return this.kind === "pr" ? "Loading the pull request…" : "Loading the diff…";
    if (!this.file) return this.path || this.wanted ? `No changes in ${this.path ?? this.wanted}` : this.kind === "pr" ? "No changes in this pull request." : "No changes against the base.";
    return this.built && !this.built.rows.length ? "No hunks have review threads." : null;
  }

  body(t, c) {
    const b = this.built, wrap = this.pref("wrap"), split = this.pref("view") === "split", message = this.message();
    const content = split ? 2 * (60 + b.widest * M.CHAR_W + 16) + 1 : 106 + b.widest * M.CHAR_W + 16;
    const list = v_virtual_list("rd-rows", b.rows.length, b.sizes, (i) => b.rows[i].key,
      (range) => { this.seen = range; const out = []; for (let i = range.start; i < range.end; i++) out.push(this.row(b.rows[i], b.sizes[i], t, c)); return out; })
      .on_item_click((key, cx) => this.clickRow(key, cx)).size_full().track_scroll(this.scroll);
    return div().id("rd-body").flex_1().min_h(0).min_w(0).relative().bg(t.chrome)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) < 1) return;
        this.width = size.width; this.dirty = true; cx.notify();
      })
      .child(div().id(`rd-x-${wrap}`).size_full().when(!wrap, (e) => e.overflow_x_scrollbar())
        .child(div().size_full().when(!wrap, (e) => e.min_w(Math.max(content, 300))).child(list)))
      .child(Scrollbar.vertical("rd-rows").viewport_from_layout().absolute().inset_0())
      .when(Boolean(message), (e) => e.child(div().absolute().top(0).left(0).right(0).px(16).py(14).text_size(12)
        .text_color(this.error ? t.ansi9 : t.dim).child(message)))
      .when(Boolean(this.threadError), (e) => e.child(div().absolute().bottom(0).left(0).right(0).px(16).py(6).bg(t.background)
        .font_family(MONO).text_size(11).text_color(t.blocked).child(`review threads: ${this.threadError}`)));
  }

  render(cx) {
    const t = theme(), c = this.palette(t);
    // Whitespace is read by git: a change of it (here or in another diff tab) reads again.
    if (this.kind === "changes" && this.loadedWs !== undefined && this.pref("whitespace") !== this.loadedWs && !this.loading) this.load(cx);
    if (this.dirty || !this.built || this.builtKey !== this.buildKey()) this.rebuild();
    this.scrollPending(cx);
    const lines = this.split ? this.split.commentAdditions + this.split.commentDeletions : 0;
    return v_flex().id("curfew-diff").size_full().min_h(0).relative().bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.toolbar(t, c)).child(this.body(t, c))
      .when(this.menu && lines > 0, (e) => e.child(this.commentMenu(t)));
  }
}
