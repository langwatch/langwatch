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
});
