import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** Pins the responsive prop contract to source; jsdom cannot see compiled Chakra props. */
const here = dirname(fileURLToPath(import.meta.url));
const brandedCard = readFileSync(join(here, "..", "src", "components", "branded-card.tsx"), "utf8");

describe("given a branded card on a small viewport", () => {
  describe("when the card is laid out", () => {
    it("goes full bleed on a phone and stays a narrow column above it", () => {
      expect(brandedCard).toContain('maxWidth={{ base: "100%", sm: CARD_WIDTHS[size] }}');
      expect(brandedCard).toContain('narrow: "408px"');
      expect(brandedCard).toContain('borderWidth={{ base: 0, sm: "1px" }}');
      expect(brandedCard).toContain('borderRadius={{ base: 0, sm: "14px" }}');
      // A fixed pixel width is what produces a page that scrolls sideways.
      expect(brandedCard).not.toMatch(/width="\d{3,}px"/);
    });
  });
});
