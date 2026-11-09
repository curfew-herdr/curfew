// The PostToolUse hook the launcher gives each session (settings.json, matcher Bash), a port of
// que's pr-created.ts: a Bash call that ran `gh pr create` and printed a github.com pull request
// URL appends one line per pull request to <app home>/curfew/prs.jsonl:
//   { "at": <ms>, "sessionId", "cwd", "url", "owner", "repo", "number" }
// Another mod reads that file, so keep these names. It never blocks or fails the tool call:
// it always exits 0 and prints nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// <app home>/curfew/: the app home is $HERDR_APP_HOME, else the one this file is in
// (<app home>/mods/curfew-claude/). Not this folder: herdr reloads a mod whose files change.
const DATA = path.join(process.env.HERDR_APP_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), "curfew");
const FILE = path.join(DATA, "prs.jsonl");

/** `gh pr create` as a command of its own: at the start, after a separator, or by path. */
const PR_CREATE = /(?:^|[\s;&|(/])gh\s+pr\s+create\b/;

const PR_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/g;

const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : undefined);

/** Every string in a value, however deeply nested: the response is a string or `{ stdout, stderr }`. */
function stringsIn(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const item of v) stringsIn(item, out);
  else if (isObj(v)) for (const item of Object.values(v)) stringsIn(item, out);
  return out;
}

/** The pull requests a `gh pr create` call printed, in order, each once; none for any other event. */
function createdPullRequests(event) {
  if (!isObj(event) || event.hook_event_name !== "PostToolUse" || event.tool_name !== "Bash") return [];
  const command = str(isObj(event.tool_input) ? event.tool_input.command : undefined);
  if (command === undefined || !PR_CREATE.test(command)) return [];
  const seen = new Map();
  for (const text of stringsIn(event.tool_response)) {
    for (const [url, owner, repo, number] of text.matchAll(PR_URL)) {
      if (!seen.has(url)) seen.set(url, { url, owner, repo, number: Number(number) });
    }
  }
  return [...seen.values()];
}

try {
  const event = JSON.parse(fs.readFileSync(0, "utf8"));
  const lines = createdPullRequests(event).map((pr) =>
    JSON.stringify({ at: Date.now(), sessionId: str(event.session_id) ?? null, cwd: str(event.cwd) ?? null, ...pr })
  );
  if (lines.length) {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(FILE, lines.map((l) => `${l}\n`).join(""));
  }
} catch {
  // Garbage in, an unwritable file: the tool call goes on regardless.
}
process.exitCode = 0;
