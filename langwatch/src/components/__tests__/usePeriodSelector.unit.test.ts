/**
 * @vitest-environment jsdom
 *
 * Unit tests for usePeriodSelector hook.
 *
 * @see specs/features/suites/suite-runs-time-filter.feature - "Default time range is applied on initial load"
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    isReady: true,
  }),
}));

// Dynamic import after mock is set up
const { usePeriodSelector } = await import("../PeriodSelector");

describe("usePeriodSelector()", () => {
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
});
