// The strip's open-in-editor button (main.js), its pure parts, so node tests them
// (editor.test.mjs): which app is the editor, its name, the file the shown tab shows, and what
// `open` is given. main.js runs the programs.

/** The probe files' extensions, in order (a tie goes to the earlier): source files an editor
 *  claims. Not `.js`, which is often a browser's. */
export const PROBES = ["ts", "py", "rs", "go", "c", "sh", "json", "md", "txt"];

// Never the editor: browsers, apps that run a file rather than show it, and `.ts` as video.
const IGNORED = /^(Safari|Google Chrome.*|Chromium|Microsoft Edge.*|Firefox.*|Arc|Brave Browser.*|Terminal|iTerm2?|Python Launcher.*|QuickTime Player)$/;
// The editor only when no other app answered.
const LAST = /^TextEdit$/;

/** For `osascript -l JavaScript -e PROBE_SCRIPT <path>...`: each path's default app as macOS
 *  (LaunchServices) has it, as a JSON array of app paths, null for none. */
export const PROBE_SCRIPT = `ObjC.import("AppKit");
function run(argv) {
  var w = $.NSWorkspace.sharedWorkspace;
  return JSON.stringify(argv.map(function (p) {
    var u = w.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(p));
    return u.isNil() ? null : u.path.js;
  }));
}`;

/** PROBE_SCRIPT's output for PROBES' files, in order, as {ext, app} (app null for none). */
export function probeAnswers(stdout) {
  let apps;
  try { apps = JSON.parse(stdout); } catch { return []; }
  if (!Array.isArray(apps)) return [];
  return PROBES.map((ext, i) => ({ ext, app: typeof apps[i] === "string" && apps[i] ? apps[i] : null }));
}

/** An app's name from its path (`/Applications/Visual Studio Code.app`: `Visual Studio Code`), or a name as given. */
export function appName(app) {
  return String(app ?? "").replace(/\/+$/, "").split("/").pop().replace(/\.app$/i, "");
}

/** The settings' `curfew.editor` (an app name or path), or null. */
export function editorSetting(s) {
  const v = s?.curfew?.editor;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The editor from macOS' answers ({ext, app}): the app that opens the most of them, a tie to the
 * one first in PROBES' order. Never a browser or a runner; TextEdit only when no other app
 * answered. Null when none did.
 */
export function chooseEditor(answers) {
  const at = (a) => (PROBES.includes(a.ext) ? PROBES.indexOf(a.ext) : PROBES.length);
  const apps = answers.filter((a) => typeof a?.app === "string" && a.app && !IGNORED.test(appName(a.app)))
    .sort((a, b) => at(a) - at(b)).map((a) => a.app);
  const pool = apps.some((p) => !LAST.test(appName(p))) ? apps.filter((p) => !LAST.test(appName(p))) : apps;
  const count = new Map();
  for (const p of pool) count.set(p, (count.get(p) ?? 0) + 1);
  let best = null, most = 0;
  for (const [p, n] of count) if (n > most) { best = p; most = n; } // in first-seen order: a tie keeps the earlier
  return best;
}

/**
 * The file a file tab's or a worktree diff tab's key names (filekey.mjs, difftab.js:
 * `["file" | "changes", machine, absolute path]`), when it is local and inside `folder`; else
 * null (a pull request's diff, another machine's file, a file elsewhere, not a key).
 */
export function shownPath(key, folder) {
  let k;
  try { k = JSON.parse(key); } catch { return null; }
  if (!Array.isArray(k) || (k[0] !== "file" && k[0] !== "changes") || k[1] != null || typeof k[2] !== "string") return null;
  const root = String(folder ?? "").replace(/\/+$/, ""), file = k[2];
  return root && file.startsWith(`${root}/`) && !file.split("/").includes("..") ? file : null;
}

/** `open`'s arguments: the editor with the folder, then the file to show in front; without an
 *  editor, the file (else the folder) in its default app. */
export function openArgs(app, folder, file) {
  return app ? ["-a", app, folder, ...(file ? [file] : [])] : [file || folder];
}
