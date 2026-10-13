/**
 * The global anchor rule must stay in a cascade layer: unlayered, it beats Chakra's `@layer
 * recipes` and `asChild` links lose their colour. jsdom has no layers, so the file is checked
 * directly.
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
        unlayeredSelectors(globals).filter((selector) => /(^|,)\s*a\s*(,|$)/.test(selector)),
      ).toEqual([]);
    });
  });
});
