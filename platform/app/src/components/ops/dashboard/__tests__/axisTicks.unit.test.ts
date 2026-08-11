import { describe, expect, it } from "vitest";
import {
  AXIS_INTERVALS,
  alignedMax,
  axisTicks,
  axisWidthFor,
  niceMax,
} from "../axisTicks";

const formatAxisValue = (v: number): string => {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v === 0) return "0";
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
};

describe("axisTicks", () => {
  describe("given a rate axis and a count axis with unrelated ranges", () => {
    describe("when both are ticked", () => {
      it("divides both into the same number of intervals", () => {
        const rates = axisTicks(2_000);
        const counts = axisTicks(129_091);

        expect(rates).toHaveLength(AXIS_INTERVALS + 1);
        expect(counts).toHaveLength(AXIS_INTERVALS + 1);
      });

      it("places every gridline at the same fraction of the plot height", () => {
        // Shared gridlines are the whole point: tick i sits at i/N of the
        // height on BOTH axes, so the two scales never visually contradict.
        const rates = axisTicks(2_000);
        const counts = axisTicks(129_091);

        const fractionsOf = (ticks: number[]) =>
          ticks.map((t) => t / ticks[ticks.length - 1]!);

        expect(fractionsOf(rates)).toEqual(fractionsOf(counts));
      });
    });
  });

  describe("given any range", () => {
    it("starts at zero and ends at the axis maximum", () => {
      const ticks = axisTicks(437);

      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(alignedMax(437));
    });

    it("produces round ticks rather than repeating decimals", () => {
      for (const max of [1, 7, 99, 437, 2_000, 129_091]) {
        for (const tick of axisTicks(max)) {
          expect(Number.isInteger(tick)).toBe(true);
        }
      }
    });

    it("never places a tick below the data", () => {
      for (const max of [1, 7, 99, 437, 2_000, 129_091]) {
        expect(alignedMax(max)).toBeGreaterThanOrEqual(max);
      }
    });
  });

  describe("given an empty or degenerate range", () => {
    it("still produces a usable axis", () => {
      expect(niceMax(0)).toBe(1);
      expect(niceMax(-5)).toBe(1);
      expect(axisTicks(0)).toHaveLength(AXIS_INTERVALS + 1);
    });
  });
});

describe("axisWidthFor", () => {
  describe("given an axis whose values run into the hundreds of thousands", () => {
    describe("when its width is derived", () => {
      it("reserves more room than a small-value axis needs", () => {
        // The bug this replaces: a fixed width sized for "500" clips "500.0k".
        const large = axisWidthFor(axisTicks(500_000), formatAxisValue);
        const small = axisWidthFor(axisTicks(20), formatAxisValue);

        expect(large).toBeGreaterThan(small);
      });

      it("fits the longest label it will actually render", () => {
        const ticks = axisTicks(500_000);
        const longest = Math.max(
          ...ticks.map((t) => formatAxisValue(t).length),
        );

        expect(axisWidthFor(ticks, formatAxisValue)).toBeGreaterThanOrEqual(
          longest * 7,
        );
      });
    });
  });
});
