// A unified diff (`git diff`, `gh pr diff`) parsed into files and hunks of numbered lines. No
// Herdr imports and no other module: curfew-changes keeps a byte-for-byte copy (mods cannot
// import across folders), so change both together.

// `a/x b/x` when both halves are one path (no rename), which survives spaces in it.
function pathOfGitLine(rest) {
  const n = (rest.length - 5) / 2;
  if (Number.isInteger(n) && n > 0 && rest.startsWith("a/") && rest.slice(n + 3, n + 5) === "b/" && rest.slice(2, 2 + n) === rest.slice(n + 5)) return rest.slice(2, 2 + n);
  const m = /^a\/(.+?) b\/(.+)$/.exec(rest);
  return m ? m[2] : rest;
}

const unquote = (p) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(.)/g, "$1") : p);
const stripSide = (p) => { const q = unquote(p.replace(/\t.*$/, "")); return q === "/dev/null" ? null : q.replace(/^[ab]\//, ""); };

/**
 * Parses `git diff` / `gh pr diff` output into files in its order: each with its status, the
 * path it came from (a rename), whether it is binary, and its hunks of numbered lines. A change
 * line remembers its positional partner in the other side's run (`pair`), for the word marks.
 */
export function parsePatch(text) {
  const files = [];
  if (!text) return files;
  const blocks = text.replace(/\r\n/g, "\n").split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const lines = block.replace(/\n$/, "").split("\n");
    const file = { path: pathOfGitLine(lines[0]), from: null, status: "modified", binary: false, hunks: [], add: 0, del: 0 };
    let i = 1, minus, plus;
    for (; i < lines.length && !lines[i].startsWith("@@"); i++) {
      const l = lines[i];
      if (l.startsWith("new file mode")) file.status = "added";
      else if (l.startsWith("deleted file mode")) file.status = "deleted";
      else if (l.startsWith("rename from ")) { file.from = l.slice(12); file.status = "renamed"; }
      else if (l.startsWith("rename to ")) file.path = l.slice(10);
      else if (l.startsWith("Binary files ") || l.startsWith("GIT binary patch")) file.binary = true;
      else if (l.startsWith("--- ")) minus = stripSide(l.slice(4));
      else if (l.startsWith("+++ ")) plus = stripSide(l.slice(4));
    }
    if (plus) file.path = plus;
    else if (minus && file.status === "deleted") file.path = minus;
    let hunk = null, old = 0, next = 0;
    for (; i < lines.length; i++) {
      const l = lines[i];
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(l);
      if (m) {
        old = +m[1]; next = +m[3];
        hunk = { oldStart: old, oldCount: m[2] === undefined ? 1 : +m[2], newStart: next, newCount: m[4] === undefined ? 1 : +m[4], fn: m[5].trim(), lines: [] };
        file.hunks.push(hunk);
        continue;
      }
      if (!hunk) continue;
      const kind = l[0], body = l.slice(1);
      if (kind === "+") { hunk.lines.push({ kind: "add", old: null, new: next++, text: body }); file.add++; }
      else if (kind === "-") { hunk.lines.push({ kind: "del", old: old++, new: null, text: body }); file.del++; }
      else if (kind === " " || l === "") hunk.lines.push({ kind: "ctx", old: old++, new: next++, text: body });
      // "\ No newline at end of file" and anything else is not a line of either side.
    }
    for (const h of file.hunks) pairRuns(h.lines);
    files.push(file);
  }
  return files;
}

// A run of removed lines then added ones: each pairs with its counterpart by position.
function pairRuns(lines) {
  for (let i = 0; i < lines.length;) {
    if (lines[i].kind === "ctx") { i++; continue; }
    const dels = [], adds = [];
    while (lines[i]?.kind === "del") dels.push(lines[i++]);
    while (lines[i]?.kind === "add") adds.push(lines[i++]);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) { dels[k].pair = adds[k].text; adds[k].pair = dels[k].text; }
  }
}

