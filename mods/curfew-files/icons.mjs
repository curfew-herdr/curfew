// Which icon a file's row shows in the tree, and its tint, from its name alone, for main.js and its
// tests. No herdr or gpui imports. The icons are Seti's (jesseweed/seti-ui, VS Code's default file
// icon theme), each at seti/<icon>.svg beside this file, and so are the rules: Seti's
// styles/components/icons/mapping.less read the way VS Code's theme-seti reads it, where a pattern
// with a leading dot is an extension (".spec.js" too) and any other is a whole file name, both
// without case. A subset: the common languages and files, else the default icon.

/** Seti's palette (styles/ui-variables.less). Seti's `grey` (#4d5a5e) and `ignore` (#41535b) all but
 *  vanish on this app's near-black panels (#111111, #181818), so both are lifted to `grey-light`. */
export const SETI = Object.freeze({
  blue: "#519aba", green: "#8dc149", orange: "#e37933", pink: "#f55385", purple: "#a074c4",
  red: "#cc3e44", yellow: "#cbcb41", white: "#d4d7d6", "grey-light": "#6d8086",
  grey: "#6d8086", ignore: "#6d8086",
});

// [icon, Seti color, patterns]. Extensions, matched longest first: `cart.test.js` is a test before
// it is JavaScript, `.eslintrc.json` is ESLint's before it is JSON, a dotfile's name is its own.
const EXT = [
  ["javascript", "yellow", "js mjs cjs es es5 es6 es7 js.map mjs.map cjs.map"],
  ["typescript", "blue", "ts mts cts d.ts"],
  ["react", "blue", "jsx tsx cjsx"],
  // A test keeps its language's icon, in Seti's test orange (Seti lists .test/.spec of js, cjs,
  // mjs, ts, jsx, tsx; mts and cts follow suit).
  ["javascript", "orange", "test.js spec.js test.mjs spec.mjs test.cjs spec.cjs"],
  ["typescript", "orange", "test.ts spec.ts test.mts spec.mts test.cts spec.cts"],
  ["react", "orange", "test.jsx spec.jsx test.tsx spec.tsx"],
  ["json", "yellow", "json jsonc jsonl cson"],
  ["markdown", "blue", "md markdown"],
  ["html", "orange", "html htm xhtml"],
  ["css", "blue", "css css.map sss"],
  ["sass", "pink", "sass scss"],
  ["less", "blue", "less"],
  ["python", "blue", "py pyi pyw"],
  ["ruby", "red", "rb rake gemspec"],
  ["go2", "blue", "go"],
  ["rust", "grey-light", "rs"],
  ["java", "red", "java"],
  ["java", "blue", "class"],
  ["kotlin", "orange", "kt kts"],
  ["swift", "orange", "swift"],
  ["c", "blue", "c"],
  ["c", "purple", "h"],
  ["c", "yellow", "m"],
  ["cpp", "blue", "cc cpp cxx c++"],
  ["cpp", "purple", "hh hpp hxx h++"],
  ["cpp", "yellow", "mm"],
  ["c-sharp", "blue", "cs"],
  ["php", "purple", "php"],
  ["lua", "blue", "lua"],
  ["elixir", "purple", "ex"],
  ["elixir_script", "purple", "exs"],
  ["haskell", "purple", "hs lhs"],
  ["scala", "red", "scala"],
  ["dart", "blue", "dart"],
  ["zig", "orange", "zig"],
  ["vue", "green", "vue"],
  ["svelte", "red", "svelte"],
  ["terraform", "purple", "tf tf.json tfvars tfvars.json"],
  ["shell", "green", "sh bash zsh fish ksh bashrc zshrc zshenv zprofile bash_profile"],
  ["powershell", "blue", "ps1 psd1 psm1"],
  ["windows", "blue", "bat cmd"],
  ["yml", "purple", "yml yaml"],
  ["config", "grey-light", "config cfg conf ini toml properties env editorconfig htaccess direnv"],
  ["git", "ignore", "gitignore gitconfig gitkeep gitattributes gitmodules"],
  ["npm", "red", "npmrc npmignore"],
  ["docker", "blue", "dockerfile"],
  ["docker", "grey", "dockerignore"],
  ["eslint", "purple", "eslintrc eslintrc.js eslintrc.cjs eslintrc.json eslintrc.yml eslintrc.yaml"],
  ["eslint", "grey", "eslintignore"],
  ["lock", "grey-light", "lock lockb"],
  ["lock", "green", "key pem crt cer cert"],
  ["xml", "orange", "xml plist xsd xsl"],
  ["db", "pink", "sql"],
  ["graphql", "pink", "graphql gql graphqls"],
  ["image", "purple", "png jpg jpeg gif webp avif tiff svgx pxm"],
  ["svg", "purple", "svg"],
  ["favicon", "yellow", "ico"],
  ["csv", "green", "csv"],
  ["pdf", "red", "pdf"],
  ["zip", "grey-light", "zip"],
  ["zip", "red", "jar"],
  ["font", "red", "ttf otf woff woff2 eot"],
  ["video", "pink", "mp4 mov webm avi mpg ogv"],
  ["audio", "purple", "mp3 wav ogg flac"],
  ["clock", "grey-light", "tmp"],
  ["ignored", "ignore", "ds_store"],
];

// Whole names (lower case), ahead of any extension.
const NAMES = [
  ["npm", "red", "package.json"],
  ["lock", "grey-light", "package-lock.json npm-shrinkwrap.json pnpm-lock.yaml bun.lock bun.lockb cargo.lock gemfile.lock poetry.lock composer.lock uv.lock flake.lock go.sum"],
  ["yarn", "blue", "yarn.lock"],
  ["tsconfig", "blue", "tsconfig.json"],
  ["vite", "yellow", "vite.config.js vite.config.mjs vite.config.cjs vite.config.ts vite.config.mts vite.config.cts"],
  ["eslint", "purple", "eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts"],
  ["docker", "blue", "dockerfile"],
  ["docker", "pink", "docker-compose.yml docker-compose.yaml docker-compose.override.yml docker-compose.override.yaml"],
  ["makefile", "orange", "makefile"],
  ["makefile", "blue", "cmakelists.txt"],
  ["license", "yellow", "license licence license.txt licence.txt license.md licence.md copying copying.txt copying.md"],
  ["license", "red", "contributing contributing.txt contributing.md"],
  ["info", "blue", "readme readme.md readme.txt"],
  ["clock", "blue", "changelog changelog.md changelog.txt changes changes.md changes.txt version version.md version.txt"],
  ["todo", "blue", "todo todo.md todo.txt"],
  ["ruby", "red", "gemfile rakefile"],
  ["git", "ignore", "commit_editmsg merge_msg"],
];

const table = (rows) => new Map(rows.flatMap(([icon, color, patterns]) => {
  const hit = Object.freeze({ icon, color: SETI[color] });
  return patterns.split(" ").map((p) => [p, hit]);
}));
const BY_EXT = table(EXT), BY_NAME = table(NAMES);
const DEFAULT = Object.freeze({ icon: "default", color: SETI.white });

/** A file's `{ icon, color }`: its whole name first, then its extensions longest first
 *  (`x.test.js`, then `.js`), else Seti's default icon. A `.env.*` file is `.env`'s. */
export function fileIcon(name) {
  const n = String(name).toLowerCase();
  const named = BY_NAME.get(n) ?? (n.startsWith(".env.") ? BY_EXT.get("env") : undefined);
  if (named) return named;
  for (let dot = n.indexOf("."); dot >= 0; dot = n.indexOf(".", dot + 1)) {
    const hit = BY_EXT.get(n.slice(dot + 1));
    if (hit) return hit;
  }
  return DEFAULT;
}

/** Every icon fileIcon can name: seti/<icon>.svg. */
export const FILE_ICONS = [...new Set([DEFAULT.icon, ...[...EXT, ...NAMES].map(([icon]) => icon)])];
