/**
 * @vitest-environment jsdom
 *
 * Numeric-facet mode toggle — the small slider/tick-list glyph in the
 * section header that flips between the discrete value list and the
 * range slider. `SectionRenderer` only wires up this toggle when a
 * facet is `discrete`-eligible; this test pins the render + click
 * behaviour at the FacetSection level so the actual button (and its
 * aria-label) are exercised end-to-end.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Compass } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FacetSection } from "../FacetSection";
import type { FacetItem, FacetValueState } from "../types";

afterEach(() => cleanup());

const ITEMS: FacetItem[] = [
  { value: "1", label: "1", count: 4 },
  { value: "2", label: "2", count: 2 },
];

const setup = (mode: "discrete" | "range") => {
  const onToggleMode = vi.fn();
  const getValueState = (): FacetValueState => "neutral";
  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <FacetSection
        title="VERSION"
        icon={Compass}
        field="version"
        items={ITEMS}
        getValueState={getValueState}
        onToggle={vi.fn()}
        onExclude={vi.fn()}
        modeToggleProps={{ mode, onToggle: onToggleMode }}
      />
    </ChakraProvider>,
  );
  return { ...utils, onToggleMode };
};

describe("<FacetSection /> mode toggle", () => {
  describe("given the section is in discrete mode", () => {
    /** @scenario "Mode toggle shows the slider glyph when discrete is active" */
    it("renders an aria-pressed button labeled to switch to the slider", () => {
      const { getByRole } = setup("discrete");
      const btn = getByRole("button", {
        name: "Show VERSION as a range slider",
      });
      expect(btn).toHaveAttribute("aria-pressed", "true");
    });

    /** @scenario "Clicking the discrete-mode toggle requests range" */
    it("calls onToggle when clicked (consumer flips the mode)", () => {
      const { getByRole, onToggleMode } = setup("discrete");
      fireEvent.click(
        getByRole("button", { name: "Show VERSION as a range slider" }),
      );
      expect(onToggleMode).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the section is in range mode", () => {
    /** @scenario "Mode toggle shows the value-list glyph when range is active" */
    it("renders an unpressed button labeled to switch to the value list", () => {
      const { getByRole } = setup("range");
      const btn = getByRole("button", {
        name: "Show VERSION as a value list",
      });
      expect(btn).toHaveAttribute("aria-pressed", "false");
    });

    /** @scenario "Clicking the range-mode toggle requests discrete" */
    it("calls onToggle when clicked (consumer flips the mode)", () => {
      const { getByRole, onToggleMode } = setup("range");
      fireEvent.click(
        getByRole("button", { name: "Show VERSION as a value list" }),
      );
      expect(onToggleMode).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a facet without modeToggleProps (non-eligible)", () => {
    /** @scenario "Non-eligible facets render no mode toggle at all" */
    it("renders no toggle button (slider-only facets stay slider-only)", () => {
      const getValueState = (): FacetValueState => "neutral";
      const { queryByRole } = render(
        <ChakraProvider value={defaultSystem}>
          <FacetSection
            title="DURATION"
            icon={Compass}
            field="duration_ms"
            items={ITEMS}
            getValueState={getValueState}
            onToggle={vi.fn()}
            onExclude={vi.fn()}
          />
        </ChakraProvider>,
      );
      expect(
        queryByRole("button", {
          name: /Show DURATION as a (range slider|value list)/,
        }),
      ).toBeNull();
    });
  });
});
