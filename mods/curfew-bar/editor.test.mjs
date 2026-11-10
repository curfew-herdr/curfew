// The open-in-editor button's rules. Run: node --test mods/curfew-bar/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROBES, PROBE_SCRIPT, probeAnswers, appName, editorSetting, chooseEditor, shownPath, openArgs } from "./editor.mjs";

const CODE = "/Applications/Visual Studio Code.app", ZED = "/Applications/Zed.app";
const EDGE = "/Applications/Microsoft Edge.app", TEXTEDIT = "/System/Applications/TextEdit.app";
const answer = (apps) => PROBES.map((ext, i) => ({ ext, app: apps[i] ?? null }));
const ROOT = "/r/shop";

test("the probes are source files, not .js (a browser's), and the script asks macOS for each path", () => {
  assert.deepEqual(PROBES, ["ts", "py", "rs", "go", "c", "sh", "json", "md", "txt"]);
  assert.match(PROBE_SCRIPT, /URLForApplicationToOpenURL\(\$\.NSURL\.fileURLWithPath\(p\)\)/);
  assert.match(PROBE_SCRIPT, /function run\(argv\)/);
});

test("the script's output is one answer per probe, in order", () => {
  assert.deepEqual(probeAnswers(JSON.stringify([CODE, null, ""])).slice(0, 3), [
    { ext: "ts", app: CODE }, { ext: "py", app: null }, { ext: "rs", app: null },
  ]);
  assert.equal(probeAnswers(JSON.stringify([CODE])).length, PROBES.length);
  assert.deepEqual(probeAnswers("oops"), []);
  assert.deepEqual(probeAnswers("{}"), []);
});

test("the app that opens the most probes wins", () => {
  // This machine's answers: IDLE for .py, TextEdit for .txt, VS Code for the rest.
  const answers = answer([CODE, "/Applications/Python 3.13/IDLE.app", CODE, CODE, CODE, CODE, CODE, CODE, TEXTEDIT]);
  assert.equal(chooseEditor(answers), CODE);
  assert.equal(chooseEditor(answer([CODE, ZED, ZED, null, CODE, ZED])), ZED);
});

test("a tie goes to the app first in the probes' order, however the answers are ordered", () => {
  assert.equal(chooseEditor(answer([ZED, CODE, CODE, ZED])), ZED);
  assert.equal(chooseEditor(answer([CODE, ZED, ZED, CODE]).reverse()), CODE);
});

test("a browser, a runner or a video player is never the editor", () => {
  assert.equal(chooseEditor(answer([EDGE, EDGE, EDGE, CODE])), CODE);
  for (const app of ["/Applications/Safari.app", "/Applications/Google Chrome.app", EDGE, "/Applications/Firefox.app",
    "/Applications/Arc.app", "/Applications/Brave Browser.app", "/System/Applications/Utilities/Terminal.app",
    "/Applications/Python 3.13/Python Launcher.app", "/System/Applications/QuickTime Player.app"]) {
    assert.equal(chooseEditor(answer([app, app, app])), null, app);
  }
});

test("TextEdit only when no other app answered; nothing at all is null", () => {
  assert.equal(chooseEditor(answer([TEXTEDIT, TEXTEDIT, TEXTEDIT, ZED])), ZED);
  assert.equal(chooseEditor(answer([TEXTEDIT, EDGE, null])), TEXTEDIT);
  assert.equal(chooseEditor(answer([])), null);
  assert.equal(chooseEditor([]), null);
});

test("an app's name is its bundle's, and a name stays itself", () => {
  assert.equal(appName(CODE), "Visual Studio Code");
  assert.equal(appName(`${ZED}/`), "Zed");
  assert.equal(appName("Cursor"), "Cursor");
});

test("settings name the editor at curfew.editor, a non-empty string", () => {
  assert.equal(editorSetting({ curfew: { editor: " Zed " } }), "Zed");
  assert.equal(editorSetting({ curfew: { editor: ZED } }), ZED);
  for (const s of [undefined, null, {}, { curfew: {} }, { curfew: { editor: "" } }, { curfew: { editor: 3 } }, { "curfew.editor": "Zed" }]) {
    assert.equal(editorSetting(s), null, JSON.stringify(s));
  }
});

test("a file tab's or a worktree diff tab's key names its file inside the folder", () => {
  const file = `${ROOT}/src/cart.js`;
  assert.equal(shownPath(JSON.stringify(["file", null, file]), ROOT), file);
  assert.equal(shownPath(JSON.stringify(["changes", null, file]), `${ROOT}/`), file);
});

test("no file for a pull request's diff, another machine's, one outside the folder, or not a key", () => {
  const file = `${ROOT}/src/cart.js`;
  assert.equal(shownPath(JSON.stringify(["pr", "o/shop", 12, "src/cart.js"]), ROOT), null);
  assert.equal(shownPath(JSON.stringify(["file", "vps", file]), ROOT), null);
  assert.equal(shownPath(JSON.stringify(["file", null, "/r/shopping/a.js"]), ROOT), null, "a sibling folder");
  assert.equal(shownPath(JSON.stringify(["file", null, `${ROOT}/../etc/x`]), ROOT), null);
  assert.equal(shownPath(JSON.stringify(["file", null, ROOT]), ROOT), null, "the folder itself");
  assert.equal(shownPath(JSON.stringify(["file", null, file]), ""), null);
  for (const key of [null, undefined, "", "nope", "{}", JSON.stringify(["file", null, 3])]) assert.equal(shownPath(key, ROOT), null);
});

test("open gets the editor, the folder, then the file; without an editor, the file or the folder", () => {
  assert.deepEqual(openArgs(CODE, ROOT, `${ROOT}/a.js`), ["-a", CODE, ROOT, `${ROOT}/a.js`]);
  assert.deepEqual(openArgs("Zed", ROOT, null), ["-a", "Zed", ROOT]);
  assert.deepEqual(openArgs(null, ROOT, `${ROOT}/a.js`), [`${ROOT}/a.js`]);
  assert.deepEqual(openArgs(null, ROOT, null), [ROOT]);
});
