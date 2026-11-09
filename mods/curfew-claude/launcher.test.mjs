// The `claude` launcher against a fake claude that prints its arguments: a copy of the launcher
// in a temp app home (<app>/mods/curfew-claude/claude, without its +x bit, started with sh as the
// mods start it), its launcher.json in <app>/curfew/, HOME a temp folder.
// Run: node --test ~/.config/herdr-app/mods/curfew-claude/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = '#!/bin/sh\necho "fake:$0"\necho "dir:$CURFEW_CLAUDE_DIR"\nfor a in "$@"; do echo "$a"; done\n';

function setup({ launcher, fakeClaude = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "launcher-")));
  const app = path.join(root, "app");
  const dirs = { app, launcher: path.join(app, "mods", "curfew-claude"), data: path.join(app, "curfew"), bin: path.join(root, "bin"), home: path.join(root, "home") };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(HERE, "claude"), path.join(dirs.launcher, "claude"));
  fs.chmodSync(path.join(dirs.launcher, "claude"), 0o644);
  if (launcher !== undefined) fs.writeFileSync(path.join(dirs.data, "launcher.json"), JSON.stringify(launcher));
  if (fakeClaude) {
    fs.writeFileSync(path.join(dirs.bin, "claude"), FAKE);
    fs.chmodSync(path.join(dirs.bin, "claude"), 0o755);
  }
  return { root, ...dirs };
}

/** Runs the launcher as `sh <path>` (direct: as an executable), PATH the given folders and the system's. */
function run(s, args, { pathDirs = [s.launcher, s.bin], env = {}, direct = false } = {}) {
  const file = path.join(s.launcher, "claude");
  const r = spawnSync(direct ? file : "/bin/sh", direct ? args : [file, ...args], {
    encoding: "utf8",
    timeout: 10000,
    env: { PATH: [...pathDirs, "/usr/bin", "/bin"].join(":"), HOME: s.home, ...env },
  });
  return { code: r.status, lines: r.stdout.split("\n").filter(Boolean), stderr: r.stderr };
}

test("execs the real claude with --settings and the instructions file, then the caller's arguments", () => {
  const s = setup();
  const instructions = path.join(s.root, "policy.md");
  fs.writeFileSync(instructions, "be brief");
  fs.writeFileSync(path.join(s.data, "launcher.json"), JSON.stringify({ instructions_file: instructions }));
  const r = run(s, ["--model", "haiku", "a prompt with spaces"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.lines, [
    `fake:${path.join(s.bin, "claude")}`,
    `dir:${s.launcher}`,
    "--settings",
    path.join(s.launcher, "settings.json"),
    "--append-system-prompt-file",
    instructions,
    "--model",
    "haiku",
    "a prompt with spaces",
  ]);
});

test("runs as an executable too (programs.json's run)", () => {
  const s = setup();
  fs.chmodSync(path.join(s.launcher, "claude"), 0o755);
  const r = run(s, ["-p", "hi"], { direct: true });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.lines.slice(1), [`dir:${s.launcher}`, "--settings", path.join(s.launcher, "settings.json"), "-p", "hi"]);
});

test("a missing instructions file, key or launcher.json leaves the flag out, with no error", () => {
  for (const launcher of [{ instructions_file: "/nope/missing.md" }, {}, undefined]) {
    const s = setup({ launcher });
    const r = run(s, ["-p", "hi"]);
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    assert.deepEqual(r.lines.slice(2), ["--settings", path.join(s.launcher, "settings.json"), "-p", "hi"]);
  }
});

test("~/ in instructions_file is the home folder", () => {
  const s = setup({ launcher: { instructions_file: "~/rules.md" } });
  fs.writeFileSync(path.join(s.home, "rules.md"), "x");
  assert.deepEqual(run(s, []).lines.slice(4), ["--append-system-prompt-file", path.join(s.home, "rules.md")]);
});

test("without plutil on PATH, launcher.json is read with node", () => {
  const s = setup();
  // A PATH of only what the launcher uses, and node; never plutil.
  const tools = path.join(s.root, "tools");
  fs.mkdirSync(tools);
  for (const tool of ["dirname", "realpath", "head", "grep"]) {
    const found = spawnSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    if (found) fs.symlinkSync(found, path.join(tools, tool));
  }
  fs.symlinkSync(process.execPath, path.join(tools, "node"));
  const pathDirs = [s.launcher, s.bin, tools];
  const probe = spawnSync("/bin/sh", ["-c", "command -v plutil"], { env: { PATH: pathDirs.join(":") } });
  assert.notEqual(probe.status, 0, "plutil must not be on the test PATH");
  fs.writeFileSync(path.join(s.home, "rules.md"), "x");
  fs.writeFileSync(path.join(s.data, "launcher.json"), JSON.stringify({ instructions_file: "~/rules.md" }));
  const r = spawnSync("/bin/sh", [path.join(s.launcher, "claude"), "-p", "hi"], { encoding: "utf8", timeout: 10000, env: { PATH: pathDirs.join(":"), HOME: s.home } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split("\n").filter(Boolean).slice(1), [
    `dir:${s.launcher}`,
    "--settings",
    path.join(s.launcher, "settings.json"),
    "--append-system-prompt-file",
    path.join(s.home, "rules.md"),
    "-p",
    "hi",
  ]);
});

test("HERDR_APP_HOME picks whose curfew/launcher.json is read; settings stay this folder's", () => {
  const s = setup({ launcher: { instructions_file: "/nope/missing.md" } });
  const other = path.join(s.root, "other-app");
  fs.mkdirSync(path.join(other, "curfew"), { recursive: true });
  fs.writeFileSync(path.join(s.home, "other.md"), "x");
  fs.writeFileSync(path.join(other, "curfew", "launcher.json"), JSON.stringify({ instructions_file: "~/other.md" }));
  const r = run(s, [], { env: { HERDR_APP_HOME: other } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.lines.slice(1), [`dir:${s.launcher}`, "--settings", path.join(s.launcher, "settings.json"), "--append-system-prompt-file", path.join(s.home, "other.md")]);
});

test("settings.json's commands reach the scripts through CURFEW_CLAUDE_DIR, run by a shell as Claude Code runs them", () => {
  const s = setup();
  for (const f of ["settings.json", "statusline.mjs", "pr-hook.mjs"]) fs.copyFileSync(path.join(HERE, f), path.join(s.launcher, f));
  const settings = JSON.parse(fs.readFileSync(path.join(s.launcher, "settings.json"), "utf8"));
  const shell = (command, input) =>
    spawnSync("/bin/sh", ["-c", command], { input, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, HOME: s.home, CURFEW_CLAUDE_DIR: s.launcher } });
  const limits = { five_hour: { used_percentage: 5, resets_at: 1738425600 } };
  assert.equal(shell(settings.statusLine.command, JSON.stringify({ session_id: "s", rate_limits: limits })).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.data, "usage.json"), "utf8")).rateLimits, limits);
  const hook = settings.hooks.PostToolUse[0].hooks[0].command;
  const event = { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "gh pr create --fill" }, tool_response: "https://github.com/o/r/pull/3" };
  assert.equal(shell(hook, JSON.stringify(event)).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.data, "prs.jsonl"), "utf8")).number, 3);
});

test("skips itself and other copies of the launcher on PATH", () => {
  const s = setup();
  fs.chmodSync(path.join(s.launcher, "claude"), 0o755);
  const copy = path.join(s.root, "copy");
  fs.mkdirSync(copy);
  fs.copyFileSync(path.join(s.launcher, "claude"), path.join(copy, "claude"));
  fs.chmodSync(path.join(copy, "claude"), 0o755);
  const r = run(s, [], { pathDirs: [s.launcher, copy, s.bin] });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.lines[0], `fake:${path.join(s.bin, "claude")}`);
});

test("finds claude in ~/.local/bin when PATH has none", () => {
  const s = setup({ fakeClaude: false });
  fs.mkdirSync(path.join(s.home, ".local", "bin"), { recursive: true });
  fs.writeFileSync(path.join(s.home, ".local", "bin", "claude"), FAKE);
  fs.chmodSync(path.join(s.home, ".local", "bin", "claude"), 0o755);
  assert.equal(run(s, []).lines[0], `fake:${path.join(s.home, ".local", "bin", "claude")}`);
});

test("no claude anywhere: exit 127 with a message", () => {
  const s = setup({ fakeClaude: false });
  const r = run(s, []);
  assert.equal(r.code, 127);
  assert.match(r.stderr, /could not find the claude executable/);
});
