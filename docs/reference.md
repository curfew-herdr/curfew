# Curfew reference

The details behind the [README](../README.md): what each piece is, the install step by step, the
Claude Code launcher, new worktrees, quiet hours, what Curfew runs and writes, and how to remove
it.

## What's in it

| Folder | What it is |
|---|---|
| `layouts/curfew.json`, `curfew.svg` | the window, and its picture in herdr's settings |
| `themes/curfew.json` | the dark palette: `#111111` sidebars, `#181818` work area, `#272727` hairlines, `#3fcdb4` accent |
| `mods/curfew-sidebar` | `[ SESSIONS ]` (spaces outside any repo) and `[ PROJECTS ]` (git repos, their worktree spaces under them), a status dot or the working mark per row, a project's `+` for a new worktree; the title strip's search and the foot's settings |
| `mods/curfew-tabs` | the one tab row: the shown space's tabs named by what runs in them, `+`, split beside and below |
| `mods/curfew-pane` | the 1 px accent edge on the focused pane of a split tab |
| `mods/curfew-bar` | the review pane's strip (Pull requests, Changes, Files, with counts; » folds it) and its 40 px folded rail |
| `mods/curfew-prs` | the session's pull requests: checks, review state, changed files, comments |
| `mods/curfew-changes` | the worktree's changes against its base branch, comment-only files last, a commit box |
| `mods/curfew-files` | the worktree's files, changed ones marked |
| `mods/curfew-diff` | a diff tab in the middle, one file per tab: unified or split, wrap, whitespace, comment lines dimmed, shown or folded, a pull request's review threads inline |
| `mods/curfew-usage` | Claude Code's 5-hour and weekly usage in the sidebar foot |
| `mods/curfew-new-session` | the `+` menu (Sessions and each project): a terminal or an agent as a new session, or in a new worktree |
| `mods/curfew-claude` | the Claude Code launcher (below) |
| `mods/quiet-hours` | quiet hours: the chip in the sidebar foot and the night board |

## Install, step by step

herdr's gallery installer copies only `layouts/` and `mods/`, so `themes/curfew.json` has to be
copied too; without it Curfew falls back to herdr's default theme.

1. Check the names are free; this should list nothing:

   ```sh
   H=~/.config/herdr-app
   ls -d "$H/layouts/curfew.json" "$H/themes/curfew.json" "$H"/mods/curfew-* "$H/mods/quiet-hours" 2>/dev/null
   ```

2. Copy the theme and the layout, then the mod folders through a staging folder in the app
   home, so herdr never sees a mod folder before its `mod.json` (it would dock it into the
   shown layout):

   ```sh
   cp themes/curfew.json "$H/themes/"
   cp layouts/curfew.json layouts/curfew.svg "$H/layouts/"
   mkdir "$H/.incoming" && cp -R mods/* "$H/.incoming/" \
     && mv "$H/.incoming"/* "$H/mods/" && rmdir "$H/.incoming"
   ```

3. Check every mod, then switch:

   ```sh
   for m in "$H"/mods/curfew-* "$H/mods/quiet-hours"; do herdr-app check "$m"; done
   herdr-app do layout.switch '{"name":"curfew"}'
   herdr-app status   # "errors": []
   ```

Your own layout stays as it was: `ctrl-shift-l` (or the palette) switches back.

## Claude Code sessions: the launcher

Claude Code started from the sidebar's `+` menus (Sessions, and a project's) goes through
`mods/curfew-claude/claude` when that file is there, which it is after the install. The
launcher finds your real `claude` and runs it with:

- `--settings mods/curfew-claude/settings.json`, which adds two things to the session:
  - **a status line** that records the plan usage Claude Code reports
    (`<app home>/curfew/usage.json`, read by the usage readout), then runs your own status line
    (the first `statusLine` in the project's `.claude/settings.local.json`,
    `.claude/settings.json`, then `~/.claude/settings.json`) and shows its output;
  - **a hook** after each Bash call that records the URL a `gh pr create` printed
    (`<app home>/curfew/prs.jsonl`), so the Pull requests pane knows which pull requests the
    session opened.

  Your Claude Code settings files are never written.
- `--append-system-prompt-file <file>`, when `<app home>/curfew/launcher.json` names one, so
  every session starts with your own instructions:

  ```json
  { "instructions_file": "~/path/to/instructions.md" }
  ```

  Without the file or the key, the flag is left out.

`<app home>` is herdr's home, `~/.config/herdr-app`.

**Optional: herdr's own `+` menu.** To start Claude Code from herdr's menus through the launcher
too, merge this into `~/.config/herdr-app/programs.json`, with `<app home>` written out as an
absolute path (herdr runs `run` without a shell):

```json
{ "programs": { "claude": { "run": ["sh", "<app home>/mods/curfew-claude/claude"] } } }
```

A `claude` typed by hand in a terminal runs the real one, unwrapped;
`mods/curfew-claude/README.md` has an opt-in shell function for that. Without the launcher
(delete `mods/curfew-claude`) the sidebar starts Claude Code the way herdr's menu does, the
usage readout stays at `5h — wk —`, and the Pull requests pane finds pull requests by the
worktree's branches only.

## New worktrees

A project's `+` opens the same menu as the Sessions `+`: Terminal, then "Start an agent" with
the installed agents (keys 1 to 9), and at the bottom "Named worktree…" and "Open worktree…",
which open herdr's own worktree dialog. Picking Terminal or an agent makes a worktree at once:

- a generated `adjective-adjective-noun` name, used for the branch and for the folder
  `~/.herdr/worktrees/<repo>/<name>`;
- based on `origin/<default branch>` after a fetch, else on the local default branch;
- the gitignored files listed in the repo's `.worktreeinclude` (or `worktree_include` in a
  `que.toml`) copied in, and a `que.toml`'s `setup` run in the new terminal before the agent
  starts;
- a "preparing" row under the project until the new space opens.

Once a Claude Code session in the new space names itself (from its first prompt, or
`/rename`), the row takes that name; the branch is in the row's tooltip. A space you rename
keeps your name.

Claude Code asks whether to trust each new folder. A worktree uses its main repository's answer,
so trust a project once from its main folder and its new worktrees start straight away.

## Quiet hours

The chip at the foot of the sidebar is the quiet-hours mod, the same one as
[quiet-hours](https://github.com/curfew-herdr/quiet-hours), shipped here so the layout
works out of the box. At night it shows a dim board instead of your terminals, turns herdr's
sounds off, and logs every unlock. **The schedule starts off:** click the clock at the chip's
right end to turn it on and set your hours. `Quiet 30m 1h 2h` works any time. Details:
`mods/quiet-hours/README.md`.

## What it runs

These mods run programs, reach GitHub through `gh`, and read and write files outside their
folders:

- **git, reading** in each space's folder: status, diffs against the merge base of the default
  branch, branch and upstream distance, the HEAD reflog, the worktree list (curfew-sidebar,
  -bar, -changes, -files, -diff, -prs). The quiet board runs `git rev-parse --git-common-dir`
  once in each agent's folder, for its project's name (quiet-hours).
- **git, writing**, only when you ask: the Changes commit box runs `git add -A` and
  `git commit -m <message>` when you click Commit; a project's `+` (Terminal or an agent)
  fetches from `origin` (network), adds a branch and a worktree under
  `~/.herdr/worktrees/<repo>/`, copies the gitignored files its `.worktreeinclude` (or
  `que.toml` `worktree_include`) lists, and runs the repo's `que.toml` `setup` commands in the
  new terminal. "Named worktree…" and "Open worktree…" are herdr's own dialog.
- **gh** (GitHub, over the network): `gh pr list`, `gh pr view`, `gh api
  repos/<owner>/<repo>/pulls/<n>/comments|files` for the Pull requests pane, about every 2.5
  minutes while it shows; `gh pr diff` and `gh api graphql` (review threads) for a pull
  request's diff tab. Apart from that fetch and gh, nothing reaches the network.
- **node:** curfew-bar runs `node mods/curfew-prs/check.mjs <folder>` every 2.5 minutes for its
  pull request count (git and gh as above); the launcher's status line and hook are node
  scripts; the quiet watcher is a node process.
- **sh:** curfew-tabs runs `sh -c 'basename "$SHELL"'` once (to name a shell tab `zsh`);
  curfew-files lists folders with `sh -c` (PowerShell on Windows); the launcher is `sh`.
- **Files written** under `~/.config/herdr-app`: `curfew/usage.json`, `curfew/prs.jsonl` (the
  launcher's scripts), `curfew/pr-store/*.json` (the pull requests found per worktree);
  `quiet-hours/*`, `settings.json`'s `sounds.enabled`, `layouts/quiet-hours.json` and
  `layouts/quiet-hours.svg` (quiet hours). Elsewhere: new worktrees in `~/.herdr/worktrees/`,
  and your commits. Nothing is written to a mod folder or to your Claude Code settings.
- **Files read** outside the app home: your repositories (diffs, file previews), your Claude Code
  settings files for your own status line (read only), the instructions file named in
  `curfew/launcher.json`, and `PATH`, `~/.local/bin` and `~/.claude/local` to find `claude`.
- **A background process:** the quiet watcher (`node mods/quiet-hours/quietd.mjs`), a hidden
  herdr-core terminal named `quiet-hours-watcher`, started when the chip shows. To stop it,
  switch to a layout without the chip, then `hc kill quiet-hours-watcher`.

## Requirements

- herdr (built against herdr-app 0.1.14), on macOS: the layout uses Menlo and the system UI
  font and leaves room for the window buttons. Elsewhere herdr substitutes fonts; untried.
- git; gh, signed in (`gh auth login`), for pull requests (GitHub only); node 18 or later.
- Claude Code, for the launcher and the usage readout.

## Uninstall

Switch to another layout, stop the quiet watcher (above), then delete `layouts/curfew.json`,
`layouts/curfew.svg`, `themes/curfew.json`, `mods/curfew-*`, `mods/quiet-hours`,
`layouts/quiet-hours.json`, `layouts/quiet-hours.svg`, and the data folders `curfew/` and
`quiet-hours/` from `~/.config/herdr-app`, and the `claude` entry from `programs.json` if you
added it.

## Tests

```sh
(cd mods/quiet-hours && node --test)
(cd mods/curfew-diff && node --test tests/*.test.mjs)
node --test mods/curfew-claude/*.test.mjs mods/curfew-usage/*.test.mjs mods/curfew-prs/*.test.mjs mods/curfew-sidebar/*.test.mjs
```
