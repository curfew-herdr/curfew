# Claude launcher

How curfew starts Claude Code, the way que does: the user's instructions appended to the
system prompt, and per-session settings passed with `--settings` (a status line and a hook).
The user's own Claude Code settings are never written.

It lives in a mod folder so it travels with the layout (a gallery install copies `layouts/` and
`mods/` only). Nothing here is written at run time: what the scripts record goes to
`<app home>/curfew/`, because herdr reloads a mod when its files change. The app home is
`$HERDR_APP_HOME` when set, else the one this folder is in (`<app home>/mods/curfew-claude/`).

| File | What it does |
|---|---|
| `claude` | The launcher (sh). Start it as `sh <this folder>/claude`: it needs no +x bit (an installer may drop it). Finds the real `claude` (the first on `PATH`, then `~/.local/bin`, `~/.claude/local`, never itself or another copy of itself), exports `CURFEW_CLAUDE_DIR` (this folder), then `exec`s it with `--settings <this folder>/settings.json`, `--append-system-prompt-file <file>` when `<app home>/curfew/launcher.json` names a file that exists, and the caller's arguments. Because it `exec`s, the process is `claude` and herdr still shows it as Claude Code. |
| `settings.json` | What `--settings` passes: the status line and a `PostToolUse` hook on `Bash`. Its commands find the scripts through `$CURFEW_CLAUDE_DIR`, so no path in it names a machine. |
| `statusline.mjs` | The status line. Claude Code runs it after each reply with the session's JSON on stdin. When the JSON carries `rate_limits` with a usable window, it writes `curfew/usage.json` (atomically), then runs your own status line (the first `statusLine` command in `<project>/.claude/settings.local.json`, `<project>/.claude/settings.json`, `~/.claude/settings.json`) with the same stdin and passes its output and exit status through. |
| `pr-hook.mjs` | The hook. A Bash call that ran `gh pr create` and printed a `https://github.com/<owner>/<repo>/pull/<n>` URL appends one line per pull request to `curfew/prs.jsonl`. Always exits 0 and prints nothing, so it never blocks or fails the tool call. |
| `main.js`, `mod.json` | A card of what the launcher will use (`herdr-app do mod.open '{"name":"curfew-claude"}'`). No layout shows it. |
| `*.test.mjs` | `node --test ~/.config/herdr-app/mods/curfew-claude/*.test.mjs`: each script copied into a temp app home and run as Claude Code runs it (fake `claude`, temp `HOME`). |

What it reads and writes in `<app home>/curfew/`:

| File | What it is |
|---|---|
| `launcher.json` | `{ "instructions_file": "…" }`: the file appended to every session's system prompt. Yours to write; none, or no key, means no flag. |
| `usage.json` | Written by the status line: `{ "updatedAt": <ms>, "sessionId", "rateLimits" }`, `rateLimits` exactly as Claude Code sends it (`five_hour` / `seven_day`, each `{ used_percentage, resets_at }` in Unix seconds; either may be missing). Read by `mods/curfew-usage`. |
| `prs.jsonl` | Written by the hook: `{ "at": <ms>, "sessionId", "cwd", "url", "owner", "repo", "number" }` per line. Read by `mods/curfew-prs`; keep the field names. |

Who starts it: the curfew sidebar's worktree `+` and the Sessions `+` (`mods/curfew-new-session`)
run `["sh", "<app home>/mods/curfew-claude/claude"]` when the file is there (this computer only),
else Claude's `run` from `knownAgents()`, else `claude`. herdr's own `+` menu uses `programs.json`'s
`run`; point it here to wrap those sessions too (`run` only, so the name and icon stay):

```json
{ "programs": { "claude": { "run": ["sh", "<app home>/mods/curfew-claude/claude"] } } }
```

`<app home>` is the absolute path of herdr's home (`~/.config/herdr-app` written out in full: `run`
is not expanded by a shell).

## Change the instructions file

Edit `<app home>/curfew/launcher.json`. `~/` means the home folder. Remove the key, or point it
at a file that doesn't exist, and sessions start without the flag (no error). It takes effect
for the next session started. The launcher reads it with macOS's `plutil`, else with `node`;
where neither can read it, the flag is left out.

## Limit: a `claude` typed in a shell isn't wrapped

Only sessions herdr starts (the menus, `tab.new`/`space.new` with the launcher as `argv`) go
through the launcher. A `claude` typed by hand in a herdr terminal runs the real one: no
instructions file, no usage reading, no PR record.

Opt-in fix, not applied: a shell function, defined only inside herdr's terminals. herdr-core
sets `HC_TERMINAL_ID` (e.g. `t1z`) in every terminal it runs, so in `~/.zshrc`:

```zsh
# herdr: a hand-typed claude goes through the launcher too, in herdr's terminals only
if [[ -n "$HC_TERMINAL_ID" && -f ~/.config/herdr-app/mods/curfew-claude/claude ]]; then
  claude() { sh ~/.config/herdr-app/mods/curfew-claude/claude "$@"; }
fi
```

The launcher finds the real `claude` by file, so the function can't loop. Don't put this folder
on `PATH` instead: another wrapper that looks `claude` up again could hand it back.
