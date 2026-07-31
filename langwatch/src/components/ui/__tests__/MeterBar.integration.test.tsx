/**
 * @vitest-environment jsdom
 *
 * `MeterBar` backs both the trace table's latency columns and the
 * virtual-keys budget bar, so a regression in the clamp or in the
 * no-reading check is a regression in two features at once. The fill is
 * asserted as a width percentage, which is the one thing a reader takes
 * from the bar at a glance.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";

import { MeterBar } from "../MeterBar";

afterEach(() => cleanup());

function renderBar(fillRatio: number | null) {
  render(
    <ChakraProvider value={defaultSystem}>
      <MeterBar
        fillRatio={fillRatio}
        width="100px"
        height="3px"
        fillColor="green.solid"
        data-testid="meter"
      />
    </ChakraProvider>,
  );
  const track = screen.getByTestId("meter");
  return { track, fill: track.firstElementChild as HTMLElement | null };
}

describe("<MeterBar />", () => {
  describe("given no reading to show", () => {
    it("renders the bare track for null", () => {
      // Null is "we could not total this", which must not look like zero
      // spend rendered at zero width — it looks like an empty track either
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
      expect(renderBar(0.5).fill).toHaveStyle({ width: "50%" });
    });
  });

  describe("given a reading past the end of the track", () => {
    it("clamps the fill to a full track", () => {
      expect(renderBar(1.5).fill).toHaveStyle({ width: "100%" });
    });
  });
});
