// que's sidebar, in herdr: projects (git repos) and their workspaces (spaces), drawn the way
// que draws them. A row is a dot and a name; its word and its ⋯ come under the pointer. A repo's
// worktree spaces sit under its head; spaces outside any repo are sessions.
// props.role: "list" (default), "strip" (the 40px title strip: search), "foot" (settings).
//
// A project's + opens the + menu (mods/curfew-new-session, props kind "worktree"). Its Terminal
// and agents make a workspace que's way, at once (workspace.mjs: a generated name for the branch
// and the folder, a fetch, origin/<default> as the base, the .worktreeinclude files, que.toml's
// setup ahead of the agent). The menu hands the request over through shared("curfew-new-workspace")
// and closes, since closing an overlay cancels its tasks; this list takes it, runs the steps and
// shows a preparing row under the project (the neutral working mark and the step) until the new
// space's own row takes its place, or the reason it failed until dismissed. The menu then sends
// `curfew-sidebar.take`: render() sees the shared change too, but only while the window draws
// (not behind a locked screen), and the work shouldn't wait for that.
// `curfew-sidebar.new-workspace` (a key, or `herdr-app do`) opens that menu for the shown space's project.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, closeOverlay, exec, theme, watchFolder, pickFolder, props, knownAgents, appHome, home, readTextFile, shared, setShared, notify, nextCommand, window as appWindow } from "herdr";
import * as fs from "fs/promises";
import { Failure, prepareWorkspace, randomName } from "./workspace.mjs";
import { isClaude, nextTitles, paneTitle, cleanKept } from "./titles.mjs";

// que's row titles (titles.mjs): { titles: space -> the name its Claude session gave itself,
// seen: terminal -> the name it showed last }, kept across restarts.
const TITLES = "curfew-sidebar.titles";

const MONO = "Menlo";
const icon = (name, size = 14) => svg(`mods/curfew-sidebar/${name}.svg`).size(size).flex_none();

// The + menu's requests for a new workspace: [{ id, at, repo, key, project, from, tab, argv }]
// (mods/curfew-new-session). One older than STALE (left over from a quit, say) is dropped.
const NEW_WORKSPACE = "curfew-new-workspace";
const STALE = 30_000;
// A made workspace whose space hasn't shown by then says so.
const OPENING = 20_000;
// A project's main checkout, from its key (where git keeps the repository: <main>/.git).
const mainOf = (key) => JSON.parse(key)[1].replace(/\/\.git$/, "");

// curfew's Claude launcher (mods/curfew-claude), started with sh so it needs no +x bit.
const LAUNCHER = () => `${appHome()}/mods/curfew-claude/claude`;

// How Claude Code starts: through the launcher when it is here (this computer only), else the way
// the + menu starts it (programs.json's run), else plain claude.
async function claudeArgv(machine) {
  if (!machine && (await fs.exists(LAUNCHER()).catch(() => false))) return ["sh", LAUNCHER()];
  const claude = await knownAgents({ on: machine }).then((agents) => agents.find((a) => a.key === "claude"), () => null);
  return claude?.installed ? claude.run : ["claude"];
}

// The working mark: four 3px dots on a 2×2 grid at a 5px pitch, rippling from the top-left.
// "frames" samples que's ripple every 100 ms (the timing of que's menu-bar mark): each dot grows
// 360 ms, holds 300, shrinks 360 and rests 180; the top-right and bottom-left run 120 ms behind
// the top-left, the bottom-right 240. "pulse" is a smooth fade, the top-left eased ahead.
const MARK = "frames";
const scale = (t, delay) => {
  const u = (((t - delay) % 1200) + 1200) % 1200;
  return u < 360 ? u / 360 : u < 660 ? 1 : u < 1020 ? 1 - (u - 660) / 360 : 0;
};
const glyph = (s) => (s < 0.05 ? " " : s < 0.4 ? "·" : s < 0.75 ? "•" : "●");
const RIPPLE = [0, 120, 120, 240].map((delay) => Array.from({ length: 12 }, (_, i) => glyph(scale(i * 100, delay))));
const EASE = ["ease-out", "ease-in-out", "ease-in-out", "ease-in"];

function workingMark(color) {
  const dot = (i) =>
    MARK === "frames"
      ? div().size(3).flex().items_center().justify_center().font_family(MONO).text_size(6).text_color(color).frames(RIPPLE[i], 100)
      : div().size(3).rounded_full().bg(color).loop("opacity", { from: 0.15, to: 1, period: 1200, easing: EASE[i] });
  return v_flex().size(8).gap(2)
    .child(h_flex().gap(2).child(dot(0)).child(dot(1)))
    .child(h_flex().gap(2).child(dot(2)).child(dot(3)));
}

// que's --fg-secondary (#c9c9c9) lies between foreground and muted; the theme has no name for it.
function between(a, b, w) {
  const ch = (c, i) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - w) + ch(b, i) * w).toString(16).padStart(2, "0")).join("");
}

const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, ps) {
  const tabs = new Set(s.tabs.map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);

// Programs in front of a shell that aren't agents (a dev server, a watcher): que's `›_`.
function running(s, ps) {
  const tabs = new Set(s.tabs.map((c) => c.id));
  const busy = ps.filter((p) => tabs.has(p.tab) && p.terminal && p.program && !p.program.shell && !p.program.agent);
  return [...new Set(busy.map((p) => (p.program.key === "program" ? p.program.name : p.program.key)))];
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}

// How a row reads: herdr's status in que's tones, the weight of its name, its word.
function statusLook(s, bg, t) {
  const changed = Math.max(0, ...s.tabs.map((c) => c.changed_at ?? 0));
  switch (s.status) {
    case "blocked": return { dot: t.blocked, name: t.foreground, word: "needs input", tone: t.blocked, loud: true };
    case "done": return { dot: t.done, name: t.foreground, word: changed ? `done · ${ago(changed)}` : "done", loud: true };
    case "working": return { mark: true, name: between(t.foreground, t.muted, 0.45), word: "working", loud: true };
    case "idle": return { dot: t.idle, name: t.dim, word: ["idle", ...bg].join(" · ") };
    default: return { dot: t.unknown, name: t.dim, word: bg.length ? bg.join(" · ") : "shell" };
  }
}

export default class QueSidebar extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "list";
    this.hover = null; // the row or head under the pointer
    if (this.role !== "list") return;
    this.git = {}; // where() -> { top, repo, name, branch, ahead, behind, linked }; null: no repo
    this.asking = new Set();
    this.watching = new Set();
    this.working = {}; // space -> it was working at the last render
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    this.jobs = []; // workspaces being made: { id, key, repo, project, from, name, path, step, error }
    this.handled = new Set(); // the requests taken
    this.names = new Set(); // names drawn by the jobs, until their branches exist
    this.host = { exec, readTextFile, home, log: (m) => console.log(`curfew-sidebar: ${m}`) };
    const kept = cleanKept(shared(TITLES));
    this.titles = kept.titles;
    this.seenTitles = kept.seen;
    if (kept.changed) setShared(TITLES, { titles: kept.titles, seen: kept.seen });
    // Commits made elsewhere and other machines' repos: looked at again now and then.
    cx.timer.every(60000, (cx) => {
      if (appWindow()?.active) this.ask(Object.keys(this.git), cx);
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        // cx first: it throws in a build a reload has replaced, so a loop left from one ends here
        // rather than acting on the command with old code.
        cx.notify();
        if (command === "new-workspace") await this.newWorkspaceHere(cx);
        else if (command === "take") this.take(cx);
      }
    });
    this.take(cx); // one handed over while this was reloading
  }

  ask(keys, cx) {
    const fresh = [...new Set(keys)].filter((k) => !this.asking.has(k));
    if (!fresh.length) return;
    fresh.forEach((k) => this.asking.add(k));
    cx.spawn(async (cx) => {
      for (const k of fresh) {
        try { this.git[k] = await this.gitOf(k, cx); } catch { this.git[k] ??= null; }
        this.asking.delete(k);
      }
      cx.notify();
    });
  }

  // A place's repo, branch and distance from its upstream. Reads only, so nothing under .git
  // changes and the watch below never wakes itself.
  async gitOf(key, cx) {
    const [on, cwd] = JSON.parse(key);
    if (!cwd) return null;
    const git = (args) => exec("git", args, { cwd, on, timeout: 5000 });
    const r = await git(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "--abbrev-ref", "HEAD"]);
    if (r.code !== 0) return null;
    const [top, common, head] = r.stdout.trim().split("\n");
    const ab = await git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    const [ahead, behind] = ab.code === 0 ? ab.stdout.trim().split(/\s+/).map(Number) : [0, 0];
    if (!on) this.watch(common, cx);
    return {
      top,
      repo: JSON.stringify([on, common]),
      name: common.endsWith("/.git") ? base(common.slice(0, -5)) : base(common).replace(/\.git$/, ""),
      branch: head && head !== "HEAD" ? head : null,
      ahead: ahead || 0,
      behind: behind || 0,
      linked: common !== `${top}/.git`,
    };
  }

  // A commit, checkout or fetch in a local repo: look at its places again.
  watch(common, cx) {
    if (this.watching.has(common)) return;
    this.watching.add(common);
    const repo = JSON.stringify([null, common]);
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          await watchFolder(common);
          this.ask(Object.keys(this.git).filter((k) => this.git[k]?.repo === repo), cx);
        }
      } catch { this.watching.delete(common); }
    });
  }

  hovered(id, on, cx) {
    const next = on ? id : this.hover === id ? null : this.hover;
    if (next !== this.hover) { this.hover = next; cx.notify(); }
  }

  fold(repo, cx) {
    this.folded.has(repo) ? this.folded.delete(repo) : this.folded.add(repo);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.notify();
  }

  menu(s) {
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: s.id } } });
  }

  // herdr's worktree dialog: a new worktree running Claude Code, herdr asking for its branch.
  newWorktree(r) {
    claudeArgv(r.s.machine).then((argv) => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: r.s.id, folder: r.g.top, action: "new", argv } }));
  }

  // que's project +: the + menu, whose Terminal and agents come back here as requests (take).
  // A project on another machine gets herdr's worktree dialog for now: workspace.mjs runs git and
  // reads que.toml on this computer only.
  newWorkspace(p) {
    const r = p.rows[0];
    if (JSON.parse(p.repo)[0]) {
      if (r) this.newWorktree(r);
      return;
    }
    // One project menu at a time (a key can open another while one is up): two would both take a
    // `curfew-new-session.terminal` and make two workspaces.
    if (this.projectMenu) closeOverlay(this.projectMenu);
    this.projectMenu = openOverlay({ mod: "curfew-new-session", kind: "popup", width: 250, height: 520,
      props: { kind: "worktree", repo: mainOf(p.repo), key: p.repo, space: r?.s.id ?? null, project: p.name } });
  }

  // The shown space's project, for the new-workspace command (asked of git when no render has yet).
  async newWorkspaceHere(cx) {
    const s = spaces().find((x) => x.active);
    if (!s) return;
    const k = where(s, panes());
    const g = this.git[k] ?? (await this.gitOf(k, cx).catch(() => null));
    if (g) this.newWorkspace({ repo: g.repo, name: g.name, rows: [{ s, g }] });
  }

  // Requests from the + menu (on its take command, or at a render): each is taken once (by id),
  // then cleared from the shared list.
  take(cx) {
    const queue = shared(NEW_WORKSPACE);
    if (!Array.isArray(queue) || queue.length === 0) return;
    for (const r of queue) {
      if (!r || typeof r.id !== "string" || this.handled.has(r.id)) continue;
      this.handled.add(r.id);
      if (typeof r.repo === "string" && r.repo && Date.now() - (Number(r.at) || 0) < STALE) this.start(r, cx);
    }
    cx.timer.after(0, () => {
      const now = shared(NEW_WORKSPACE);
      if (Array.isArray(now) && now.some((r) => this.handled.has(r?.id))) setShared(NEW_WORKSPACE, now.filter((r) => !this.handled.has(r?.id)));
    });
  }

  // Its row shows at once, under its project (unfolded), with the first name drawn.
  start(r, cx) {
    const key = typeof r.key === "string" ? r.key : null;
    const job = { id: r.id, key, repo: r.repo, project: r.project || base(r.repo), from: r.from ?? null, name: randomName(), path: "", step: "preparing", error: "" };
    this.jobs.push(job);
    if (key && this.folded.delete(key)) localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.spawn(async (cx) => this.make(job, r, cx));
  }

  // The steps, then the space: in the worktree, its first tab the agent (with que.toml's setup
  // ahead of it) or a shell. A step that fails leaves nothing behind and its reason on the row.
  async make(job, r, cx) {
    // A reload of this mod mid-way must not stop the steps half done: only the redraw is lost.
    const redraw = () => {
      try {
        cx.notify();
      } catch {}
    };
    try {
      const made = await prepareWorkspace(this.host, { repo: job.repo, agent: Array.isArray(r.argv) && r.argv.length ? r.argv : null }, {
        first: job.name,
        taken: this.names,
        onName: (name, path) => {
          job.name = name;
          job.path = path;
          redraw();
        },
        onStep: (step) => {
          job.step = step;
          redraw();
        },
        onWarning: (warning) => notify({ title: `que.toml ignored in ${job.project}`, body: warning.replace(/^que\.toml ignored: /, ""), level: "warning" }),
      });
      job.step = "opening";
      const shown = spaces().find((s) => s.active)?.id ?? null;
      // Unnamed, so it follows its folder and nests under the repo, like herdr's own worktree spaces.
      run("space.new", { folder: made.path, machine: "", ...(typeof r.tab === "string" && r.tab ? { tab: r.tab } : {}), ...(made.argv ? { argv: made.argv } : {}) });
      // herdr shows a new space, as que shows the new workspace; but que never pulls back someone
      // who has gone to another space since asking.
      if (job.from && shown && shown !== job.from) run("space.select", { id: shown });
      redraw();
      cx.timer.after(OPENING, (cx) => {
        if (this.jobs.includes(job) && !job.error) {
          job.error = `its space did not open; the worktree is at ${job.path.split(home()).join("~")}`;
          cx.notify();
        }
      });
    } catch (e) {
      // Paths with ~ for the home folder, as que writes them.
      job.error = (e instanceof Failure ? e.message : String(e?.message ?? e)).split(home()).join("~");
      redraw();
    }
  }

  // The preparing row goes once the made space's own row can show (git has answered for it).
  settle(sp, ps) {
    const shows = (job) => sp.some((s) => !s.machine && (s.folder === job.path || place(s, ps) === job.path) && this.git[where(s, ps)]);
    if (this.jobs.some((j) => !j.error && j.step === "opening" && shows(j))) this.jobs = this.jobs.filter((j) => j.error || j.step !== "opening" || !shows(j));
  }

  dismiss(job, cx) {
    this.jobs = this.jobs.filter((j) => j !== job);
    cx.notify();
  }

  // The Sessions +: herdr's + menu (Terminal, Start an agent), each choice a new session in the
  // home folder (mods/curfew-new-session).
  newSession() {
    openOverlay({ mod: "curfew-new-session", kind: "popup", width: 250, height: 360 });
  }

  addProject(cx) {
    cx.spawn(async () => {
      const folder = await pickFolder({ prompt: "Add project" });
      if (folder) run("space.new", { folder });
    });
  }

  // A 22px line icon, faint until the pointer is on it.
  ghost(id, name, tip, t, action) {
    return h_flex().id(id).size(22).flex_none().items_center().justify_center().rounded(2).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(icon(name, 16));
  }

  mono(text, color) {
    return div().flex_none().font_family(MONO).text_size(11).text_color(color).child(text);
  }

  section(label, button, t) {
    return h_flex().h(24).mt(8).px(8).flex_none().items_center()
      .child(div().flex_1().font_family(MONO).text_size(10).font_medium().text_color(t.dim).child(`[ ${label} ]`))
      .child(button);
  }

  head(p, t) {
    const id = `head-${p.repo}`, hot = this.hover === id, open = !this.folded.has(p.repo);
    const done = p.rows.filter((r) => r.s.status === "done" && !r.s.active).length;
    return h_flex().id(id).h(26).mt(8).px(8).gap(6).flex_none().items_center().rounded(4)
      .when(hot, (el) => el.bg(t.hover))
      .tooltip(JSON.parse(p.repo)[1].replace(/\/\.git$/, ""))
      .on_hover((on, cx) => this.hovered(id, on, cx))
      .on_click((_e, cx) => this.fold(p.repo, cx))
      .child(h_flex().w(16).flex_none().justify_center().text_color(hot ? t.muted : t.dim)
        .child(icon(hot ? (open ? "chevron-down" : "chevron-right") : "folder")))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium()
        .text_color(hot ? between(t.foreground, t.muted, 0.45) : t.muted).child(p.name))
      .when(!open && !hot, (el) => el.child(h_flex().flex_none().font_family(MONO).text_size(11).text_color(t.dim)
        .when(done > 0, (c) => c.child(div().text_color(t.done).child(`${done} done`)).child(div().child(" · ")))
        .child(String(p.rows.length))))
      .when(hot, (el) => el.child(this.ghost(`new-${p.repo}`, "plus", "New workspace: a terminal or an agent in a new worktree", t, () => this.newWorkspace(p))));
  }

  // A workspace being made: que's preparing row, the working mark in the neutral tone and the
  // step it is on where `›_` would sit. Once a step has failed: the bad tone's dot, `failed` and
  // ×, and the reason on a line under it (whole in its tooltip); nothing of it is left on disk.
  jobRow(job, t) {
    const id = `job-${job.id}`, failed = Boolean(job.error);
    const row = h_flex().id(id).h(26).px(8).gap(6).flex_none().items_center().rounded(4)
      .when(this.hover === id, (el) => el.bg(t.hover))
      .on_hover((on, cx) => this.hovered(id, on, cx))
      .child(h_flex().size(16).flex_none().items_center().justify_center()
        .child(failed ? div().size(5).rounded_full().bg(t.ansi9) : workingMark(t.idle)))
      .child(div().flex_1().min_w(0).truncate().text_color(failed ? t.foreground : between(t.foreground, t.muted, 0.45)).child(job.name))
      .child(this.mono(failed ? "failed" : job.step, failed ? t.ansi9 : t.dim))
      .when(failed, (el) => el.child(h_flex().id(`dismiss-${job.id}`).size(18).flex_none().items_center().justify_center().rounded(2)
        .text_color(t.dim).hover((st) => st.bg(t.selected).text_color(t.foreground)).tooltip("Dismiss")
        .on_click((_e, cx) => { cx.stop_propagation(); this.dismiss(job, cx); })
        .child("×")));
    if (!failed) return row;
    return v_flex().flex_none().child(row)
      .child(div().id(`${id}-error`).pl(30).pr(8).pb(4).font_family(MONO).text_size(11).text_color(t.ansi9).truncate().tooltip(job.error).child(job.error));
  }

  // que's titles: each Claude session's name for its space, saved when one changes.
  follow(sp, ps) {
    const spaceOf = new Map();
    for (const s of sp) for (const c of s.tabs) spaceOf.set(c.id, s.id);
    const sessions = ps.filter((p) => isClaude(p) && spaceOf.has(p.tab)).map((p) => ({ space: spaceOf.get(p.tab), terminal: p.terminal, title: paneTitle(p) }));
    const r = nextTitles(this.titles, this.seenTitles, sessions, sp.map((s) => s.id));
    const seenChanged = JSON.stringify(r.seen) !== JSON.stringify(this.seenTitles);
    this.titles = r.titles;
    this.seenTitles = r.seen;
    if (r.changed || seenChanged) setShared(TITLES, { titles: r.titles, seen: r.seen });
  }

  row({ s, g }, session, t, ps) {
    const id = `row-${s.id}`, hot = this.hover === id, bg = running(s, ps), look = statusLook(s, bg, t);
    // que's row name: a space someone named keeps its name; else the name its Claude session gave
    // itself (titles.mjs); else the branch (a worktree's generated name); else herdr's name.
    const name = s.named ? s.name : this.titles[s.id] || (g?.branch ? g.branch : s.name);
    // The branch isn't on the row (que keeps it to the hover card): a worktree's generated name
    // means nothing next to its session's name. It shows in the row's tooltip instead.
    const branch = g?.branch && g.branch !== name ? g.branch : "";
    const ab = [g?.ahead ? `↑${g.ahead}` : "", g?.behind ? `↓${g.behind}` : ""].filter(Boolean).join(" ");
    const mark = look.mark ? workingMark(t.accent) : session && !look.loud ? this.mono("›_", t.dim) : div().size(5).rounded_full().bg(look.dot);
    return h_flex().id(id).h(26).px(8).gap(6).flex_none().items_center().rounded(4)
      .when(s.active, (el) => el.bg(t.selected))
      .when(!s.active && hot, (el) => el.bg(t.hover))
      .when(Boolean(branch), (el) => el.tooltip(`branch ${branch}`))
      .on_hover((on, cx) => this.hovered(id, on, cx))
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", () => this.menu(s))
      .child(h_flex().size(16).flex_none().items_center().justify_center().child(mark))
      .child(div().flex_1().min_w(0).truncate().text_color(s.active ? t.foreground : look.name).child(name))
      .when(!hot && Boolean(ab), (el) => el.child(this.mono(ab, t.dim)))
      .when(!hot && !look.mark && bg.length > 0, (el) => el.child(this.mono("›_", t.dim)))
      .when(hot, (el) => el.child(this.mono(look.word, look.tone ?? t.dim))
        .child(h_flex().id(`more-${s.id}`).size(18).flex_none().items_center().justify_center().rounded(2).text_color(t.dim)
          .hover((st) => st.bg(t.selected).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.menu(s); })
          .child("⋯")));
  }

  render(cx) {
    const t = theme();
    if (this.role === "strip") {
      return h_flex().size_full().bg(t.chrome).pr(10).items_center().justify_end()
        .child(this.ghost("search", "search", "Search spaces", t, () => run("mod.open", { name: "picker" })));
    }
    if (this.role === "foot") {
      return h_flex().size_full().bg(t.chrome).px(5).gap(2).items_center()
        .child(this.ghost("settings", "gear", "Settings", t, () => run("app.settings")));
    }
    const ps = panes(), sp = spaces();
    this.take(cx);
    // New places, and places where an agent's turn just ended (it may have committed).
    const due = [];
    for (const s of sp) {
      const k = where(s, ps);
      if (!(k in this.git) || (this.working[s.id] && s.status !== "working")) due.push(k);
      this.working[s.id] = s.status === "working";
    }
    if (due.length) this.ask(due, cx);
    this.settle(sp, ps);
    this.follow(sp, ps);

    const sessions = [], projects = new Map();
    for (const s of sp) {
      const g = this.git[where(s, ps)];
      if (g === undefined) continue; // shows once git has answered, under its repo
      if (!g) { sessions.push({ s, g }); continue; }
      if (!projects.has(g.repo)) projects.set(g.repo, { repo: g.repo, name: g.name, rows: [] });
      projects.get(g.repo).rows.push({ s, g });
    }
    for (const p of projects.values()) p.rows.sort((a, b) => a.g.linked - b.g.linked);
    // Workspaces being made go under their project (which keeps its head even with no space left).
    for (const job of this.jobs) {
      const key = (job.key && projects.has(job.key) && job.key) || [...projects.keys()].find((k) => mainOf(k) === job.repo) || job.key || JSON.stringify([null, `${job.repo}/.git`]);
      if (!projects.has(key)) projects.set(key, { repo: key, name: job.project, rows: [] });
      (projects.get(key).jobs ??= []).push(job);
    }

    return v_flex().id("curfew-sidebar").size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(v_flex().id("curfew-sidebar-list").flex_1().min_h(0).px(6).pb(8).overflow_y_scrollbar()
        .child(this.section("SESSIONS", this.ghost("session-new", "plus", "New session: a terminal or an agent outside any project", t, () => this.newSession()), t))
        .children(sessions.map((r) => this.row(r, true, t, ps)))
        .child(this.section("PROJECTS", this.ghost("project-add", "folder-plus", "Add project: a git repository", t, (cx) => this.addProject(cx)), t))
        .children([...projects.values()].flatMap((p) => [this.head(p, t), ...(this.folded.has(p.repo) ? [] : [...p.rows.map((r) => this.row(r, false, t, ps)), ...(p.jobs ?? []).map((j) => this.jobRow(j, t))])]))
        .when(projects.size === 0, (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child("Add a git repository to start a workspace."))));
  }
}
