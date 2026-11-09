// node check.mjs <folder>: checks the worktree a folder is in, as the panel does (adopting a check
// another copy made lately), and prints `{"root", "open", "ran"}`: the open and draft pull requests.
// The review strip runs it for its count, since a mod can't import another mod's modules. The app
// home is HERDR_APP_HOME, else the one this file is in (<app home>/mods/curfew-prs/). `--force`
// checks even when one is fresh.
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEngine } from "./engine.mjs";
import { prCounts } from "./core.mjs";

const read = (path) => fs.readFile(path, "utf8").catch(() => null);

const HOME = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The engine's host on node: the same calls herdr gives a mod, for this machine. */
export function nodeHost(home = process.env.HERDR_APP_HOME || HOME) {
  return {
    appHome: () => home,
    exec: (command, args, { cwd, timeout = 30_000 } = {}) =>
      new Promise((resolve, reject) => {
        execFile(command, args, { cwd, timeout, maxBuffer: 8 << 20, encoding: "utf8" }, (err, stdout, stderr) => {
          if (err?.killed) reject(new Error(`${command} timed out`));
          else if (err && typeof err.code !== "number") reject(err);
          else resolve({ code: err ? err.code : 0, stdout, stderr });
        });
      }),
    readTextFile: read,
    // Writes only over the text read before (null: a new file), through a rename, as herdr's does.
    writeTextFile: async (path, text, expected) => {
      if ((await read(path)) !== expected) throw new Error("stale");
      const tmp = `${path}.${process.pid}.tmp`;
      await fs.writeFile(tmp, text);
      await fs.rename(tmp, path);
      return null;
    },
    mkdir: (path) => fs.mkdir(path, { recursive: true }),
  };
}

export async function main(argv, host = nodeHost()) {
  const force = argv.includes("--force");
  const cwd = argv.find((a) => !a.startsWith("--"));
  if (!cwd) return { root: null, open: null, ran: false };
  const r = await makeEngine(host).check({ cwd, on: null }, { force });
  return { root: r.here?.root ?? null, open: r.store ? prCounts(r.store.prs).open : null, ran: r.ran, error: r.store?.error ?? null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (out) => process.stdout.write(`${JSON.stringify(out)}\n`),
    (e) => {
      process.stdout.write(`${JSON.stringify({ root: null, open: null, ran: false, error: String(e?.message ?? e) })}\n`);
      process.exitCode = 1;
    },
  );
}
