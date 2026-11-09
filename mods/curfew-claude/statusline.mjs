// The status line the launcher gives each session (settings.json), a port of que's
// `que statusline`. Claude Code runs it with the session's JSON on stdin after each reply.
// It records the plan usage (`rate_limits`, exactly as sent) in <app home>/curfew/usage.json for
// the curfew-usage chip, then runs the user's own status line with the same stdin, passing its
// output and exit status through. A bad payload or a failed write never fails the line.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
// <app home>/curfew/: the app home is $HERDR_APP_HOME, else the one this file is in
// (<app home>/mods/curfew-claude/). Not this folder: herdr reloads a mod whose files change.
const DATA = path.join(process.env.HERDR_APP_HOME || path.resolve(path.dirname(SELF), "..", ".."), "curfew");

/** How long the user's own status line may run. */
const USER_LINE_TIMEOUT_MS = 5000;

const fields = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => (typeof v === "string" && v !== "" ? v : undefined);

/** A window que would show: a finite percentage and a reset time (Unix seconds). */
const usable = (w) => finite(fields(w).used_percentage) && finite(fields(w).resets_at) && fields(w).resets_at > 0;

/** Writes usage.json when the payload carries a window, atomically; any failure is dropped. */
function record(input) {
  const limits = fields(input).rate_limits;
  if (!usable(fields(limits).five_hour) && !usable(fields(limits).seven_day)) return;
  const file = path.join(DATA, "usage.json");
  const tmp = `${file}.${process.pid}.tmp`;
  const reading = { updatedAt: Date.now(), sessionId: str(input.session_id) ?? null, rateLimits: limits };
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(reading)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/** This script, however a settings file spells it (as run, resolved, or under ~). */
const OWN = [...new Set([SELF, process.argv[1]].filter(Boolean))];
const isOwnLine = (command) => OWN.some((p) => command.includes(p)) || /curfew-claude\/statusline\.mjs/.test(command);

/** Set for the user's line, so a spelling of this script that slips past isOwnLine still ends there. */
const NESTED = "HERDR_CLAUDE_STATUSLINE";

/**
 * The user's own status line command: the first `statusLine` of type `command` that is not
 * this one, reading the settings files most specific first (as que and Claude Code do). Read
 * only; never written.
 */
function userLine(projectDir) {
  const files = [
    path.join(projectDir, ".claude", "settings.local.json"),
    path.join(projectDir, ".claude", "settings.json"),
    path.join(os.homedir(), ".claude", "settings.json"),
  ];
  for (const file of files) {
    let settings;
    try {
      settings = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const line = fields(fields(settings).statusLine);
    const command = str(line.command)?.trim();
    if (line.type === "command" && command && !isOwnLine(command)) return command;
  }
  return null;
}

/** Runs the user's status line with the same stdin; resolves with its exit code (0 with none). */
function runUserLine(text, projectDir) {
  const command = process.env[NESTED] ? null : userLine(projectDir);
  if (!command) return Promise.resolve(0);
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: fs.existsSync(projectDir) ? projectDir : undefined,
      env: { ...process.env, [NESTED]: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), USER_LINE_TIMEOUT_MS);
    child.stdout.pipe(process.stdout);
    child.stdin.on("error", () => {});
    child.stdin.end(text);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(1);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

let text = "";
try {
  text = fs.readFileSync(0, "utf8");
} catch {}
let input = null;
try {
  input = JSON.parse(text);
} catch {}
record(fields(input));
// The project's folder: `workspace.project_dir`, else `cwd`, else where this runs.
const projectDir = str(fields(fields(input).workspace).project_dir) || str(fields(input).cwd) || process.cwd();
process.exitCode = await runUserLine(text, projectDir);
