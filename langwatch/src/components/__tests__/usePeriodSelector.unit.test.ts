/**
 * @vitest-environment jsdom
 *
 * Unit tests for usePeriodSelector hook.
 *
 * @see specs/features/suites/suite-runs-time-filter.feature - "Default time range is applied on initial load"
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockQuery: Record<string, string> = {};
const mockPush = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockQuery,
    push: mockPush,
    isReady: true,
  }),
}));

// Dynamic import after mock is set up
const { usePeriodSelector } = await import("../PeriodSelector");

describe("usePeriodSelector()", () => {
  beforeEach(() => {
    mockQuery = {};
    mockPush.mockClear();
  });

  describe("when no time range has been selected", () => {
    it("defaults to a 30-day range", () => {
      const { result } = renderHook(() => usePeriodSelector(30));

      const { startDate, endDate } = result.current.period;
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      // Should be approximately 29 days (30 days inclusive)
      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(30);
    });

    it("returns a daysDifference of 30", () => {
      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.daysDifference).toBe(30);
    });
  });

  describe("when query params have inverted date range", () => {
    it("returns startDate <= endDate", () => {
      const future = new Date("2025-03-20T00:00:00Z");
      const past = new Date("2025-03-10T00:00:00Z");
      mockQuery = {
        startDate: future.toISOString(),
        endDate: past.toISOString(),
      };

      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.period.startDate.getTime()).toBeLessThanOrEqual(
        result.current.period.endDate.getTime(),
      );
    });

    it("returns a non-negative daysDifference", () => {
      const future = new Date("2025-03-20T00:00:00Z");
      const past = new Date("2025-03-10T00:00:00Z");
      mockQuery = {
        startDate: future.toISOString(),
        endDate: past.toISOString(),
      };

      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.daysDifference).toBeGreaterThanOrEqual(1);
    });
  });
});
