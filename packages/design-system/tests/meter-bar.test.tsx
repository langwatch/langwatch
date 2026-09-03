// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MeterBar } from "../src/components/meter-bar";
import { renderWithDesignSystem } from "../src/testing";

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
});
