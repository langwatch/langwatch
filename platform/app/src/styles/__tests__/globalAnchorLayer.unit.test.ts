/**
 * The global anchor rule has to stay inside a cascade layer.
 *
 * Chakra emits every component style into `@layer recipes`, and an unlayered
 * author rule beats all layers. While `a { color: inherit }` sat unlayered in
 * `globals.scss`, any component rendered `asChild` over an `<a>` lost the
 * colour its own recipe set: a solid Button used as a link dropped
 * `colorPalette.contrast` and took the surrounding text colour, which is how
 * the guided onboarding pull request card ended up with black text on the
 * brand orange.
 *
 * jsdom implements no cascade layers, so the rule is checked where it lives.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const globals = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "globals.scss"),
  "utf8",
);

/** The rule blocks that are not nested inside an `@layer` block. */
function unlayeredSelectors(css: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let layerDepth: number | null = null;
  let buffer = "";
  for (const char of css) {
    if (char === "{") {
      const selector = buffer.trim().split("\n").pop()?.trim() ?? "";
      if (layerDepth === null && selector.startsWith("@layer")) {
        layerDepth = depth;
      } else if (layerDepth === null && depth === 0 && selector) {
        selectors.push(selector);
      }
      depth += 1;
      buffer = "";
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (layerDepth !== null && depth === layerDepth) layerDepth = null;
      buffer = "";
      continue;
    }
    buffer += char;
  }
  return selectors;
}

describe("globals.scss", () => {
  describe("when a component styles an anchor through its own recipe", () => {
    it("keeps the global anchor rule inside a cascade layer", () => {
      expect(globals).toMatch(/@layer\s+base\s*\{[\s\S]*?\ba\s*\{/);
    });

    it("declares no unlayered rule for bare anchors", () => {
      expect(
        unlayeredSelectors(globals).filter((selector) =>
          /(^|,)\s*a\s*(,|$)/.test(selector),
        ),
      ).toEqual([]);
    });
  });
});
