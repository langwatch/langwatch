/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGetRotatingColorForCharts } from "../useGetRotatingColorForCharts";

vi.mock("../../components/ui/color-mode", () => ({
  getRawColorValue: vi.fn((color: string) => color),
}));

import { getRawColorValue } from "../../components/ui/color-mode";

const mockGetRawColorValue = vi.mocked(getRawColorValue);

describe("useGetRotatingColorForCharts()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRawColorValue.mockImplementation((color: string) => color);
  });

  describe("when color has a numeric suffix (e.g. orangeTones set)", () => {
    it("applies adjustment to the numeric value and calls getRawColorValue", () => {
      const { result } = renderHook(() => useGetRotatingColorForCharts());
      const getColor = result.current;

      // orangeTones index 0 has color "orange.400" (from tones("orange")[0].color)
      getColor("orangeTones", 0, 50);

      expect(mockGetRawColorValue).toHaveBeenCalledWith("orange.450");
    });

    it("clamps adjustment so the result stays within 50..900", () => {
      const { result } = renderHook(() => useGetRotatingColorForCharts());
      const getColor = result.current;

      // orangeTones index 4 has color "orange.900"; adding 200 should clamp to 900
      // orangeTones[4].color = "orange.900"
      getColor("orangeTones", 4, 200);

      expect(mockGetRawColorValue).toHaveBeenCalledWith("orange.900");
    });

    it("returns the value from getRawColorValue", () => {
      mockGetRawColorValue.mockReturnValue("#7B341E");

      const { result } = renderHook(() => useGetRotatingColorForCharts());
      const getColor = result.current;

      const color = getColor("orangeTones", 0);

      expect(color).toBe("#7B341E");
    });
  });

  describe("when color has a semantic suffix (e.g. colors set)", () => {
    it("returns the raw color value without producing NaN in the token name", () => {
      const { result } = renderHook(() => useGetRotatingColorForCharts());
      const getColor = result.current;

      // "colors" set index 0 has color "orange.emphasized"
      // Before the fix, parseInt("emphasized") is NaN, causing "orange.NaN" to be passed
      getColor("colors", 0);

      // Must be called with the original semantic token, not "orange.NaN"
      expect(mockGetRawColorValue).toHaveBeenCalledWith("orange.emphasized");
      expect(mockGetRawColorValue).not.toHaveBeenCalledWith(
        expect.stringContaining("NaN"),
      );
    });

    it("ignores adjustment for semantic suffix colors", () => {
      const { result } = renderHook(() => useGetRotatingColorForCharts());
      const getColor = result.current;

      // adjustment should have no effect on semantic tokens
      getColor("colors", 0, 100);

      expect(mockGetRawColorValue).toHaveBeenCalledWith("orange.emphasized");
    });
  });
});
