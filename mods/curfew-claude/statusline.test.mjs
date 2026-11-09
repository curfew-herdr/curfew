// statusline.mjs as Claude Code runs it: a copy in a temp app home (<app>/mods/curfew-claude/),
// the status line JSON on stdin, HOME a temp folder so the real ~/.claude is never read.
// Run: node --test ~/.config/herdr-app/mods/curfew-claude/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "statusline-"));
  const app = path.join(root, "app");
  const dir = path.join(app, "mods", "curfew-claude");
  const data = path.join(app, "curfew");
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  for (const d of [dir, home, project]) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(HERE, "statusline.mjs"), path.join(dir, "statusline.mjs"));
  return { root, dir, data, home, project, usage: path.join(data, "usage.json") };
}

function run(s, stdin, env = {}) {
  const r = spawnSync(process.execPath, [path.join(s.dir, "statusline.mjs")], {
    input: stdin,
    encoding: "utf8",
    timeout: 10000,
    cwd: s.project,
    env: { PATH: process.env.PATH, HOME: s.home, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function settings(file, statusLine) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ statusLine }));
}

const LIMITS = {
  five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
  seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
};

const payload = (s, extra = {}) =>
  JSON.stringify({ session_id: "sess-1", cwd: s.project, workspace: { project_dir: s.project }, ...extra });

test("rate_limits are written to <app>/curfew/usage.json as sent, with when and which session", () => {
  const s = setup();
  const before = Date.now();
  const r = run(s, payload(s, { rate_limits: LIMITS }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
  const u = JSON.parse(fs.readFileSync(s.usage, "utf8"));
  assert.deepEqual(Object.keys(u), ["updatedAt", "sessionId", "rateLimits"]);
  assert.ok(u.updatedAt >= before && u.updatedAt <= Date.now());
  assert.equal(u.sessionId, "sess-1");
  assert.deepEqual(u.rateLimits, LIMITS);
  assert.deepEqual(fs.readdirSync(s.data), ["usage.json"]); // no temp file left
  assert.deepEqual(fs.readdirSync(s.dir), ["statusline.mjs"]); // nothing written in the mod folder
});

test("HERDR_APP_HOME picks the app home whose curfew/ gets the reading", () => {
  const s = setup();
  const other = path.join(s.root, "other-app");
  run(s, payload(s, { rate_limits: LIMITS }), { HERDR_APP_HOME: other });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(other, "curfew", "usage.json"), "utf8")).rateLimits, LIMITS);
  assert.equal(fs.existsSync(s.usage), false);
});

test("one window is enough; extra fields Claude Code sends are kept", () => {
  const s = setup();
  const limits = { seven_day: { used_percentage: 7, resets_at: 1738857600, extra: "x" } };
  run(s, payload(s, { rate_limits: limits }));
  assert.deepEqual(JSON.parse(fs.readFileSync(s.usage, "utf8")).rateLimits, limits);
});

test("a payload without a usable window leaves the last reading alone", () => {
  const s = setup();
  run(s, payload(s, { rate_limits: LIMITS }));
  const kept = fs.readFileSync(s.usage, "utf8");
  for (const extra of [{}, { rate_limits: {} }, { rate_limits: { five_hour: { used_percentage: "23" , resets_at: 1 } } }, { rate_limits: { five_hour: { used_percentage: 5 } } }]) {
    const r = run(s, payload(s, extra));
    assert.equal(r.code, 0);
  }
  assert.equal(fs.readFileSync(s.usage, "utf8"), kept);
});

test("garbage stdin exits 0 with no output and no file", () => {
  const s = setup();
  for (const input of ["", "nope", "[1", "null"]) {
    const r = run(s, input);
    assert.equal(r.code, 0, input);
    assert.equal(r.stdout, "", input);
  }
  assert.equal(fs.existsSync(s.usage), false);
});

test("the user's own status line runs with the same stdin, its output and exit status passed through", () => {
  const s = setup();
  settings(path.join(s.project, ".claude", "settings.local.json"), { type: "command", command: "cat; exit 3" });
  const input = payload(s, { rate_limits: LIMITS });
  const r = run(s, input);
  assert.equal(r.stdout, input);
  assert.equal(r.code, 3);
  assert.ok(fs.existsSync(s.usage));
});

test("the most specific settings file wins; the home one is the fallback", () => {
  const s = setup();
  settings(path.join(s.home, ".claude", "settings.json"), { type: "command", command: "echo home" });
  assert.equal(run(s, payload(s)).stdout, "home\n");
  settings(path.join(s.project, ".claude", "settings.json"), { type: "command", command: "echo project" });
  assert.equal(run(s, payload(s)).stdout, "project\n");
  settings(path.join(s.project, ".claude", "settings.local.json"), { type: "command", command: "echo local" });
  assert.equal(run(s, payload(s)).stdout, "local\n");
});

test("a settings file naming this status line is passed over, so it never runs itself", () => {
  const s = setup();
  settings(path.join(s.project, ".claude", "settings.json"), { type: "command", command: `node ${path.join(s.dir, "statusline.mjs")}` });
  settings(path.join(s.home, ".claude", "settings.json"), { type: "command", command: "node ~/.config/herdr-app/mods/curfew-claude/statusline.mjs" });
  const r = run(s, payload(s));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "");
});

test("a status line that is not a command, or a broken settings file, is passed over", () => {
  const s = setup();
  fs.mkdirSync(path.join(s.project, ".claude"));
  fs.writeFileSync(path.join(s.project, ".claude", "settings.local.json"), "{ broken");
  settings(path.join(s.project, ".claude", "settings.json"), { type: "static", command: "echo no" });
  settings(path.join(s.home, ".claude", "settings.json"), { type: "command", command: "echo yes" });
  assert.equal(run(s, payload(s)).stdout, "yes\n");
});

test("this status line reached by another spelling (a symlink) still runs the user's line only once", () => {
  const s = setup();
  const other = path.join(path.dirname(s.dir), "other");
  fs.mkdirSync(other);
  fs.symlinkSync(path.join(s.dir, "statusline.mjs"), path.join(other, "alias.mjs"));
  settings(path.join(s.project, ".claude", "settings.json"), { type: "command", command: `node ${path.join(other, "alias.mjs")}; echo after` });
  const r = run(s, payload(s));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "after\n");
});
