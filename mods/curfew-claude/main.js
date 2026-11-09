// curfew's Claude launcher, kept in a mod folder so it travels with the layout: `claude` (the
// launcher, started as `sh <this folder>/claude`), settings.json (what it passes with --settings),
// statusline.mjs and pr-hook.mjs (they write <app home>/curfew/usage.json and prs.jsonl, never
// this folder). See README.md. The mod itself is a card of what the launcher will use, opened
// with `herdr-app do mod.open '{"name":"curfew-claude"}'`; no layout shows it.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, appHome, home, readTextFile } from "herdr";
import * as fs from "fs/promises";

const MONO = "Menlo";
const DIR = () => `${appHome()}/mods/curfew-claude`;
const DATA = () => `${appHome()}/curfew`;
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const json = (text) => { try { return JSON.parse(text ?? "null"); } catch { return null; } };

export default class CurfewClaude extends View {
  init(_props, cx) {
    this.facts = null;
    cx.spawn(async (cx) => {
      this.facts = await this.read();
      cx.notify();
    });
  }

  async read() {
    const text = (path) => readTextFile(path).catch(() => null);
    const named = json(await text(`${DATA()}/launcher.json`))?.instructions_file;
    const instructions = typeof named === "string" && named ? (named.startsWith("~/") ? `${home()}/${named.slice(2)}` : named) : null;
    const log = await text(`${DATA()}/prs.jsonl`);
    return {
      launcher: await fs.exists(`${DIR()}/claude`).catch(() => false),
      instructions,
      found: instructions ? await fs.exists(instructions).catch(() => false) : false,
      usage: json(await text(`${DATA()}/usage.json`))?.updatedAt ?? null,
      prs: log ? log.split("\n").filter(Boolean).length : 0,
    };
  }

  render() {
    const t = theme(), f = this.facts;
    const row = (label, value, on = true) => h_flex().gap(10).items_start()
      .child(div().w(104).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_color(on ? t.foreground : t.muted).child(value));
    return v_flex().id("curfew-claude").size_full().bg(t.popover).px(14).py(12).gap(7)
      .font_family(MONO).text_size(11).text_color(t.foreground)
      .child(div().text_size(10).font_medium().text_color(t.dim).child("[ CLAUDE LAUNCHER ]"))
      .children(!f ? [div().text_color(t.dim).child("Reading…")] : [
        row("launcher", f.launcher ? `sh ${DIR()}/claude` : "missing", f.launcher),
        row("settings", `${DIR()}/settings.json`),
        row("instructions", f.instructions ? `${f.instructions}${f.found ? "" : " · missing, left out"}` : `none · instructions_file in ${DATA()}/launcher.json`, f.found),
        row("usage", f.usage ? `read at ${hhmm(f.usage)} · ${DATA()}/usage.json` : "no reading yet", Boolean(f.usage)),
        row("pull requests", `${f.prs} recorded · ${DATA()}/prs.jsonl`, f.prs > 0),
      ]);
  }
}
