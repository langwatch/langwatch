import { describe, expect, it } from "vitest";
import { emptyStateMetrics } from "../components/emptyStateMetrics";

describe("emptyStateMetrics", () => {
  describe("given the docked sidebar variant", () => {
    it("returns the fixed compact metrics regardless of width", () => {
      const narrow = emptyStateMetrics({ variant: "sidebar", width: 300 });
      const wide = emptyStateMetrics({ variant: "sidebar", width: 900 });

      expect(narrow).toEqual(wide);
      expect(narrow.markSize).toBe(34);
      expect(narrow.greetingSize).toBe(23);
    });
  });

  describe("given the floating card", () => {
    describe("when the card is at or below its narrowest width", () => {
      it("clamps to the compact metrics", () => {
        expect(emptyStateMetrics({ variant: "floating", width: 340 })).toEqual(
          emptyStateMetrics({ variant: "floating", width: 200 }),
        );
        expect(emptyStateMetrics({ variant: "floating", width: 340 }).markSize).toBe(
          36,
        );
      });
    });

    describe("when the card is at or above the roomy width", () => {
      it("keeps the full-width look unchanged from the previous design", () => {
        const roomy = emptyStateMetrics({ variant: "floating", width: 432 });

        expect(roomy.markSize).toBe(44);
        expect(roomy.greetingSize).toBe(27);
        expect(roomy.heroMarginBottom).toBe(34);
        expect(roomy.rowPaddingY).toBe(13);
        // 432 and 416 both clamp to the same roomy anchor.
        expect(roomy).toEqual(emptyStateMetrics({ variant: "floating", width: 416 }));
      });
    });

    describe("when the card is between narrow and roomy", () => {
      it("eases the hero between the two anchors", () => {
        const mid = emptyStateMetrics({ variant: "floating", width: 378 });

        expect(mid.markSize).toBeGreaterThan(36);
        expect(mid.markSize).toBeLessThan(44);
        expect(mid.greetingSize).toBeGreaterThanOrEqual(24);
        expect(mid.greetingSize).toBeLessThanOrEqual(27);
      });

      it("moves every metric monotonically as the card widens", () => {
        const narrow = emptyStateMetrics({ variant: "floating", width: 340 });
        const mid = emptyStateMetrics({ variant: "floating", width: 378 });
        const roomy = emptyStateMetrics({ variant: "floating", width: 416 });

        for (const key of Object.keys(narrow) as (keyof typeof narrow)[]) {
          expect(mid[key]).toBeGreaterThanOrEqual(narrow[key]);
          expect(roomy[key]).toBeGreaterThanOrEqual(mid[key]);
        }
      });
    });

    describe("given an unknown width (0 seed before the viewport is measured)", () => {
      it("falls back to the roomy metrics rather than the compact ones", () => {
        // The panel resolver never yields a real width below 340, but the parent
        // seeds 432 on the server; an accidental NaN must not collapse the hero.
        expect(
          emptyStateMetrics({ variant: "floating", width: Number.NaN }).markSize,
        ).toBe(44);
      });
    });
  });
});
