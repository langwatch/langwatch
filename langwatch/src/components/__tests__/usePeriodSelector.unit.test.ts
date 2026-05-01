/**
 * @vitest-environment jsdom
 *
 * Unit tests for usePeriodSelector hook.
 *
 * @see specs/period-selector.feature
 */
import { act, renderHook } from "@testing-library/react";
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

      expect(diffDays).toBeGreaterThanOrEqual(28);
      expect(diffDays).toBeLessThanOrEqual(30);
    });

    it("returns a daysDifference of 30", () => {
      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.daysDifference).toBe(30);
    });

    it("reports relative mode", () => {
      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.mode).toBe("relative");
    });
  });

  describe("when a relative period preset is in the URL", () => {
    it("computes a 15-minute window anchored to now for period=15m", () => {
      mockQuery = { period: "15m" };

      const { result } = renderHook(() => usePeriodSelector(30));

      const { startDate, endDate } = result.current.period;
      const diffMinutes = (endDate.getTime() - startDate.getTime()) / 60000;

      expect(Math.round(diffMinutes)).toBe(15);
      expect(result.current.mode).toBe("relative");
      expect(Math.abs(endDate.getTime() - Date.now())).toBeLessThan(1000);
    });

    it("re-anchors to the latest now when the hook is remounted later", () => {
      mockQuery = { period: "15m" };

      const first = renderHook(() => usePeriodSelector(30));
      const firstEnd = first.result.current.period.endDate.getTime();

      vi.useFakeTimers();
      vi.setSystemTime(new Date(firstEnd + 60 * 60 * 1000));

      const second = renderHook(() => usePeriodSelector(30));
      const secondEnd = second.result.current.period.endDate.getTime();

      expect(secondEnd - firstEnd).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1);

      vi.useRealTimers();
    });

    it("falls back to the default range for an unknown period key", () => {
      mockQuery = { period: "bogus" };

      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.mode).toBe("relative");
      expect(result.current.daysDifference).toBe(30);
    });
  });

  describe("when explicit startDate and endDate are in the URL", () => {
    it("reports absolute mode", () => {
      mockQuery = {
        startDate: "2026-04-20T00:00:00.000Z",
        endDate: "2026-04-22T23:59:59.999Z",
      };

      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.mode).toBe("absolute");
    });

    it("returns the exact dates from the URL", () => {
      mockQuery = {
        startDate: "2026-04-20T00:00:00.000Z",
        endDate: "2026-04-22T23:59:59.999Z",
      };

      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.period.startDate.toISOString()).toBe(
        "2026-04-20T00:00:00.000Z",
      );
      expect(result.current.period.endDate.toISOString()).toBe(
        "2026-04-22T23:59:59.999Z",
      );
    });
  });

  describe("when query params have inverted date range", () => {
    it("returns startDate <= endDate", () => {
      mockQuery = {
        startDate: "2025-03-20T00:00:00Z",
        endDate: "2025-03-10T00:00:00Z",
      };

      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.period.startDate.getTime()).toBeLessThanOrEqual(
        result.current.period.endDate.getTime(),
      );
    });

    it("returns a non-negative daysDifference", () => {
      mockQuery = {
        startDate: "2025-03-20T00:00:00Z",
        endDate: "2025-03-10T00:00:00Z",
      };

      const { result } = renderHook(() => usePeriodSelector(30));

      expect(result.current.daysDifference).toBeGreaterThanOrEqual(1);
    });
  });

  describe("when setRelativePeriod is called", () => {
    it("writes period to the URL and clears startDate/endDate", () => {
      mockQuery = {
        startDate: "2026-04-20T00:00:00.000Z",
        endDate: "2026-04-22T23:59:59.999Z",
        otherFilter: "keep-me",
      };

      const { result } = renderHook(() => usePeriodSelector(30));

      act(() => {
        result.current.setRelativePeriod("15m");
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedQuery = mockPush.mock.calls[0]?.[0]?.query;
      expect(pushedQuery).toEqual({
        otherFilter: "keep-me",
        period: "15m",
      });
    });
  });

  describe("when setPeriod is called", () => {
    it("writes startDate/endDate and clears the relative period key", () => {
      mockQuery = { period: "7d", otherFilter: "keep-me" };

      const { result } = renderHook(() => usePeriodSelector(30));

      act(() => {
        result.current.setPeriod(
          new Date("2026-04-20T00:00:00.000Z"),
          new Date("2026-04-22T23:59:59.999Z"),
        );
      });

      expect(mockPush).toHaveBeenCalledTimes(1);
      const pushedQuery = mockPush.mock.calls[0]?.[0]?.query;
      expect(pushedQuery).toMatchObject({
        otherFilter: "keep-me",
        startDate: "2026-04-20T00:00:00.000Z",
        endDate: "2026-04-22T23:59:59.999Z",
      });
      expect(pushedQuery).not.toHaveProperty("period");
    });
  });
});
