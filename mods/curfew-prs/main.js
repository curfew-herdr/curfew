// que's Pull requests view, in herdr: every pull request the session in the shown worktree opened.
// The list: `[ PULL REQUESTS ]` with `n open · k failing` and a refresh that turns while it checks,
// then two-line rows (dot, `#n`, title, comment count; `into <base> · checks · +a −d · subagent` in
// mono), open and draft first, then `[ MERGED · CLOSED ]` under a dashed rule. A row opens the pull
// request in place: `‹ #n` back, its title and meta line, then Changes (its files against its base),
// Checks and Comments, each folding at its head. A file, or a line comment's `path:line →`, opens
// that file of the pull request's diff as a tab of its own in the main panel (the curfew-diff mod),
// or selects its tab where it is open (difftab.js), as que does; the file whose tab shows reads
// selected. Discovery and storage: engine.mjs; rules: core.mjs.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, TextView } from "gpui-base";
import { theme, shared, setShared, exec, appHome, watchFolder, readTextFile, writeTextFile, nextCommand } from "herdr";
import * as fs from "fs/promises";
import * as core from "./core.mjs";
import { makeEngine, EVERY, SIGNAL } from "./engine.mjs";
import { where } from "./where.mjs";
import { openDiff, shownDiff, diffKey, settle } from "./difftab.js";

const MONO = "Menlo";
// A prs.jsonl to read instead of the hook's (<app home>/curfew/prs.jsonl), for trying the view; null in use.
const LOG_FILE = null;
const engine = makeEngine({ exec, readTextFile, writeTextFile, appHome, mkdir: (path) => fs.mkdir(path, { recursive: true }), log: LOG_FILE ? () => LOG_FILE : undefined });

const icon = (name, size = 16) => svg(`mods/curfew-prs/${name}.svg`).size(size).flex_none();
const mono = (text, color, size = 11) => div().flex_none().font_family(MONO).text_size(size).text_color(color).child(text);
const label = (t, text) => div().flex_none().font_family(MONO).text_size(10).font_medium().text_color(t.dim).child(`[ ${text} ]`);
// que's tones on the curfew theme: good, bad (the diff's red, as Changes draws it), busy, attention, neutral, muted.
const tone = (t, name) => ({ good: t.done, bad: t.ansi9, busy: t.working, attention: t.blocked, neutral: t.idle, muted: t.unknown })[name] ?? t.dim;
const rule = (t) => div().flex_none().mx(12).my(6).h(0).border_t(1).border_dashed().border_color(t.border);

/** A 5px status dot in a tone, or a hollow ring (a draft). */
function dot(t, kind) {
  const d = div().size(5).flex_none().rounded_full();
  return kind === "ring" ? d.border_1().border_color(t.muted) : d.bg(tone(t, kind));
}

/** `+a −d` in the diff tones. */
const lines = (t, a, d) => h_flex().flex_none().gap(4).child(mono(`+${a}`, t.done)).child(mono(`−${d}`, t.ansi9));

/** A list of children with a faint `·` between them. */
function dotted(t, parts) {
  const out = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(mono("·", t.dim));
    out.push(p);
  });
  return out;
}

export default class PullRequests extends View {
  init(_props, cx) {
    this.id = `${Date.now()}-${Math.random()}`;
    this.key = null; // the followed location, as JSON
    this.here = undefined; // the located worktree; null outside a git repository
    this.store = null;
    this.error = null;
    this.running = false;
    this.busy = false; // a refresh asked for by a click
    this.again = null;
    this.open = null; // the number shown in detail
    this.threads = {}; // number -> {for: updatedAt, entries}
    this.files = {}; // number -> {for: updatedAt, list}
    this.loading = {}; // number -> true while its detail loads
    this.asked = {}; // number -> the updatedAt its detail was last read for (or tried)
    this.detailError = {};
    this.folds = { files: true, checks: true, comments: true };
    this.passingOpen = false;
    this.hoverCheck = null;
    this.signalAt = null;
    this.logText = undefined;
    cx.timer.every(EVERY, (cx) => this.tick(cx, false));
    this.tick(cx, false);
    this.watchLog(cx);
    this.listen(cx);
  }

  /**
   * Key commands (keys.json `"curfew-prs.<command>"`): `refresh`, `back`, `open-<n>` (a pull
   * request's detail), `diff` (the shown one's first file as a diff tab), `fold-files` /
   * `fold-checks` / `fold-comments` and `fold-passing`.
   */
  listen(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "refresh") this.refresh(cx);
        else if (c === "back") this.open = null;
        else if (c === "diff" && this.shown()) {
          const pr = this.shown(), first = this.files[pr.number]?.list[0];
          if (first) this.openDiff(pr, first.path);
        }
        else if (c === "fold-passing") this.passingOpen = !this.passingOpen;
        else if (c.startsWith("fold-") && c.slice(5) in this.folds) this.folds[c.slice(5)] = !this.folds[c.slice(5)];
        else if (c.startsWith("open-")) {
          const pr = this.store?.prs.find((p) => p.number === Number(c.slice(5)));
          if (pr) this.openPr(pr, cx);
        }
        cx.notify();
      }
    });
  }

  /** Checks the followed worktree: adopted when another copy checked it lately, unless `force`. */
  tick(cx, force) {
    const at = where();
    const key = JSON.stringify(at);
    this.key = key;
    if (!at.cwd) {
      this.here = undefined;
      return;
    }
    if (this.running) {
      if (force || !this.again) this.again = force ? "force" : "tick";
      if (force) this.busy = true;
      return;
    }
    this.running = true;
    this.busy = force;
    cx.spawn(async (cx) => {
      try {
        const r = await engine.check(at, { force });
        if (this.key !== key) return;
        this.adopt(r.here, r.store);
        for (const { pr, entries } of r.threads) this.threads[pr.number] = { for: pr.updatedAt, entries };
        this.error = null;
        if (r.ran) this.publish();
      } catch (e) {
        if (this.key === key) this.error = String(e?.message ?? e);
      } finally {
        this.running = false;
        this.busy = false;
        cx.notify();
        if (this.again) {
          const again = this.again === "force";
          this.again = null;
          this.tick(cx, again);
        }
      }
    });
    cx.notify();
  }

  /** Takes a located worktree and its store; another worktree starts the view over. */
  adopt(here, store) {
    if (core.normPath(here?.root ?? "") !== core.normPath(this.here?.root ?? "")) {
      this.open = null;
      this.threads = {};
      this.files = {};
      this.loading = {};
      this.asked = {};
      this.detailError = {};
      this.logText = undefined;
    }
    this.here = here;
    this.store = store;
  }

  publish() {
    if (this.here && this.store) setShared(SIGNAL, { root: this.here.root, open: core.prCounts(this.store.prs).open, at: Date.now(), from: this.id });
  }

  /** Another copy saved this worktree: read what it saved. */
  follow(cx) {
    const s = shared(SIGNAL);
    if (!s || s.at === this.signalAt || s.from === this.id || !this.here) return;
    this.signalAt = s.at;
    if (core.normPath(s.root) !== core.normPath(this.here.root)) return;
    const root = this.here.root;
    cx.spawn(async (cx) => {
      const store = await engine.load(root);
      if (this.here?.root === root) {
        this.store = store;
        cx.notify();
      }
    });
  }

  /**
   * Waits for prs.jsonl to change (it may not exist yet: the folder above is watched until the
   * hook's folder appears) and checks now when it names a pull request this worktree does not have.
   * The folder also holds the store and the usage reading, so only the log itself counts.
   */
  watchLog(cx) {
    cx.spawn(async (cx) => {
      const log = engine.LOG();
      const dir = log.replace(/\/[^/]*$/, "");
      const home = dir.replace(/\/[^/]*$/, "");
      for (;;) {
        let paths;
        try {
          paths = await watchFolder((await fs.exists(dir)) ? dir : home);
        } catch {
          return;
        }
        if (!paths.some((p) => p === home || p === dir || p === log)) continue;
        const text = await readTextFile(log).catch(() => null);
        if (text === this.logText || !this.here || !this.store) continue;
        this.logText = text;
        const [owner, name] = this.store.repo.split("/");
        const repos = [this.here.origin, owner && name ? { owner, name } : null].filter(Boolean);
        const known = new Set(this.store.prs.map((p) => p.number));
        if (core.sessionPrs(text, this.here.root, this.here.others, repos).some((e) => !known.has(e.number))) this.tick(cx, true);
      }
    });
  }

  refresh(cx) {
    this.tick(cx, true);
    const pr = this.shown();
    if (pr) this.loadDetail(pr, cx, true);
  }

  shown() {
    return this.open === null ? null : (this.store?.prs.find((p) => p.number === this.open) ?? null);
  }

  openPr(pr, cx) {
    this.open = pr.number;
    this.passingOpen = false;
    this.loadDetail(pr, cx, false);
    cx.notify();
  }

  /** Reads a pull request's conversation and files, unless read for its updatedAt; remembers it seen. */
  loadDetail(pr, cx, force) {
    const n = pr.number;
    const here = this.here;
    const needThread = force || this.threads[n]?.for !== pr.updatedAt;
    const needFiles = force || this.files[n]?.for !== pr.updatedAt;
    if (!here || this.loading[n] || (!needThread && !needFiles)) {
      if (here && !this.loading[n]) {
        this.asked[n] = pr.updatedAt;
        this.markSeen(pr, this.threads[n]?.entries ?? [], cx);
      }
      return;
    }
    this.loading[n] = true;
    this.asked[n] = pr.updatedAt;
    cx.spawn(async (cx) => {
      const settle = (p) => p.then((v) => ({ v }), (e) => ({ e: String(e?.message ?? e) }));
      const [thread, files] = await Promise.all([
        needThread ? settle(engine.fetchThread(here, pr)) : { v: null },
        needFiles ? settle(engine.fetchFiles(here, pr)) : { v: null },
      ]);
      if (this.here?.root !== here.root) return;
      this.loading[n] = false;
      if (thread.v) this.threads[n] = { for: pr.updatedAt, entries: thread.v };
      if (files.v) this.files[n] = { for: pr.updatedAt, list: files.v };
      this.detailError[n] = thread.e ?? files.e ?? null;
      if (thread.v) {
        try {
          this.store = await engine.save(here.root, (s) => ({
            ...s,
            prs: core.withCounts(s.prs, n, thread.v, pr.updatedAt),
            seen: { ...s.seen, [n]: core.commentCounts(thread.v).commentedAt ?? s.seen[n] ?? null },
          }));
          this.publish();
        } catch {}
      }
      cx.notify();
    });
    cx.notify();
  }

  /** Remembers a pull request's newest comment as seen, so its count stops reading as new. */
  markSeen(pr, entries, cx) {
    const newest = core.commentCounts(entries).commentedAt;
    if (!newest || this.store?.seen?.[pr.number] === newest) return;
    const root = this.here.root;
    cx.spawn(async (cx) => {
      try {
        const store = await engine.save(root, (s) => ({ ...s, seen: { ...s.seen, [pr.number]: newest } }));
        if (this.here?.root === root) this.store = store;
      } catch {}
      cx.notify();
    });
  }

  /** A diff tab's props for one file of a pull request; null without its repository. */
  diffProps(pr, file) {
    const repo = core.prUrl(pr.url);
    return repo && this.here ? { kind: "pr", repo: core.repoName(repo), number: pr.number, folder: this.here.root, file } : null;
  }

  /** One file of the pull request's diff as a tab in the main panel, named after the file; its tab where it is open. */
  openDiff(pr, file) {
    const props = file ? this.diffProps(pr, file) : null;
    if (props) openDiff(props, file.split("/").pop());
  }

  // ---- drawing --------------------------------------------------------------------------------

  refreshButton(t) {
    const turning = this.busy || (this.running && !this.store) || (this.open !== null && this.loading[this.open]);
    return h_flex()
      .id("prs-refresh")
      .size(22)
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(2)
      .text_color(turning ? t.foreground : t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("Refresh")
      .on_click((_e, cx) => this.refresh(cx))
      .child(turning ? icon("refresh").spin(800) : icon("refresh"));
  }

  /** The panel's head row: what's at its left, then the refresh at its right. */
  head(t, left) {
    return h_flex().flex_none().h(34).pl(12).pr(8).pt(4).gap(8).items_center().child(left).child(div().flex_1()).child(this.refreshButton(t));
  }

  note(t, text, color = t.dim) {
    return div().flex_none().px(12).py(4).text_size(12).text_color(color).whitespace_normal().child(text);
  }

  /** A scrolling body that fills what the head leaves. */
  scroller(id, children) {
    return div()
      .flex_1()
      .min_h(0)
      .relative()
      .child(v_flex().id(id).absolute().inset_0().overflow_y_scroll().pb(12).children(children))
      .child(Scrollbar.vertical(id).absolute().inset_0());
  }

  row(pr, settled, t) {
    const prs = this.store.prs;
    const fresh = core.hasNewComments(pr, this.store.seen?.[pr.number]);
    const checks = core.checksLine(pr);
    const meta = [mono(`into ${core.baseLabel(pr, prs)}`, t.dim)];
    if (checks) meta.push(mono(checks.text, tone(t, checks.tone)));
    else if (pr.state !== "open") meta.push(mono(pr.state, t.dim));
    if (pr.additions !== null && pr.deletions !== null) meta.push(lines(t, pr.additions, pr.deletions));
    if (core.fromSubagent(pr, this.store.branches)) meta.push(mono("· subagent", t.dim));
    const count = pr.comments > 0 ? (fresh ? t.foreground : t.dim) : null;
    return v_flex()
      .id(`pr-row-${pr.number}`)
      .w_full()
      .flex_none()
      .pl(10)
      .pr(12)
      .py(8)
      .gap(2)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(pr.title)
      .on_click((_e, cx) => this.openPr(pr, cx))
      .child(
        h_flex()
          .w_full()
          .gap(6)
          .items_center()
          .child(h_flex().w(14).flex_none().justify_center().child(dot(t, core.prDot(pr))))
          .child(mono(`#${pr.number}`, settled ? t.dim : t.muted, 12))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(settled ? t.dim : t.foreground).child(pr.title))
          .when(Boolean(count), (el) =>
            el.child(h_flex().flex_none().gap(4).items_center().text_color(count).child(icon("comment", 12)).child(mono(String(pr.comments), count))),
          ),
      )
      .child(h_flex().w_full().pl(20).flex_wrap().gap_x(8).items_center().children(meta));
  }

  list(root, t) {
    const prs = this.store?.prs ?? [];
    const { active, settled } = core.orderPrs(prs);
    const { open, failing } = core.prCounts(prs);
    const sum = h_flex()
      .gap(6)
      .items_center()
      .child(label(t, "PULL REQUESTS"))
      .child(div().w(4))
      .when(prs.length > 0, (el) =>
        el.children(dotted(t, [mono(`${open} open`, t.dim), ...(failing > 0 ? [mono(`${failing} failing`, t.ansi9)] : [])])),
      );
    root.child(this.head(t, sum));
    const failure = this.error ?? this.store?.error;
    if (failure) root.child(this.note(t, failure, t.ansi9));
    if (this.here === null) return root.child(this.empty(t, "Not a git repository"));
    if (this.here === undefined || !this.store) return root.child(this.empty(t, this.key && JSON.parse(this.key).cwd ? "" : "No folder."));
    if (!prs.length) return root.child(this.empty(t, "No pull requests from this session yet."));
    const rows = active.map((pr) => this.row(pr, false, t));
    if (settled.length) {
      rows.push(rule(t), div().flex_none().px(12).pt(6).pb(4).child(label(t, "MERGED · CLOSED")));
      rows.push(...settled.map((pr) => this.row(pr, true, t)));
    }
    return root.child(this.scroller("prs-list", rows));
  }

  empty(t, text) {
    return v_flex().flex_1().items_center().justify_center().p(24).child(div().text_size(12).text_color(t.muted).text_center().whitespace_normal().child(text));
  }

  fold(t, section, name, right) {
    const open = this.folds[section];
    return h_flex()
      .id(`pr-${section}-head`)
      .flex_none()
      .px(12)
      .pt(10)
      .pb(6)
      .gap(6)
      .items_center()
      .cursor_pointer()
      .on_click((_e, cx) => {
        this.folds[section] = !this.folds[section];
        cx.notify();
      })
      .child(h_flex().gap(4).items_center().text_color(t.dim).child(icon(open ? "chevron-down" : "chevron-right", 10)).child(label(t, name)))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(6).items_center().children(right));
  }

  fileRow(pr, f, t, shown) {
    const g = core.fileGlyph(f.status);
    const parts = f.path.split("/");
    const name = parts.pop();
    const props = shown ? this.diffProps(pr, f.path) : null;
    const on = Boolean(props) && shown === diffKey(props);
    return h_flex()
      .id(`pr-file-${f.path}`)
      .h(28)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(4)
      .cursor_pointer()
      .text_color(on ? t.foreground : t.muted)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .tooltip(f.from ? `${f.from} → ${f.path}` : f.path)
      .on_click(() => this.openDiff(pr, f.path))
      .child(div().w(14).flex_none().font_family(MONO).text_size(11).font_medium().text_color(tone(t, g.tone)).child(g.glyph))
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .child(div().min_w(0).truncate().text_color(t.dim).child(parts.length ? `${parts.join("/")}/` : ""))
          .child(div().flex_none().max_w(260).truncate().child(name)),
      )
      .child(lines(t, f.additions, f.deletions));
  }

  checkRow(c, i, t) {
    const hovered = this.hoverCheck === i;
    return h_flex()
      .id(`pr-check-${i}`)
      .flex_none()
      .px(6)
      .py(5)
      .gap(8)
      .items_center()
      .rounded(4)
      .text_color(t.foreground)
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => {
        this.hoverCheck = on ? i : this.hoverCheck === i ? null : this.hoverCheck;
        cx.notify();
      })
      .tooltip(c.state)
      .child(dot(t, core.CHECK_TONE[c.state]))
      .child(div().flex_none().max_w(170).truncate().child(c.name))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(c.source ?? ""))
      .child(mono(core.formatSpan(c.startedAt, c.completedAt), t.dim))
      .when(Boolean(c.url), (el) =>
        el.child(
          h_flex()
            .id(`pr-check-${i}-link`)
            .size(18)
            .flex_none()
            .items_center()
            .justify_center()
            .rounded(2)
            .text_color(hovered ? t.dim : t.chrome)
            .hover((s) => s.text_color(t.foreground))
            .tooltip(`Open ${c.name}`)
            .on_click((_e, cx) => cx.open_url(c.url))
            .child(icon("external", 12)),
        ),
      );
  }

  comment(pr, e, i, now, t) {
    const review = e.kind === "review" && e.state ? core.reviewBadge(e.state) : null;
    const at = e.path && (e.line === null ? e.path : `${e.path}:${e.line}`);
    return v_flex()
      .id(`pr-comment-${i}`)
      .flex_none()
      .px(6)
      .py(10)
      .gap(6)
      .min_w(0)
      .when(i > 0, (el) => el.border_t(1).border_color(t.border))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_none().font_family(MONO).text_size(11).font_medium().text_color(t.foreground).child(e.author))
          .when(Boolean(review), (el) => el.child(h_flex().flex_none().gap(5).items_center().child(dot(t, review.tone)).child(mono(review.label, tone(t, review.tone)))))
          .child(
            div()
              .id(`pr-comment-${i}-when`)
              .flex_none()
              .font_family(MONO)
              .text_size(11)
              .text_color(t.dim)
              .when(Boolean(e.url), (el) => el.cursor_pointer().hover((s) => s.text_color(t.muted)).on_click((_e, cx) => cx.open_url(e.url)))
              .tooltip(e.at)
              .child(core.formatAge(e.at, now, " ago")),
          ),
      )
      .when(e.kind === "line" && Boolean(e.path), (el) =>
        el.child(
          div()
            .id(`pr-comment-${i}-path`)
            .font_family(MONO)
            .text_size(11)
            .text_color(t.accent)
            .cursor_pointer()
            .truncate()
            .tooltip(`Open ${at}`)
            .on_click(() => this.openDiff(pr, e.path))
            .child(`${at} →`),
        ),
      )
      .when(e.body.trim() !== "", (el) =>
        el.child(TextView.markdown(`pr-comment-${i}-body-${e.id}`, e.body).text_size(13).text_color(t.foreground).w_full().min_w(0).scrollable(false).selectable(true)),
      );
  }

  detail(root, pr, t) {
    const n = pr.number;
    const prs = this.store.prs;
    const into = core.baseLabel(pr, prs);
    const thread = this.threads[n]?.entries ?? null;
    const files = this.files[n]?.list ?? null;
    const loading = Boolean(this.loading[n]);
    const back = h_flex()
      .id("review-back")
      .h(24)
      .px(4)
      .gap(6)
      .items_center()
      .rounded(2)
      .text_size(12)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip("Back to pull requests")
      .on_click((_e, cx) => {
        this.open = null;
        cx.notify();
      })
      .child("‹")
      .child(mono(`#${n}`, t.foreground, 12));
    root.child(this.head(t, back));
    const failure = this.detailError[n] ?? this.error ?? this.store.error;
    if (failure) root.child(this.note(t, failure, t.ansi9));

    const body = [];
    // The title, then `● open · #188 ↗ · into <base>`, as que's (its files open their diffs).
    const link = (id, text, onClick) =>
      div().id(id).flex_none().font_family(MONO).text_size(11).text_color(t.accent).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(onClick).child(text);
    body.push(
      v_flex()
        .flex_none()
        .px(12)
        .pt(4)
        .pb(10)
        .gap(6)
        .child(div().text_size(14).font_semibold().line_height(1.3).text_color(t.foreground).whitespace_normal().child(pr.title))
        .child(
          h_flex()
            .flex_wrap()
            .gap_x(8)
            .gap_y(2)
            .items_center()
            .children(
              dotted(t, [
                h_flex().flex_none().gap(5).items_center().child(dot(t, core.prDot(pr))).child(mono(pr.state, t.foreground)),
                link("pr-header-link", `#${n} ↗`, (_e, cx) => cx.open_url(pr.url)),
                mono(`into ${into}`, t.dim),
              ]),
            ),
        ),
    );

    // [ CHANGES ]: the pull request's own files against its base.
    const adds = (files ?? []).reduce((s, f) => s + f.additions, 0);
    const dels = (files ?? []).reduce((s, f) => s + f.deletions, 0);
    body.push(this.fold(t, "files", "CHANGES", files ? dotted(t, [lines(t, adds, dels), mono(String(files.length), t.dim), mono(`vs ${into}`, t.dim)]) : [mono(`vs ${into}`, t.dim)]));
    if (this.folds.files) {
      if (files?.length) {
        const shown = shownDiff();
        body.push(v_flex().flex_none().px(4).pb(4).gap(1).children(files.map((f) => this.fileRow(pr, f, t, shown))));
      }
      else body.push(this.note(t, files ? `No files against ${into}` : loading ? "Loading…" : ""));
    }
    body.push(rule(t));

    // [ CHECKS ]: failing, running and skipped runs, the passing ones folded into one line.
    const runs = pr.checkRuns ?? [];
    const { listed, passing } = core.checkGroups(runs);
    const count = core.checksCount(runs);
    body.push(this.fold(t, "checks", "CHECKS", dotted(t, [...(count.failing ? [mono(`${count.failing} failing`, t.ansi9)] : []), ...count.words.map((w) => mono(w, t.dim))])));
    if (this.folds.checks) {
      if (!runs.length) body.push(this.note(t, "No checks"));
      else {
        const rows = listed.map((c, i) => this.checkRow(c, i, t));
        if (passing.length) {
          rows.push(
            h_flex()
              .id("pr-checks-passing")
              .flex_none()
              .pl(6)
              .pr(6)
              .py(4)
              .gap(4)
              .items_center()
              .rounded(4)
              .cursor_pointer()
              .text_color(t.dim)
              .hover((s) => s.bg(t.hover).text_color(t.muted))
              .on_click((_e, cx) => {
                this.passingOpen = !this.passingOpen;
                cx.notify();
              })
              .child(icon(this.passingOpen ? "chevron-down" : "chevron-right", 10))
              .child(
                div()
                  .flex_1()
                  .min_w(0)
                  .truncate()
                  .font_family(MONO)
                  .text_size(11)
                  .child(`${passing.length} passing${this.passingOpen ? "" : ` · ${passing.map((c) => c.name).join(", ")}`}`),
              ),
          );
          if (this.passingOpen) rows.push(...passing.map((c, i) => this.checkRow(c, listed.length + i, t)));
        }
        body.push(v_flex().flex_none().px(4).pb(4).children(rows));
      }
    }
    body.push(rule(t));

    // [ COMMENTS ]: the conversation, oldest first.
    const entries = thread ?? [];
    body.push(this.fold(t, "comments", "COMMENTS", [mono(`${thread ? entries.length : (pr.comments ?? "…")}${pr.review ? ` · ${core.REVIEW_TEXT[pr.review]}` : ""}`, t.dim)]));
    if (this.folds.comments) {
      if (!thread) body.push(this.note(t, loading ? "Loading…" : ""));
      else if (!entries.length) body.push(this.note(t, "No comments yet"));
      else {
        const now = Date.now();
        body.push(v_flex().flex_none().px(4).pb(4).children(entries.map((e, i) => this.comment(pr, e, i, now, t))));
      }
    }
    return root.child(this.scroller(`pr-detail-${n}`, body));
  }

  render(cx) {
    settle();
    if (JSON.stringify(where()) !== this.key) this.tick(cx, false);
    this.follow(cx);
    const t = theme();
    const root = v_flex().id("curfew-prs").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13);
    const pr = this.shown();
    // The pull request moved since its detail was read: read it again, once.
    if (pr && !this.loading[pr.number] && this.asked[pr.number] !== pr.updatedAt) this.loadDetail(pr, cx, false);
    return pr ? this.detail(root, pr, t) : this.list(root, t);
  }
}
