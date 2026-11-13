import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../docs.css", import.meta.url), "utf8");

/** A declaration's pixel value inside the first rule for `selector` after `from`. */
function pixels({
  from,
  selector,
  property,
}: {
  from: number;
  selector: string;
  property: string;
}) {
  const start = css.indexOf(`${selector} {`, from);
  const rule = css.slice(start, css.indexOf("}", start));
  return Number(new RegExp(`${property}:\\s*(-?\\d+)px`).exec(rule)?.[1]);
}

describe("a heading's link icon after its last word", () => {
  const touch = css.indexOf(".docs-heading:has(> .docs-anchor) {");
  const anchor = css.indexOf(".docs-anchor {");
  const padding = Number(
    /padding:\s*(\d+)px/.exec(css.slice(anchor, css.indexOf("}", anchor)))?.[1],
  );

  /** @scenario "Reserve a heading's link icon room after its last word" */
  it("reserves room the icon's margins exactly cancel", () => {
    expect(touch).toBeGreaterThan(-1);
    const reserved = pixels({
      from: touch,
      selector: ".docs-heading:has(> .docs-anchor)",
      property: "padding-inline-end",
    });
    const start = pixels({
      from: touch,
      selector: ".docs-anchor",
      property: "margin-inline-start",
    });
    const end = pixels({ from: touch, selector: ".docs-anchor", property: "margin-inline-end" });
    /* The icon is 16px drawn inside its own padding on each side. */
    const icon = 16 + 2 * padding;
    expect(reserved).toBeGreaterThan(0);
    expect(start + icon + end).toBe(0);
    expect(-end).toBe(reserved);
  });

  /** @scenario "Reserve a heading's link icon room after its last word" */
  it("keeps the icon in the text flow, shown on hover and always on touch", () => {
    const rule = css.slice(anchor, css.indexOf("}", anchor));
    expect(rule).not.toMatch(/position:\s*absolute|inset-inline-start/);
    expect(rule).toMatch(/opacity:\s*0;/);
    const touchOnly = css.indexOf("@media (hover: none) {\n  .docs-anchor {");
    expect(css.slice(touchOnly, css.indexOf("}", touchOnly))).toMatch(/opacity:\s*1;/);
  });
});
