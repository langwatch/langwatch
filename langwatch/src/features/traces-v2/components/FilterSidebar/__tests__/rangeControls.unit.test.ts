import { describe, expect, it, vi } from "vitest";
import { commitRange, stepForSpan } from "../rangeControls";

describe("stepForSpan", () => {
  describe("given a sub-unit span", () => {
    it("returns a power of ten finer than the span", () => {
      expect(stepForSpan(0.004)).toBe(1e-5);
    });
  });

  describe("given a large span", () => {
    it("rounds 1/200th of the span down to a power of ten", () => {
      expect(stepForSpan(5000)).toBe(10);
    });
  });

  describe("given a degenerate span", () => {
    it("falls back to 1 for zero", () => {
      expect(stepForSpan(0)).toBe(1);
    });

    it("falls back to 1 for negative spans", () => {
      expect(stepForSpan(-3)).toBe(1);
    });
  });
});

describe("commitRange", () => {
  describe("given inverted out-of-range input", () => {
    it("clamps to bounds and sorts low/high before emitting", () => {
      const onChange = vi.fn();
      const onClear = vi.fn();
      const result = commitRange({
        rawFrom: 150,
        rawTo: -20,
        min: 0,
        max: 100,
        span: 100,
        onChange,
        onClear,
      });
      expect(result).toEqual([0, 100]);
      // Clamped tuple covers the full range, so it clears instead.
      expect(onClear).toHaveBeenCalledOnce();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("emits the sorted tuple when it narrows the range", () => {
      const onChange = vi.fn();
      const onClear = vi.fn();
      const result = commitRange({
        rawFrom: 80,
        rawTo: 20,
        min: 0,
        max: 100,
        span: 100,
        onChange,
        onClear,
      });
      expect(result).toEqual([20, 80]);
      expect(onChange).toHaveBeenCalledWith(20, 80);
      expect(onClear).not.toHaveBeenCalled();
    });
  });

  describe("given endpoints at the full range", () => {
    it("calls onClear instead of onChange", () => {
      const onChange = vi.fn();
      const onClear = vi.fn();
      commitRange({
        rawFrom: 0,
        rawTo: 100,
        min: 0,
        max: 100,
        span: 100,
        onChange,
        onClear,
      });
      expect(onClear).toHaveBeenCalledOnce();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("given non-finite input", () => {
    it("drops the commit and returns null", () => {
      const onChange = vi.fn();
      const onClear = vi.fn();
      const result = commitRange({
        rawFrom: Number.NaN,
        rawTo: 50,
        min: 0,
        max: 100,
        span: 100,
        onChange,
        onClear,
      });
      expect(result).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      expect(onClear).not.toHaveBeenCalled();
    });
  });
});
