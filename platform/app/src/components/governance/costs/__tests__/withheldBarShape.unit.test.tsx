/**
 * @vitest-environment node
 *
 * The shape a cost bar is drawn in when its period is short.
 *
 * Called directly with the geometry recharts would hand it, rather than through
 * a chart: the case that matters most is a bar of height zero, and that is the
 * one case a chart under a layout-less renderer cannot be made to produce on
 * purpose. What comes back is a React element, read without a DOM.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  WITHHELD_BAR_LABEL,
  WITHHELD_EMPTY_BAR_LABEL,
  type WithheldMarks,
  withheldBarShape,
} from "../CostCharts";

const PERIOD = "2026-01-01";

/** The geometry recharts hands a bar that has nothing to draw. */
const ZERO_HEIGHT = {
  x: 40,
  y: 200,
  width: 24,
  height: 0,
  fill: "#3b82f6",
  payload: { day: PERIOD },
};

const marks = (over: Partial<WithheldMarks> = {}): WithheldMarks => ({
  withheldDays: new Set([PERIOD]),
  emptyDays: new Set([PERIOD]),
  drawsEmptyMark: true,
  ...over,
});

const propsOf = (element: ReactElement | null) =>
  (element?.props ?? {}) as Record<string, unknown>;

describe("the shape of a bar whose period is short", () => {
  describe("when the period has no figure at all", () => {
    /** @scenario "A period whose every day is withheld still shows a withheld mark" */
    it("draws a dashed stand-in where the bar would be, labelled withheld", () => {
      const drawn = withheldBarShape(ZERO_HEIGHT, marks());

      // Something, where recharts alone would draw nothing for a height of
      // zero. It says what it is to a screen reader and to a test alike.
      expect(drawn).not.toBeNull();
      expect(propsOf(drawn)).toMatchObject({
        "data-withheld": "empty",
        "aria-label": WITHHELD_EMPTY_BAR_LABEL,
      });
      // The cue is a dash, not a colour: it has to survive greyscale.
      const rect = (propsOf(drawn).children as ReactElement[]).find(
        (child) => child.type === "rect",
      );
      expect(rect).toBeDefined();
      expect(propsOf(rect!)).toMatchObject({
        x: 40,
        width: 24,
        fill: "none",
        strokeDasharray: expect.stringMatching(/\d/),
      });
      // Up from the baseline, with a height a reader can see.
      expect(Number(propsOf(rect!).height)).toBeGreaterThan(0);
      expect(Number(propsOf(rect!).y)).toBeLessThan(ZERO_HEIGHT.y);
    });

    it("lets only one series of a stack draw the stand-in", () => {
      // Every series in a stack is handed the same zero-height rectangle. One
      // mark to the eye and one to a screen reader, not one per series.
      expect(
        withheldBarShape(ZERO_HEIGHT, marks({ drawsEmptyMark: false })),
      ).toBeNull();
    });
  });

  describe("when the period holds some figure", () => {
    it("keeps the bar, faded and dash-edged, and says why", () => {
      const drawn = withheldBarShape(
        { ...ZERO_HEIGHT, height: 80, y: 120 },
        marks({ emptyDays: new Set() }),
      );

      expect(propsOf(drawn)).toMatchObject({
        "data-withheld": "short",
        "aria-label": WITHHELD_BAR_LABEL,
      });
      // The bar inside is recharts' own rectangle, so it still answers to
      // the click that opens a period — restyled, not replaced.
      const bar = (propsOf(drawn).children as ReactElement[]).find(
        (child) => typeof child.type !== "string",
      );
      expect(propsOf(bar!)).toMatchObject({
        height: 80,
        strokeDasharray: expect.stringMatching(/\d/),
      });
      expect(Number(propsOf(bar!).fillOpacity)).toBeLessThan(1);
    });
  });

  describe("when the period is whole", () => {
    it("draws the bar exactly as recharts would", () => {
      const drawn = withheldBarShape(
        { ...ZERO_HEIGHT, height: 80, payload: { day: "2026-04-01" } },
        marks(),
      );

      expect(propsOf(drawn)["data-withheld"]).toBeUndefined();
      expect(propsOf(drawn)).toMatchObject({ height: 80, fill: "#3b82f6" });
      expect(propsOf(drawn).strokeDasharray).toBeUndefined();
    });
  });
});
