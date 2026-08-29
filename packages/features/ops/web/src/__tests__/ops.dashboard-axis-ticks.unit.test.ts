import { describe, expect, it } from "vitest";
import { AXIS_INTERVALS, alignedMax, axisTicks, axisWidthFor, niceMax } from "../index";

const formatAxisValue = (value: number): string => {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value === 0) return "0";
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
};

describe("axisTicks", () => {
  it("divides unrelated rate and count ranges into shared intervals", () => {
    const rates = axisTicks(2_000);
    const counts = axisTicks(129_091);

    expect(rates).toHaveLength(AXIS_INTERVALS + 1);
    expect(counts).toHaveLength(AXIS_INTERVALS + 1);

    const fractionsOf = (ticks: number[]) =>
      ticks.map((tick) => tick / ticks[ticks.length - 1]!);
    expect(fractionsOf(rates)).toEqual(fractionsOf(counts));
  });

  it("starts at zero and ends at the aligned maximum", () => {
    const ticks = axisTicks(437);

    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(alignedMax(437));
  });

  it("keeps decimal ticks finite and preserves sub-unit axes", () => {
    for (const max of [0.25, 1, 7, 99, 437, 2_000, 129_091]) {
      for (const tick of axisTicks(max)) {
        expect(Number(tick.toFixed(4))).toBe(tick);
      }
    }

    expect(alignedMax(0.25)).toBeLessThanOrEqual(1);
    expect(alignedMax(0.6)).toBeLessThanOrEqual(1);
    expect(axisTicks(0.25).at(-1)).toBeLessThanOrEqual(1);
  });

  it("never places the maximum below the requested data range", () => {
    for (const max of [1, 7, 99, 437, 2_000, 129_091]) {
      expect(alignedMax(max)).toBeGreaterThanOrEqual(max);
    }
  });

  it("keeps an empty or degenerate range usable", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(axisTicks(0)).toHaveLength(AXIS_INTERVALS + 1);
  });
});

describe("axisWidthFor", () => {
  it("reserves enough room for the longest rendered axis label", () => {
    const large = axisTicks(500_000);
    const small = axisTicks(20);
    const longest = Math.max(...large.map((tick) => formatAxisValue(tick).length));

    expect(axisWidthFor(large, formatAxisValue)).toBeGreaterThan(
      axisWidthFor(small, formatAxisValue),
    );
    expect(axisWidthFor(large, formatAxisValue)).toBeGreaterThanOrEqual(longest * 7);
  });
});
