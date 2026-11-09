// que's Claude plan usage readout for the curfew layout's sidebar foot. It reads
// <app home>/curfew/usage.json, which the launcher's status line (mods/curfew-claude/statusline.mjs)
// writes after each reply: { updatedAt, sessionId, rateLimits }, rateLimits as Claude Code sends it.
//   5h 42% · 2h 10m   wk 18% · 3d 4h
// Labels faint, numbers muted, both a step brighter under the pointer; a number takes the
// attention tone at 80% and the bad tone at 100%; after each, the time until that window resets
// (only at 100% when the block is too narrow for both). A window whose reset has passed is
// dropped (que's rule): `—`, and `5h —  wk —` faint with no reading at all. A click opens que's
// usage card: each window's reset clock and a meter, and when the reading was taken.
// props.role: none (the chip), "card" (the popup). Opened with mod.open: a preview of the states.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, appHome, readTextFile, watchFolder, openOverlay, props } from "herdr";
import { WINDOWS, decodeUsage, fit, hhmm, level, percent, tooltipOf } from "./usage.mjs";

const MONO = "Menlo";
const CHAR_PX = 6.7; // Menlo at 11px, a little over its advance
const CARD = { width: 340, height: 140 };
const DIR = () => `${appHome()}/curfew`;

// que's --tone-attention is the theme's blocked; its --tone-bad has no name here, bright red is nearest.
const toneOf = (w, t) => ({ attention: t.blocked, bad: t.ansi9 })[level(w)] ?? null;

function chip({ id, u, t, now, width, hovered, onHover, onClick }) {
  const label = hovered ? t.muted : t.dim;
  const num = !u ? t.dim : hovered ? t.foreground : t.muted;
  return h_flex().id(`${id}-row`).size_full().px(5).items_center().justify_end().overflow_hidden()
    .child(h_flex().id(id).h(22).px(4).gap(10).flex_none().items_center().rounded(2)
      .font_family(MONO).text_size(11).cursor_pointer()
      .when(hovered, (el) => el.bg(t.hover))
      .tooltip(tooltipOf(u, now))
      .on_hover(onHover)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(onClick)
      .children(fit(u, now, width, CHAR_PX, 28).map((p) => // 28: row and button padding, the gap
        h_flex().flex_none().items_center()
          .child(div().text_color(label).child(p.spec.short))
          .child(div().w(CHAR_PX))
          .child(div().text_color(toneOf(p.w, t) ?? num).child(p.pct))
          .when(Boolean(p.until), (el) => el.child(div().text_color(t.dim).child(p.until))))));
}

// que's usage card: a label, a line and a 2px meter per window, a hairline, when it was read.
function card({ u, t, now }) {
  const line = (spec) => {
    const w = u?.[spec.key];
    const pct = w ? percent(w) : 0;
    return v_flex().gap(4)
      .child(h_flex().items_center()
        .child(div().w(64).flex_none().text_color(t.dim).child(spec.long))
        .child(div().flex_none().text_color(toneOf(w, t) ?? t.foreground).child(w ? `${pct}%` : "—"))
        .child(h_flex().flex_1().min_w(0).justify_end().text_color(t.dim).child(w ? spec.resets(w, now) : "")))
      .child(h_flex().pl(64)
        .child(div().flex_1().h(2).bg(t.border)
          .child(div().h_full().w(`${Math.min(pct, 100)}%`).bg(toneOf(w, t) ?? t.muted))));
  };
  return v_flex().id("usage-card").size_full().bg(t.popover).pt(12).pb(10).px(14).gap(10)
    .font_family(MONO).text_size(11).text_color(t.dim)
    .child(div().text_size(10).font_medium().child("[ CLAUDE USAGE ]"))
    .children(WINDOWS.map(line))
    .child(div().h(1).flex_none().bg(t.border))
    .child(div().child(u?.at ? `as of ${hhmm(u.at)}` : "no reading yet"));
}

export default class CurfewUsage extends View {
  init(_props, cx) {
    this.role = props()?.role ?? (props()?.overlay ? "preview" : "chip");
    this.text = null; // usage.json as last read
    this.width = 0;
    this.hovered = false;
    this.reload(cx);
    if (this.role !== "chip") return;
    // Changes as they're written; the timer moves the times on and catches a missed change.
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          await watchFolder(DIR());
        } catch {
          return; // no curfew/ folder yet: the timer still reads
        }
        await this.read();
        cx.notify();
      }
    });
    cx.timer.every(30_000, (cx) => this.reload(cx));
  }

  async read() {
    try {
      this.text = await readTextFile(`${DIR()}/usage.json`);
    } catch {
      this.text = null;
    }
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      await this.read();
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const now = Date.now();
    if (this.role === "preview") return this.preview(t, now);
    const u = this.text ? decodeUsage(this.text, now) : null;
    if (this.role === "card") return card({ u, t, now });
    return div().id("root").size_full()
      .on_size_change((size, cx) => {
        if (Math.round(size.width) !== this.width) {
          this.width = Math.round(size.width);
          cx.notify();
        }
      })
      .child(chip({
        id: "usage", u, t, now, width: this.width, hovered: this.hovered,
        onHover: (on, cx) => {
          if (on !== this.hovered) {
            this.hovered = on;
            cx.notify();
          }
        },
        onClick: (_e, cx) => {
          cx.stop_propagation();
          if (u) openOverlay({ mod: "curfew-usage", kind: "popup", ...CARD, props: { role: "card" } });
        },
      }));
  }

  // The live reading, then every state from made-up readings, at the sidebar's narrowest width
  // and at a strip's right end, and the card.
  preview(t, now) {
    const at = (h) => Math.round((now + h * 3_600_000) / 1000);
    const reading = (a, b, aAt = 2.17) => decodeUsage(JSON.stringify({ updatedAt: now - 6 * 60_000, rateLimits: {
      five_hour: { used_percentage: a, resets_at: at(aAt) }, seven_day: { used_percentage: b, resets_at: at(76) } } }), now);
    const states = [
      ["live usage.json", this.text ? decodeUsage(this.text, now) : null],
      ["no reading", null],
      ["42 / 18", reading(42.4, 18)],
      ["attention", reading(83, 61)],
      ["full", reading(100, 97)],
      ["5h reset passed", reading(99, 18, -0.1)],
    ];
    const row = (name, u, width, i) =>
      h_flex().gap(12).items_center()
        .child(div().w(130).flex_none().text_size(11).text_color(t.dim).child(`${name} · ${width}`))
        .child(div().w(width).h(28).flex_none().bg(t.chrome)
          .child(chip({ id: `p${i}-${width}`, u, t, now, width, hovered: false, onHover: () => {}, onClick: () => {} })));
    return v_flex().id("preview").size_full().bg(t.background).p(16).gap(6)
      .children(states.flatMap(([name, u], i) => [row(name, u, 256, i), row(name, u, 150, i)]))
      .child(div().w(CARD.width).h(CARD.height).mt(10).flex_none().border_1().border_color(t.input).rounded(6).overflow_hidden()
        .child(card({ u: reading(83, 18), t, now })));
  }
}
