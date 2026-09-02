/**
 * The bound on quoted-back identifier text, read as output rather than length.
 *
 * `echoIdentifier` exists so a rejection can name what to change while still
 * bounding text the caller wrote. The bound therefore has to produce a string
 * that is safe to put in `message` and `meta.violations` — and a truncation
 * that counts UTF-16 units can end on half of an astral character, emitting a
 * lone surrogate into exactly that output. These assert on well-formedness,
 * not on a character count, because the count was never the point.
 */
import { describe, expect, it } from "vitest";

import { echoIdentifier } from "../violations";

/** A high surrogate with no low surrogate after it, or the reverse. */
const UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

const MAX_ECHOED_IDENTIFIER = 80;

describe("quoting a caller-written identifier back at them", () => {
  describe("given one whose 80th code point is astral", () => {
    /** 79 filler + an emoji: the cut lands mid-character on a unit count. */
    const raw = `${"a".repeat(79)}\u{1F600}tail`;

    describe("when it is echoed", () => {
      it("does not emit half of the character it cut on", () => {
        expect(UNPAIRED_SURROGATE.test(echoIdentifier(raw))).toBe(false);
      });

      it("bounds the echo by code points, keeping the character whole", () => {
        const echoed = echoIdentifier(raw);
        // The ellipsis is the 81st code point; the emoji is kept entire.
        expect(Array.from(echoed)).toHaveLength(MAX_ECHOED_IDENTIFIER + 1);
        expect(echoed.endsWith("\u{1F600}…")).toBe(true);
      });
    });
  });

  describe("given one shorter than the bound", () => {
    describe("when it is echoed", () => {
      it("returns it whole, with no ellipsis", () => {
        expect(echoIdentifier("analytics.traces")).toBe("analytics.traces");
      });

      it("still flattens whitespace and drops unprintables", () => {
        expect(echoIdentifier("  odd​\n name  ")).toBe("odd name");
      });
    });
  });
});
