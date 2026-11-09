// base.js against a real repository in a temp folder: que's base and the file set Changes lists,
// which the strip's count and the Files marks use too. And the helpers several mods carry stay
// byte-identical copies (a mod can't import another mod's files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { READ, diffFrom, changedFiles, readStatus } from "../base.js";

const MODS = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "curfew-base-")));
  const sh = (...args) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/cart.js"), "export const a = 1;\n");
  writeFileSync(join(root, "src/format.js"), "// money\nexport const b = 2;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "base");
  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(root, "src/discounts.js"), "export const c = 3;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "feature");
  return { root, sh };
}

const gitAt = (root) => (args) => new Promise((resolve) => execFile("git", [...READ, ...args], { cwd: root }, (e, stdout, stderr) => resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr })));

test("the base is the merge base with the default branch, and the files run from it to the working tree", async () => {
  const { root, sh } = repo();
  try {
    const git = gitAt(root);
    const mainHead = sh("rev-parse", "main").toString().trim();
    assert.equal(await diffFrom(git), mainHead, "merge-base of main and HEAD");
    // The committed file, two uncommitted edits (one a comment only), an untracked file.
    writeFileSync(join(root, "src/cart.js"), "export const a = 2;\n");
    writeFileSync(join(root, "src/format.js"), "export const b = 2;\n");
    writeFileSync(join(root, "src/cart.test.js"), "test();\n");
    const { files, total } = await changedFiles(git);
    assert.deepEqual(Object.fromEntries(files), { "src/cart.js": "M", "src/discounts.js": "A", "src/format.js": "M", "src/cart.test.js": "?" });
    assert.equal(total, 4, "HEAD alone would say 3: the branch's commit counts");
    // A deleted file is listed as deleted.
    rmSync(join(root, "src/format.js"));
    assert.equal((await changedFiles(git)).files.get("src/format.js"), "D");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("without a default branch to compare with, HEAD is the base; without HEAD, the index", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "curfew-base-")));
  try {
    execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: root });
    const git = gitAt(root);
    assert.equal(await diffFrom(git), null);
    writeFileSync(join(root, "new.txt"), "x\n");
    assert.deepEqual(Object.fromEntries((await changedFiles(git)).files), { "new.txt": "?" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readStatus sorts untracked, conflicted and uncommitted paths", () => {
  const s = readStatus(["?? a b.js", " M c.js", "UU d.js", "AA e.js", "A  f.js", ""].join("\0"));
  assert.deepEqual(s.fresh, ["a b.js"]);
  assert.deepEqual([...s.conflicts], ["d.js", "e.js"]);
  assert.deepEqual([...s.dirty], ["c.js", "d.js", "e.js", "f.js"]);
});

test("the shared helpers are byte-identical in every mod that carries them", () => {
  const same = (file, mods) => {
    const texts = mods.map((m) => readFileSync(join(MODS, m, file), "utf8"));
    for (let i = 1; i < texts.length; i++) assert.equal(texts[i], texts[0], `${mods[i]}/${file} differs from ${mods[0]}/${file}`);
  };
  same("base.js", ["curfew-diff", "curfew-changes", "curfew-bar", "curfew-files"]);
  same("difftab.js", ["curfew-changes", "curfew-files", "curfew-prs"]);
  same("patch.js", ["curfew-diff", "curfew-changes"]);
  same("comments.js", ["curfew-diff", "curfew-changes"]);
});
