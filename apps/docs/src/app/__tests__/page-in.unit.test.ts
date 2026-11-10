import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../docs.css", import.meta.url), "utf8");

/** The text of the block that opens at `start`, braces balanced. */
function block({ start }: { start: number }) {
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index++) {
    if (css[index] === "{") depth++;
    else if (css[index] === "}" && --depth === 0) return css.slice(start, index + 1);
  }
  return "";
}

describe("the opening fade of a page", () => {
  /** @scenario "Fade a page's opening blocks in without holding them back" */
  it("staggers the header and first blocks within 400ms, only without a reduced-motion request", () => {
    const motion = block({ start: css.indexOf("#content :is(.docs-page-header") });
    const scope = css.lastIndexOf("@media", css.indexOf("#content :is(.docs-page-header"));
    expect(css.slice(scope, scope + 50)).toContain("(prefers-reduced-motion: no-preference)");
    const duration = Number(/docs-page-in (\d+)ms/.exec(motion)?.[1]);
    const media = block({ start: scope });
    const delays = [...media.matchAll(/animation-delay: (\d+)ms/g)].map((match) =>
      Number(match[1]),
    );
    expect(duration + Math.max(...delays)).toBeLessThanOrEqual(400);
  });

  /** @scenario "Fade a page's opening blocks in without holding them back" */
  it("moves only opacity and transform and starts visible enough to be painted", () => {
    const frames = block({ start: css.indexOf("@keyframes docs-page-in") });
    const properties = [...frames.matchAll(/([a-z-]+):/g)].map((match) => match[1]);
    expect(new Set(properties)).toEqual(new Set(["opacity", "transform"]));
    expect(Number(/opacity: ([\d.]+)/.exec(frames)?.[1])).toBeGreaterThan(0);
    expect(css).not.toContain("#content[data-docs-entering]");
  });

  /** @scenario "Fade a page's opening blocks in without holding them back" */
  it("plays only on a page swapped in place, never on a full load", () => {
    const start = css.lastIndexOf("@media", css.indexOf("#content :is(.docs-page-header"));
    const selectors = [...block({ start }).matchAll(/^\s+([^{}\n]+)\{/gm)].map((match) =>
      (match[1] ?? "").trim(),
    );
    expect(selectors.length).toBeGreaterThan(1);
    for (const selector of selectors) expect(selector).toMatch(/^:root\[data-docs-navigated\] /);
  });
});

describe("a followed link's page", () => {
  /** @scenario "Answer a followed link at once while the next page loads" */
  it("dims the current page after a beat, so a prefetched swap never shows it", () => {
    const dim = block({ start: css.indexOf(".docs-layout[data-docs-loading] #content") });
    expect(Number(/opacity: ([\d.]+)/.exec(dim)?.[1])).toBeLessThan(1);
    expect(Number(/transition: opacity \d+ms \S+ (\d+)ms/.exec(dim)?.[1])).toBeGreaterThan(0);
  });

  /** @scenario "Answer a followed link at once while the next page loads" */
  it("keeps the beat but drops the fade for a reduced-motion request", () => {
    const at = css.indexOf(
      "@media (prefers-reduced-motion: reduce) {\n  .docs-layout[data-docs-loading]",
    );
    expect(at).toBeGreaterThan(-1);
    expect(block({ start: at })).toMatch(/transition: opacity 0s \S+ [1-9]\d*ms/);
  });
});
