// The tree's file icons. Run: node --test mods/curfew-files/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { FILE_ICONS, fileIcon } from "./icons.mjs";

test("an icon by extension, whatever its case", () => {
  assert.equal(fileIcon("cart.js"), "file-code");
  assert.equal(fileIcon("Main.TSX"), "file-code");
  assert.equal(fileIcon("theme.json"), "file-json");
  assert.equal(fileIcon("notes.md"), "file-text");
  assert.equal(fileIcon("logo.svg"), "file-image");
  assert.equal(fileIcon("que.toml"), "file-cog");
  assert.equal(fileIcon("setup.sh"), "file-terminal");
});

test("whole names come first: lock files, config files, the repo's papers", () => {
  assert.equal(fileIcon("package-lock.json"), "file-lock");
  assert.equal(fileIcon("Cargo.lock"), "file-lock");
  assert.equal(fileIcon("pnpm-lock.yaml"), "file-lock");
  assert.equal(fileIcon("Dockerfile"), "file-cog");
  assert.equal(fileIcon(".gitignore"), "file-cog");
  assert.equal(fileIcon("LICENSE"), "file-text");
});

test("a test file shows the check, ahead of its extension", () => {
  assert.equal(fileIcon("cart.test.js"), "file-check");
  assert.equal(fileIcon("usage.test.mjs"), "file-check");
  assert.equal(fileIcon("api.spec.ts"), "file-check");
  assert.equal(fileIcon("store_test.go"), "file-check");
  assert.equal(fileIcon("test_models.py"), "file-check");
  assert.equal(fileIcon("latest.json"), "file-json"); // not a test
});

test("dotfiles and unknown names", () => {
  assert.equal(fileIcon(".env"), "file-cog");
  assert.equal(fileIcon(".env.local"), "file-cog");
  assert.equal(fileIcon("data.bin"), "file");
  assert.equal(fileIcon("Rakefile"), "file");
  assert.equal(fileIcon(""), "file");
});

test("every icon it can name is an SVG beside the mod", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  for (const icon of FILE_ICONS) assert.ok(fs.existsSync(`${dir}${icon}.svg`), icon);
});
