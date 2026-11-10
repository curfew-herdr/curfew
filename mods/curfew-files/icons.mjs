// Which icon a file's row shows in the tree, from its name alone, for main.js and its tests.
// No herdr or gpui imports. Each name is an SVG beside this file (Lucide's file icons).

const EXT = {
  "file-code": "js mjs cjs jsx ts mts cts tsx py rb go rs java kt swift c h cc cpp hpp cs php lua ex exs erl hs ml scala dart zig vue svelte astro html htm xml css scss sass less sql graphql proto",
  "file-json": "json jsonc json5 jsonl ndjson",
  "file-text": "md mdx markdown txt rst adoc org log csv tsv",
  "file-image": "png jpg jpeg gif webp avif svg ico bmp tiff heic",
  "file-cog": "yml yaml toml ini cfg conf env properties editorconfig plist",
  "file-lock": "lock",
  "file-terminal": "sh bash zsh fish ps1 bat cmd",
};
const BY_EXT = new Map(Object.entries(EXT).flatMap(([icon, exts]) => exts.split(" ").map((e) => [e, icon])));

// Whole names (lower case) that say more than their extension, or have none.
const BY_NAME = new Map(Object.entries({
  "file-lock": "package-lock.json yarn.lock pnpm-lock.yaml bun.lockb bun.lock cargo.lock gemfile.lock poetry.lock composer.lock go.sum",
  "file-cog": "dockerfile makefile justfile procfile .gitignore .gitattributes .gitmodules .npmrc .nvmrc .prettierrc .eslintrc .dockerignore .worktreeinclude",
  "file-text": "license licence notice readme authors changelog",
}).flatMap(([icon, names]) => names.split(" ").map((n) => [n, icon])));

/** A file's icon: its whole name first, then a test's (`x.test.js`, `x.spec.ts`, `x_test.go`),
 *  then its extension (a dotfile's name is its extension: `.env`), else the plain file. */
export function fileIcon(name) {
  const n = String(name).toLowerCase();
  if (BY_NAME.has(n)) return BY_NAME.get(n);
  if (/[._-](test|spec)\.[a-z0-9]+$/.test(n) || /^test_.+\.py$/.test(n)) return "file-check";
  if (n.startsWith(".env")) return "file-cog";
  const dot = n.lastIndexOf(".");
  return (dot >= 0 && BY_EXT.get(n.slice(dot + 1))) || "file";
}

/** Every icon fileIcon can name. */
export const FILE_ICONS = ["file", "file-check", ...Object.keys(EXT)];
