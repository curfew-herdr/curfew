// pr-hook.mjs as Claude Code runs it: a copy in a temp app home (<app>/mods/curfew-claude/), the
// hook JSON on stdin; it writes <app>/curfew/prs.jsonl.
// Run: node --test ~/.config/herdr-app/mods/curfew-claude/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A temp app home with the hook copied in; returns its curfew/ folder, where prs.jsonl goes. */
function hookDir() {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "pr-hook-"));
  fs.mkdirSync(path.join(app, "mods", "curfew-claude"), { recursive: true });
  fs.copyFileSync(path.join(HERE, "pr-hook.mjs"), path.join(app, "mods", "curfew-claude", "pr-hook.mjs"));
  return path.join(app, "curfew");
}

function runHook(dir, stdin) {
  const script = path.join(path.dirname(dir), "mods", "curfew-claude", "pr-hook.mjs");
  const r = spawnSync(process.execPath, [script], { input: stdin, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, HOME: os.tmpdir() } });
  const file = path.join(dir, "prs.jsonl");
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, lines };
}

const event = (command, response) =>
  JSON.stringify({
    session_id: "sess-1",
    cwd: "/work/repo",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: response,
  });

test("gh pr create with a URL in its output appends one line with the exact fields", () => {
  const dir = hookDir();
  const r = runHook(dir, event('gh pr create --title "x" --body "y"', { stdout: "https://github.com/acme/widgets/pull/42\n", stderr: "" }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.lines.length, 1);
  const [line] = r.lines;
  assert.deepEqual(Object.keys(line), ["at", "sessionId", "cwd", "url", "owner", "repo", "number"]);
  assert.equal(typeof line.at, "number");
  assert.deepEqual(
    { ...line, at: 0 },
    { at: 0, sessionId: "sess-1", cwd: "/work/repo", url: "https://github.com/acme/widgets/pull/42", owner: "acme", repo: "widgets", number: 42 }
  );
});

test("a chained command counts, the URL found in a plain string response", () => {
  const dir = hookDir();
  const r = runHook(dir, event("git push -u origin HEAD && gh pr create --fill", "Branch set up.\nhttps://github.com/acme/widgets.js/pull/7\n"));
  assert.equal(r.code, 0);
  assert.deepEqual(r.lines.map((l) => [l.owner, l.repo, l.number]), [["acme", "widgets.js", 7]]);
});

test("gh by path after a separator counts; the same URL in stdout and stderr is one line", () => {
  const dir = hookDir();
  const url = "https://github.com/acme/widgets/pull/9";
  const r = runHook(dir, event("cd sub; /opt/homebrew/bin/gh pr create --fill", { stdout: url, stderr: `Creating pull request\n${url}` }));
  assert.deepEqual(r.lines.map((l) => l.url), [url]);
});

test("a command that is not gh pr create writes nothing, even when it prints a PR URL", () => {
  const dir = hookDir();
  for (const command of ["gh pr view 42 --web", "gh pr list", "git status", "ls gh-pr-create"]) {
    const r = runHook(dir, event(command, { stdout: "https://github.com/acme/widgets/pull/42" }));
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
  }
  assert.equal(fs.existsSync(path.join(dir, "prs.jsonl")), false);
});

test("gh pr create without a github.com pull request URL writes nothing", () => {
  const dir = hookDir();
  runHook(dir, event("gh pr create --fill", { stdout: "", stderr: "pull request create failed: GraphQL: No commits" }));
  runHook(dir, event("gh pr create --fill", { stdout: "https://gitlab.com/acme/widgets/-/merge_requests/3" }));
  assert.equal(fs.existsSync(path.join(dir, "prs.jsonl")), false);
});

test("other tools and other events write nothing", () => {
  const dir = hookDir();
  const base = JSON.parse(event("gh pr create", { stdout: "https://github.com/acme/widgets/pull/1" }));
  runHook(dir, JSON.stringify({ ...base, tool_name: "Read" }));
  runHook(dir, JSON.stringify({ ...base, hook_event_name: "PreToolUse" }));
  runHook(dir, JSON.stringify({ ...base, tool_input: {} }));
  assert.equal(fs.existsSync(path.join(dir, "prs.jsonl")), false);
});

test("garbage input exits 0 quietly", () => {
  const dir = hookDir();
  for (const input of ["", "not json", "[1,2", "null", "42", '{"tool_input": null}']) {
    const r = runHook(dir, input);
    assert.equal(r.code, 0, input);
    assert.equal(r.stdout, "", input);
    assert.equal(r.stderr, "", input);
  }
  assert.equal(fs.existsSync(path.join(dir, "prs.jsonl")), false);
});

test("an unwritable folder still exits 0 quietly", () => {
  const dir = hookDir();
  fs.mkdirSync(dir);
  fs.chmodSync(dir, 0o500);
  try {
    const r = runHook(dir, event("gh pr create --fill", "https://github.com/acme/widgets/pull/5"));
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  } finally {
    fs.chmodSync(dir, 0o700);
  }
});

test("lines append; earlier ones stay", () => {
  const dir = hookDir();
  runHook(dir, event("gh pr create --fill", "https://github.com/acme/widgets/pull/1"));
  const r = runHook(dir, event("gh pr create --fill", "https://github.com/acme/widgets/pull/2"));
  assert.deepEqual(r.lines.map((l) => l.number), [1, 2]);
});
