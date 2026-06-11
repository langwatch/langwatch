/**
 * @vitest-environment jsdom
 *
 * Sub-unit range facets (cost facets are USD values like 0…0.0139) used to
 * mount the slider with the default step of 1, which left the thumbs
 * snapping only to the two endpoints, no intermediate cost filter could be
 * set by dragging. The slider must get a step sized to the span.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampRangeToBounds,
  RangeSection,
  sliderStepForSpan,
} from "../RangeSection";

describe("RangeSection", () => {
  afterEach(cleanup);

  describe("when the facet span is sub-unit", () => {
    it("moves the thumb by the span-sized step on a keyboard increment", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <RangeSection
            title="Cost"
            field="cost"
            min={0}
            max={0.0139}
            formatValue={(v) => `$${v.toFixed(4)}`}
            onChange={vi.fn()}
            onClear={vi.fn()}
          />
        </ChakraProvider>,
      );

      // Sections mount collapsed; the slider only mounts on expand.
      fireEvent.click(screen.getByText("Cost"));

      const sliders = await screen.findAllByRole("slider");
      const lowerThumb = sliders[0]!;
      expect(Number(lowerThumb.getAttribute("aria-valuenow"))).toBe(0);

      // One ArrowRight from the min endpoint must advance by the computed
      // step. With the default step of 1 the thumb would jump straight to
      // the max endpoint of this $0…$0.0139 range instead.
      lowerThumb.focus();
      fireEvent.keyDown(lowerThumb, { key: "ArrowRight" });

      await waitFor(() => {
        expect(Number(lowerThumb.getAttribute("aria-valuenow"))).toBeCloseTo(
          sliderStepForSpan(0.0139),
          6,
        );
      });
    });
  });
});

describe("sliderStepForSpan", () => {
  describe("when the span is sub-unit", () => {
    it("returns a fraction of the span so the slider can express in-between values", () => {
      expect(sliderStepForSpan(0.0139)).toBeLessThan(0.0139);
      expect(sliderStepForSpan(0.0139)).toBeGreaterThan(0);
    });
  });

  describe("when the span covers a few units", () => {
    it("still subdivides so narrow cost ranges stay draggable", () => {
      expect(sliderStepForSpan(5)).toBe(0.05);
    });
  });

  describe("when the span covers 100 units or more", () => {
    it("keeps the default step of 1", () => {
      expect(sliderStepForSpan(2100)).toBe(1);
      expect(sliderStepForSpan(100)).toBe(1);
    });
  });

  describe("when the span is degenerate", () => {
    it("falls back to 1 for zero, negative, and non-finite spans", () => {
      expect(sliderStepForSpan(0)).toBe(1);
      expect(sliderStepForSpan(-5)).toBe(1);
      expect(sliderStepForSpan(Number.NaN)).toBe(1);
    });
  });
});

describe("clampRangeToBounds", () => {
  // The three thumb/bounds disagreement shapes that make zag-js throw
  // synchronously at mount (verified against @zag-js/slider's normalize):
  // a stale value entirely below the new min, entirely above the new max,
  // or out of order. Clamping each thumb into [min, max] makes all of
  // them representable.
  describe("when a stale value disagrees with freshly-arrived bounds", () => {
    it("clamps a range entirely below the bounds up to min", () => {
      expect(clampRangeToBounds([0, 0.00001], 0.000032, 0.019895)).toEqual([
        0.000032, 0.000032,
      ]);
    });

    it("clamps a range entirely above the bounds down to max", () => {
      expect(clampRangeToBounds([0.5, 0.9], 0.000032, 0.019895)).toEqual([
        0.019895, 0.019895,
      ]);
    });

    it("clamps out-of-order thumbs into the bounds", () => {
      expect(clampRangeToBounds([0.9, 0.1], 0.000032, 0.019895)).toEqual([
        0.019895, 0.019895,
      ]);
    });
  });

  describe("when the value already fits the bounds", () => {
    it("passes it through unchanged", () => {
      expect(clampRangeToBounds([0.001, 0.01], 0.000032, 0.019895)).toEqual([
        0.001, 0.01,
      ]);
    });
  });

  describe("when a thumb is not a finite number", () => {
    it("falls back to min instead of poisoning the slider", () => {
      expect(clampRangeToBounds([Number.NaN, 0.01], 0, 1)).toEqual([0, 0.01]);
    });
  });
});
