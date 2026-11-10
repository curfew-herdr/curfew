// The tree's file icons. Run: node --test mods/curfew-files/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { FILE_ICONS, SETI, fileIcon } from "./icons.mjs";

const is = (name, icon, color) => assert.deepEqual({ ...fileIcon(name) }, { icon, color: SETI[color] }, name);

test("an icon and its Seti color by extension, whatever its case", () => {
  is("cart.js", "javascript", "yellow");
  is("usage.mjs", "javascript", "yellow");
  is("api.ts", "typescript", "blue");
  is("Main.TSX", "react", "blue");
  is("theme.json", "json", "yellow");
  is("notes.md", "markdown", "blue");
  is("index.html", "html", "orange");
  is("app.css", "css", "blue");
  is("app.scss", "sass", "pink");
  is("models.py", "python", "blue");
  is("main.go", "go2", "blue");
  is("lib.rs", "rust", "grey-light");
  is("setup.sh", "shell", "green");
  is("ci.yml", "yml", "purple");
  is("que.toml", "config", "grey-light");
  is("logo.png", "image", "purple");
  is("logo.svg", "svg", "purple");
  is("schema.sql", "db", "pink");
  is("server.key", "lock", "green");
});

test("whole names come first: package.json, lock files, the repo's papers", () => {
  is("package.json", "npm", "red");
  is("tsconfig.json", "tsconfig", "blue");
  is("package-lock.json", "lock", "grey-light");
  is("pnpm-lock.yaml", "lock", "grey-light");
  is("Cargo.lock", "lock", "grey-light");
  is("yarn.lock", "yarn", "blue");
  is("Dockerfile", "docker", "blue");
  is("docker-compose.yml", "docker", "pink");
  is("Makefile", "makefile", "orange");
  is("LICENSE", "license", "yellow");
  is("README.md", "info", "blue");
  is("CHANGELOG.md", "clock", "blue");
  is("eslint.config.mjs", "eslint", "purple");
});

test("compound extensions before the last one: tests, type declarations, dotfiles", () => {
  is("cart.test.js", "javascript", "orange");
  is("usage.test.mjs", "javascript", "orange");
  is("api.spec.ts", "typescript", "orange");
  is("Button.test.tsx", "react", "orange");
  is("index.d.ts", "typescript", "blue");
  is("app.css.map", "css", "blue");
  is(".eslintrc.json", "eslint", "purple");
  is("main.tf.json", "terraform", "purple");
  is("latest.json", "json", "yellow"); // not a test
  is("contest.js", "javascript", "yellow");
});

test("dotfiles are their own extension, and the dim ones are lifted", () => {
  is(".gitignore", "git", "ignore");
  is(".npmrc", "npm", "red");
  is(".editorconfig", "config", "grey-light");
  is(".env", "config", "grey-light");
  is(".env.local", "config", "grey-light");
  is(".DS_Store", "ignored", "ignore");
  is(".dockerignore", "docker", "grey");
  assert.equal(SETI.ignore, SETI["grey-light"]);
  assert.equal(SETI.grey, SETI["grey-light"]);
});

test("anything else is Seti's default icon", () => {
  is("notes.txt", "default", "white");
  is("data.bin", "default", "white");
  is("NOTICE", "default", "white");
  is("archive.", "default", "white");
  is("", "default", "white");
});

test("every color is a hex color from the palette", () => {
  for (const color of Object.values(SETI)) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("every icon it can name is a Seti SVG beside the mod", () => {
  const dir = fileURLToPath(new URL("./seti/", import.meta.url));
  for (const icon of FILE_ICONS) {
    const file = `${dir}${icon}.svg`;
    assert.ok(fs.existsSync(file), icon);
    assert.match(fs.readFileSync(file, "utf8"), /^<svg[^>]*>[\s\S]*<\/svg>\s*$/, icon);
  }
  const svgs = fs.readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4));
  assert.deepEqual(svgs.sort(), [...FILE_ICONS].sort(), "no SVG the tree never shows");
  assert.ok(fs.existsSync(`${dir}LICENSE`), "Seti's licence travels with its icons");
});
