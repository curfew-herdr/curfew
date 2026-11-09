// node --test ~/.config/herdr-app/mods/curfew-sidebar/agents.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isClaudeAgent, agentTitle, agentName, agentWord, sortAgents, folderName, agentProject } from "./agents.mjs";

const HOME = "/home/me";
// herdr's agents, as agents() reports them.
const CLAUDE = { key: "claude", name: "Claude Code", shell: false, agent: true };
const CODEX = { key: "codex", name: "Codex", shell: false, agent: true };
const claude = (fields) => ({ address: "t2p", space: "s1", tab: "a", app: "claude-code", program: CLAUDE, title: "", tab_name: "Claude Code", tab_index: 1, status: "idle", ...fields });

test("isClaudeAgent knows Claude Code by the agent's report or the program", () => {
  assert.equal(isClaudeAgent(claude({})), true);
  assert.equal(isClaudeAgent(claude({ app: null })), true);
  assert.equal(isClaudeAgent({ address: "t3", app: "codex", program: CODEX }), false);
  assert.equal(isClaudeAgent(undefined), false);
});

test("a terminal with no title, which herdr reports as its address, has no name", () => {
  assert.equal(agentTitle({ address: "t2c", title: "t2c" }), "");
  assert.equal(agentTitle({ address: "vps/t2c", title: "t2c" }), "");
  assert.equal(agentTitle({ address: "vps/t2c", title: "vps/t2c" }), "");
  assert.equal(agentTitle({ address: "t2c" }), "");
  assert.equal(agentTitle({ address: "t2c", title: "✳ Small bug hunt" }), "✳ Small bug hunt");
});

test("an agent is named after its Claude Code session, else its named tab, its program, its tab", () => {
  assert.equal(agentName(claude({ title: "✳ Small bug hunt" }), false), "Small bug hunt");
  // The session's name comes before a tab someone named.
  assert.equal(agentName(claude({ title: "◐ Small bug hunt", tab_name: "fix login" }), true), "Small bug hunt");
  assert.equal(agentName(claude({ title: "Claude Code", tab_name: "fix login" }), true), "fix login");
  assert.equal(agentName(claude({ title: "" }), false), "Claude Code");
  assert.equal(agentName(claude({ address: "t2c", title: "t2c", tab_name: "1" }), false), "Claude Code");
  // Known by its program alone.
  assert.equal(agentName(claude({ app: null, title: "✳ Small bug hunt" }), false), "Small bug hunt");
  // Another agent's title isn't a session name; an unnamed tab's number comes after the program.
  assert.equal(agentName({ address: "t3", app: "codex", program: CODEX, title: "✳ Something", tab_name: "2", tab_index: 2 }, false), "Codex");
  assert.equal(agentName({ address: "t4", app: "pi", program: null, title: "", tab_name: "3", tab_index: 3 }, false), "3");
  assert.equal(agentName({ address: "t5", app: "pi", title: "", tab_name: "", tab_index: 4 }, false), "tab 4");
});

test("a status reads as the space rows word it, without times", () => {
  assert.equal(agentWord("blocked"), "needs input");
  assert.equal(agentWord("working"), "working");
  assert.equal(agentWord("done"), "done");
  assert.equal(agentWord("idle"), "idle");
  assert.equal(agentWord("asleep"), "asleep");
  assert.equal(agentWord(null), "");
});

test("agents that need input come first, then working, done, idle, anything else, in herdr's order within each", () => {
  const list = [
    { address: "t1", status: "idle" },
    { address: "t2", status: "done" },
    { address: "t3", status: "working" },
    { address: "t4", status: "blocked" },
    { address: "t5", status: "asleep" },
    { address: "t6", status: "working" },
    { address: "t7", status: "blocked" },
    { address: "t8", status: "idle" },
  ];
  assert.deepEqual(sortAgents(list).map((a) => a.address), ["t4", "t7", "t3", "t6", "t2", "t1", "t8", "t5"]);
  // herdr's list is left as it was.
  assert.equal(list[0].address, "t1");
  assert.deepEqual(sortAgents([]), []);
});

test("the project is the space's repository, else its folder's name, ~ at home, blank until git answers", () => {
  assert.equal(agentProject({ name: "uploader" }, "/home/me/.herdr/worktrees/uploader/zesty-bold-turnip", HOME), "uploader");
  assert.equal(agentProject(null, "/home/me/notes", HOME), "notes");
  assert.equal(agentProject(null, HOME, HOME), "~");
  assert.equal(agentProject(undefined, "/home/me/notes", HOME), "");
  assert.equal(folderName("/home/me/notes/", HOME), "notes");
  assert.equal(folderName("/home/me/", HOME), "~");
  // herdr's empty folder is the home.
  assert.equal(folderName("", HOME), "~");
  assert.equal(folderName("/", HOME), "/");
  // On another machine the home isn't known.
  assert.equal(folderName("/home/me", null), "me");
});
