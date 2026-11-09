// The + menus of curfew's sidebar: herdr's + menu (Terminal, then "Start an agent" with the
// installed agents, keys 1 to 9), adapted from herdr's shipped new-menu mod.
// - No props, the Sessions +: each choice starts a new session, a space in the home folder
//   outside any project.
// - props { kind: "worktree", repo, key, space, project }, a project's +: a dim header naming the
//   project, the same choices, then "Named worktree…" (herdr's worktree dialog, for a branch of your
//   own, running Claude Code) and "Open worktree…". Terminal or an agent makes a new workspace at
//   once, que's way: the request goes to the sidebar through shared("curfew-new-workspace") (and a
//   `curfew-sidebar.take` to wake it) and this menu closes, since closing an overlay cancels its
//   unfinished tasks; curfew-sidebar runs the steps (its workspace.mjs) and shows the preparing
//   row. The commands `curfew-new-session.terminal`, `.agent-1` … `.agent-9`, `.named` and
//   `.open` pick as a click does (for keys and scripts).
// Agents start the way the + menu starts them (programs.json's run), except Claude Code: through
// curfew's launcher when it is here (mods/curfew-claude/claude, started with sh so it needs no +x).
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, knownAgents, run, closeOverlay, openOverlay, props, home, appHome, shared, setShared, spaces, nextCommand } from "herdr";
import * as fs from "fs/promises";

// new-menu's cache of the agents each machine reported, so the list shows at once.
const KNOWN = "new-menu.agents";
const LAUNCHER = () => `${appHome()}/mods/curfew-claude/claude`;
// A project's + hands Terminal and the agents to curfew-sidebar here (see the header).
const NEW_WORKSPACE = "curfew-new-workspace";
// herdr's + menu draws its worktree rows with this icon, from the person's install.
const BRANCH = "mods/workspace-chrome/branch.svg";

// A session on this computer, in the home folder: a shell, or the agent's argv.
function newSession(agent) {
  run("space.new", agent
    ? { folder: home(), machine: "", tab: agent.name, argv: agent.run }
    : { folder: home(), machine: "" });
}

export default class NewSession extends View {
  init(_props, cx) {
    this.agents = shared(KNOWN)?.[""] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.launcher = false; // whether the launcher is here; until known, Claude starts as the + menu's
    this.worktree = props()?.kind === "worktree" ? props() : null;
    this.opened = Date.now();
    this.picked = false; // one choice per menu
    cx.spawn(async () => {
      this.launcher = await fs.exists(LAUNCHER()).catch(() => false);
    });
    cx.spawn(async (cx) => {
      try {
        this.agents = await knownAgents({ on: null });
        setShared(KNOWN, { ...shared(KNOWN), "": this.agents });
      } catch { this.failed = true; }
      cx.notify();
    });
    if (this.worktree) {
      cx.spawn(async (cx) => {
        for (;;) {
          const command = await nextCommand();
          cx.notify(); // cx first: it throws in a build a reload has replaced, which must not act
          this.command(command);
        }
      });
    }
  }

  installed() {
    return this.agents.filter((a) => a.installed);
  }

  pick(agent) {
    if (this.picked) return; // a second click or key is not a second session or workspace
    this.picked = true;
    const chosen = agent?.key === "claude" && this.launcher ? { ...agent, run: ["sh", LAUNCHER()] } : agent;
    if (this.worktree) this.handOff(chosen);
    closeOverlay(props().overlay);
    if (!this.worktree) newSession(chosen);
  }

  // A new workspace for Terminal or an agent: made by the sidebar, which outlives this menu.
  handOff(agent) {
    const p = this.worktree;
    const now = Date.now();
    const queue = Array.isArray(shared(NEW_WORKSPACE)) ? shared(NEW_WORKSPACE) : [];
    const request = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      at: now,
      repo: p.repo,
      key: p.key ?? null,
      project: p.project ?? "",
      from: spaces().find((s) => s.active)?.id ?? null, // where the person was, to show the new space only if still there
      tab: agent?.name ?? null,
      argv: agent?.run ?? null,
    };
    setShared(NEW_WORKSPACE, [...queue.filter((r) => now - (Number(r?.at) || 0) < 30_000), request]);
    // The sidebar sees the change at its next render too, but that waits for the window to draw.
    run("curfew-sidebar.take");
  }

  // Herdr's worktree dialog on the project's main checkout: "new" asks for a branch and starts
  // Claude Code there (as the sidebar's + did before), "open" lists the repo's checkouts.
  dialog(action) {
    if (this.picked) return;
    this.picked = true;
    const p = this.worktree;
    closeOverlay(p.overlay);
    const claude = this.agents.find((a) => a.key === "claude");
    const argv = this.launcher ? ["sh", LAUNCHER()] : claude?.installed ? claude.run : ["claude"];
    const target = { ...(p.space ? { space: p.space } : {}), folder: p.repo };
    if (action === "new") openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { ...target, action: "new", argv } });
    else openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { ...target, action: "open" } });
  }

  command(c) {
    if (c === "terminal") this.pick(null);
    else if (c === "named") this.dialog("new");
    else if (c === "open") this.dialog("open");
    else if (/^agent-[1-9]$/.test(c)) {
      const agent = this.installed()[Number(c.slice(6)) - 1];
      if (agent) this.pick(agent);
    }
  }

  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    // A project's menu opens under the pointer: the second click of a double click on its + is not a choice.
    const ready = () => !this.worktree || Date.now() - this.opened > 300;
    return h_flex().id(id).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
      .text_color(enabled ? t.foreground : t.dim).when(enabled, (el) => el.hover((s) => s.bg(t.selected)))
      .on_click(() => { if (enabled && ready()) action(); })
      .child(icon).child(div().flex_1().child(name)).child(div().text_size(11).text_color(t.dim).child(hint));
  }

  render() {
    const t = theme();
    const w = this.worktree;
    const installed = this.installed();
    const choices = [...installed, ...this.agents.filter((a) => !a.installed).slice(0, 2)];
    // Sized to its rows: 10 of padding, Terminal 31, "Start an agent" 25 and 31 an agent; a
    // project's menu adds its 24px header, the divider (11) and its two worktree rows.
    const rows = Math.max(1, choices.length) * 31;
    const height = w ? Math.min(520, 163 + rows) : Math.min(360, 66 + rows);
    return v_flex().min_h(0).w_full().h(height).bg(t.popover).p(5).text_size(12.8)
      .id("curfew-new-session").track_focus(this.handle)
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (agent) this.pick(agent);
      })
      .when(Boolean(w), (el) => el.child(h_flex().h(24).px(9).flex_none().items_center().text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(`New workspace in ${w.project || "this project"}`))))
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => this.pick(null)))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => this.pick(a), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)))
        .when(this.agents.length === 0, (el) => el.child(div().px(9).py(6).text_color(t.dim).child(this.failed ? "Could not load agents" : "Checking installed agents…"))))
      .when(Boolean(w), (el) => el
        .child(div().h(1).mx(4).my(5).flex_none().bg(t.border))
        .child(this.row("named", svg(BRANCH).size(14), "Named worktree…", () => this.dialog("new")))
        .child(this.row("open", svg(BRANCH).size(14), "Open worktree…", () => this.dialog("open"))));
  }
}
