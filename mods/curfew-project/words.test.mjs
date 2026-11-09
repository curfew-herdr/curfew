// node --test ~/.config/herdr-app/mods/curfew-project/words.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { removeWords, tilde } from "./words.mjs";

const HOME = "/h";
const wt = (name, open, dirty) => ({ name, path: `${HOME}/.herdr/worktrees/shop/${name}`, open, dirty });
const props = (more = {}) => ({ project: "shop", path: `${HOME}/src/shop`, workspaces: ["s1", "s2"], worktrees: [], outside: 0, busy: false, ...more });

test("the title and body: how many workspaces close, and the repository with ~ for home", () => {
  const w = removeWords(props(), false, HOME);
  assert.equal(w.title, "Remove shop?");
  assert.equal(w.body, "Its 2 workspaces close and their terminals are killed. The repository at ~/src/shop is not touched.");
  assert.equal(removeWords(props({ workspaces: ["s1"] }), false, HOME).body, "Its 1 workspace closes and its terminals are killed. The repository at ~/src/shop is not touched.");
  assert.equal(removeWords(props({ workspaces: [] }), false, HOME).body, "It has no open workspaces. The repository at ~/src/shop is not touched.");
  assert.equal(removeWords(props({ path: "/srv/shop" }), false, HOME).body.endsWith("The repository at /srv/shop is not touched."), true);
});

test("no worktree to delete: no checkbox, and nothing it would add", () => {
  const w = removeWords(props({ outside: 2 }), true, HOME);
  assert.deepEqual([w.checkbox, w.list, w.kept, w.lost, w.outside, w.busy], [null, [], null, null, null, null]);
});

test("the checkbox names one worktree, and counts more", () => {
  assert.equal(removeWords(props({ worktrees: [wt("calm-otter", true, false)] }), false, HOME).checkbox, "Also delete its worktree calm-otter");
  assert.equal(removeWords(props({ worktrees: [wt("a", true, false), wt("b", false, false), wt("c", false, true)] }), false, HOME).checkbox, "Also delete its 3 worktrees");
});

test("unchecked (the default), the worktrees aren't listed", () => {
  const w = removeWords(props({ worktrees: [wt("a", true, true)], outside: 1 }), false, HOME);
  assert.deepEqual([w.list, w.kept, w.lost, w.outside], [[], null, null, null]);
});

test("checked: each worktree, closed when no space is open in it, dirty with uncommitted changes; branches are kept", () => {
  const w = removeWords(props({ worktrees: [wt("a", true, false), wt("b", false, false)] }), true, HOME);
  assert.deepEqual(w.list, [{ name: "a", closed: false, dirty: false }, { name: "b", closed: true, dirty: false }]);
  assert.equal(w.kept, "Branches are kept.");
  assert.equal(w.lost, null);
  assert.equal(w.outside, null);
  const dirty = removeWords(props({ worktrees: [wt("a", true, false), wt("b", false, true)] }), true, HOME);
  assert.deepEqual(dirty.list[1], { name: "b", closed: true, dirty: true });
  assert.equal(dirty.lost, "Uncommitted changes are lost.");
});

test("checked, with worktrees outside the root: they are only closed", () => {
  assert.equal(removeWords(props({ worktrees: [wt("a", true, false)], outside: 1 }), true, HOME).outside, "1 worktree outside ~/.herdr/worktrees is only closed.");
  assert.equal(removeWords(props({ worktrees: [wt("a", true, false)], outside: 3 }), true, HOME).outside, "3 worktrees outside ~/.herdr/worktrees are only closed.");
});

test("a workspace being made: the reason Remove waits", () => {
  assert.equal(removeWords(props({ busy: true }), false, HOME).busy, "A workspace is being made in it; remove it once that's done.");
});

test("no props (herdr-app check) still gives words, never a throw", () => {
  const w = removeWords(null, true, HOME);
  assert.equal(w.title, "Remove this project?");
  assert.equal(w.checkbox, null);
});

test("tilde: only a path in the home folder", () => {
  assert.equal(tilde("/h/src", "/h"), "~/src");
  assert.equal(tilde("/h", "/h"), "~");
  assert.equal(tilde("/hx/src", "/h"), "/hx/src");
  assert.equal(tilde("/h/src", ""), "/h/src");
  assert.equal(tilde(undefined, "/h"), "");
});
