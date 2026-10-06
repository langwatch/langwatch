/**
 * @vitest-environment jsdom
 *
 * @see specs/period-selector.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockQuery: Record<string, string> = {};
const mockPush = vi.fn();

vi.mock("../use-router.ts", () => ({
  useRouter: () => ({
    query: mockQuery,
    push: mockPush,
    isReady: true,
  }),
}));

const { usePeriodSelector } = await import("../period-selector.tsx");

describe("the period selector's selection", () => {
  beforeEach(() => {
    mockQuery = {};
    mockPush.mockClear();
  });

  describe("given a page with a period selector", () => {
    describe("when the reader picks the Last 15 minutes quick selector", () => {
      /** @scenario "Picking a relative quick selector stores the selection as relative" */
      it("writes period=15m, no absolute dates, and reads back as relative", () => {
        mockQuery = {
          startDate: "2026-04-20T00:00:00.000Z",
          endDate: "2026-04-22T00:00:00.000Z",
        };
        const { result } = renderHook(() => usePeriodSelector(30));

        result.current.setRelativePeriod("15m");

        const [{ query }] = mockPush.mock.calls[0] as [{ query: Record<string, string> }];
        expect(query.period).toBe("15m");
        expect(query).not.toHaveProperty("startDate");
        expect(query).not.toHaveProperty("endDate");

        mockQuery = query;
        const reread = renderHook(() => usePeriodSelector(30));
        expect(reread.result.current.mode).toBe("relative");
      });
    });
  });
});
