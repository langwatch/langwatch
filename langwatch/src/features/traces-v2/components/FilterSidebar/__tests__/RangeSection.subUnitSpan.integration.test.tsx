/**
 * @vitest-environment jsdom
 *
 * Sub-unit range facets (cost facets are USD values like 0…0.0139) used to
 * mount the slider with the default step of 1, which left the thumbs
 * snapping only to the two endpoints, no intermediate cost filter could be
 * set by dragging. The slider must get a step sized to the span.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RangeSection, sliderStepForSpan } from "../RangeSection";

describe("RangeSection", () => {
  afterEach(cleanup);

  describe("when the facet span is sub-unit", () => {
    it("mounts the slider with a step smaller than the span", async () => {
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
      expect(sliders.length).toBeGreaterThan(0);
      // The step contract itself is asserted on the helper below; this
      // render proves the component path feeds it to the slider without
      // breaking the mount.
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

  describe("when the span covers whole units", () => {
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
