// @vitest-environment jsdom
// Spec: packages/design-system/specs/meter-bar.feature

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MeterBar } from "../src/components/values/meter-bar.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

function renderBar(fillRatio: number | null) {
  renderWithDesignSystem(
    <MeterBar
      fillRatio={fillRatio}
      width="100px"
      height="3px"
      fillColor="green.solid"
      data-testid="meter"
    />,
  );
  const track = screen.getByTestId("meter");
  return { track, fill: track.firstElementChild as HTMLElement | null };
}

describe("MeterBar", () => {
  describe("given no reading to show", () => {
    it("renders the bare track for null", () => {
      // Null is "we could not total this", which must not look like zero
      // spend rendered at zero width. It looks like an empty track either
      // way, but nothing is drawn on top of it.
      expect(renderBar(null).fill).toBeNull();
    });
  });

  describe("given a reading of zero", () => {
    it("renders no fill", () => {
      expect(renderBar(0).fill).toBeNull();
    });
  });

  describe("given a reading inside the track", () => {
    it("fills that proportion of the width", () => {
      expect(renderBar(0.5).fill?.getAttribute("data-fill-ratio")).toBe("0.5");
    });
  });

  describe("given a reading past the end of the track", () => {
    it("clamps the fill to a full track", () => {
      expect(renderBar(1.5).fill?.getAttribute("data-fill-ratio")).toBe("1");
    });
  });

  describe("given a right-aligned column", () => {
    it("keeps the track and its reading on one element each", () => {
      const { track, fill } = renderBar(0.25);

      expect(track.children).toHaveLength(1);
      expect(fill?.getAttribute("data-fill-ratio")).toBe("0.25");
    });
  });

  describe("given a meter split into two parts", () => {
    /** @scenario A two-part meter lays its parts end to end in their own colours */
    it("draws each part at its share, in order, in its own colour token", () => {
      renderWithDesignSystem(
        <MeterBar
          segments={[
            { ratio: 0.5, color: "blue.solid" },
            { ratio: 0.25, color: "blue.muted" },
          ]}
          width="100px"
          height="3px"
          data-testid="meter"
        />,
      );
      const parts = [...screen.getByTestId("meter").children];

      expect(parts.map((part) => part.getAttribute("data-fill-ratio"))).toEqual(["0.5", "0.25"]);
    });

    /** @scenario A two-part meter never runs past the end of its track */
    it("clamps the parts together to a full track and drops what does not fit", () => {
      renderWithDesignSystem(
        <MeterBar
          segments={[
            { ratio: 0.8, color: "blue.solid" },
            { ratio: 0.5, color: "blue.muted" },
            { ratio: 0.1, color: "blue.subtle" },
          ]}
          width="100px"
          height="3px"
          data-testid="meter"
        />,
      );
      const ratios = [...screen.getByTestId("meter").children].map((part) =>
        Number(part.getAttribute("data-fill-ratio")),
      );

      expect(ratios).toHaveLength(2);
      expect(ratios[0]).toBe(0.8);
      expect(ratios[1]).toBeCloseTo(0.2);
    });
  });
});
