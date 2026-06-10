/**
 * @vitest-environment jsdom
 *
 * Regression test: a range facet whose span is smaller than 1 (cost in
 * dollars, e.g. $0 – $0.004) crashed at mount because SimpleSlider fell
 * back to zag-js's default `step: 1`, tripping its min/max/step
 * invariant ("The configured `min`, `max`, `step` or
 * `minStepsBetweenThumbs` values are invalid"). The test mounts the real
 * slider so the crash path actually executes.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../stores/facetLensStore", () => ({
  useFacetLensStore: (selector: (s: unknown) => unknown) =>
    selector({
      lens: { sectionOpen: { "trace.cost": true } },
      setSectionOpen: vi.fn(),
    }),
}));

import { RangeSection } from "../RangeSection";

const renderRange = ({ min, max }: { min: number; max: number }) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <RangeSection
        title="Cost"
        field="trace.cost"
        min={min}
        max={max}
        formatValue={(v) => `$${v}`}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    </ChakraProvider>,
  );

describe("RangeSection", () => {
  afterEach(() => cleanup());

  describe("when the range span is smaller than 1 (dollar costs)", () => {
    it("mounts the slider without tripping zag-js's step invariant", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      renderRange({ min: 0, max: 0.004 });
      expect(screen.getAllByRole("slider").length).toBeGreaterThan(0);
      expect(
        errorSpy.mock.calls.flat().join("\n"),
      ).not.toMatch(/min.*max.*step.*invalid|values are invalid/i);
      errorSpy.mockRestore();
    });
  });

  describe("when the range spans whole units", () => {
    it("still mounts the slider", () => {
      renderRange({ min: 0, max: 5000 });
      expect(screen.getAllByRole("slider").length).toBeGreaterThan(0);
    });
  });
});
