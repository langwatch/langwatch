/**
 * @vitest-environment jsdom
 *
 * @see specs/features/suites/suite-runs-time-filter.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockQuery: Record<string, string> = {};
const mockPush = vi.fn();

vi.mock("@langwatch/workflow-web/studio-host/next-router", () => ({
  useRouter: () => ({
    query: mockQuery,
    push: mockPush,
    isReady: true,
  }),
}));

const { usePeriodSelector } = await import("../period-selector");

describe("usePeriodSelector()", () => {
  beforeEach(() => {
    mockQuery = {};
    mockPush.mockClear();
  });

  describe("given no time range has been selected", () => {
    describe("when the hook first reads the URL", () => {
      /** @scenario "Default time range is applied on initial load" */
      it("defaults to a 30-day range", () => {
        const { result } = renderHook(() => usePeriodSelector(30));

        const { startDate, endDate } = result.current.period;
        const diffDays =
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

        expect(diffDays).toBeGreaterThanOrEqual(28);
        expect(diffDays).toBeLessThanOrEqual(30);
        expect(result.current.daysDifference).toBe(30);
      });
    });
  });

  describe("given the URL carries an explicit date range", () => {
    describe("when the range is read back", () => {
      /** @scenario "Selected date range limits displayed run data" */
      it("bounds the displayed window by the selected dates", () => {
        mockQuery = {
          startDate: "2025-03-10T00:00:00Z",
          endDate: "2025-03-20T00:00:00Z",
        };

        const { result } = renderHook(() => usePeriodSelector(30));

        expect(result.current.period.startDate.getTime()).toBeLessThanOrEqual(
          result.current.period.endDate.getTime(),
        );
        expect(result.current.period.startDate.getTime()).toBe(
          new Date("2025-03-10T00:00:00Z").getTime(),
        );
        expect(result.current.period.endDate.getTime()).toBe(
          new Date("2025-03-20T00:00:00Z").getTime(),
        );
      });
    });
  });
});
