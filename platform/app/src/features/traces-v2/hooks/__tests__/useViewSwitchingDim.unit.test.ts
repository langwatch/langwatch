// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mutable state used by store mocks ──────────────────────────────────────

let mockDensity = "comfortable";
let mockQueryText = "";
let mockPage = 1;
let mockPageSize = 20;
let mockSortColumnId = "timestamp";
let mockSortDirection = "desc";
let mockActiveLensId = "all-traces";
let mockTimeRangeLabel = "Last 24h";
let mockTimeRangeFrom = 0;
let mockTimeRangeTo = 1;

const mockSetReplacingData = vi.fn();

// ─── Store mocks ─────────────────────────────────────────────────────────────

vi.mock("../../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({
      debouncedQueryText: mockQueryText,
      debouncedTimeRange: {
        from: mockTimeRangeFrom,
        to: mockTimeRangeTo,
        label: mockTimeRangeLabel,
      },
      page: mockPage,
      pageSize: mockPageSize,
    }),
}));

vi.mock("../../stores/viewStore", () => ({
  useViewStore: (selector: (s: unknown) => unknown) =>
    selector({
      sort: { columnId: mockSortColumnId, direction: mockSortDirection },
      activeLensId: mockActiveLensId,
    }),
}));

vi.mock("../../stores/densityStore", () => ({
  useDensityStore: (selector: (s: unknown) => unknown) =>
    selector({ density: mockDensity }),
}));

vi.mock("../../stores/refreshUIStore", () => ({
  useRefreshUIStore: (selector: (s: unknown) => unknown) =>
    selector({
      pulse: vi.fn(),
      setReplacingData: mockSetReplacingData,
    }),
}));

// ─── Module under test ────────────────────────────────────────────────────────
import { useViewSwitchingDim } from "../useViewSwitchingDim";

// ─── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockDensity = "comfortable";
  mockQueryText = "";
  mockPage = 1;
  mockPageSize = 20;
  mockSortColumnId = "timestamp";
  mockSortDirection = "desc";
  mockActiveLensId = "all-traces";
  mockTimeRangeLabel = "Last 24h";
  mockTimeRangeFrom = 0;
  mockTimeRangeTo = 1;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useViewSwitchingDim", () => {
  describe("given isFetching is true and a view key changes", () => {
    describe("when density changes while isFetching is true", () => {
      it("sets isReplacingData to true even when isPreviousData is false", async () => {
        const { rerender } = renderHook(
          ({ isFetching, isPreviousData }: { isFetching: boolean; isPreviousData: boolean }) =>
            useViewSwitchingDim({ isFetching, isFetched: true, isPreviousData }),
          { initialProps: { isFetching: false, isPreviousData: false } },
        );

        // Simulate a density change happening while fetching begins
        mockDensity = "compact";

        await act(async () => {
          rerender({ isFetching: true, isPreviousData: false });
        });

        expect(mockSetReplacingData).toHaveBeenCalledWith(true);
      });
    });

    describe("when density changes and isFetching and isPreviousData are both false", () => {
      it("does not dim because there is no fetch in flight", async () => {
        const { rerender } = renderHook(
          ({ isFetching, isPreviousData }: { isFetching: boolean; isPreviousData: boolean }) =>
            useViewSwitchingDim({ isFetching, isFetched: true, isPreviousData }),
          { initialProps: { isFetching: false, isPreviousData: false } },
        );

        mockDensity = "compact";

        await act(async () => {
          rerender({ isFetching: false, isPreviousData: false });
        });

        // setReplacingData(false) called (viewSwitching=true but neither fetching nor previousData)
        expect(mockSetReplacingData).toHaveBeenCalledWith(false);
      });
    });
  });

  describe("given a query text change while isPreviousData is true", () => {
    describe("when the view switches and data is still from the prior key", () => {
      it("sets isReplacingData to true", async () => {
        const { rerender } = renderHook(
          ({ isFetching, isPreviousData }: { isFetching: boolean; isPreviousData: boolean }) =>
            useViewSwitchingDim({ isFetching, isFetched: true, isPreviousData }),
          { initialProps: { isFetching: true, isPreviousData: true } },
        );

        mockQueryText = "error";

        await act(async () => {
          rerender({ isFetching: true, isPreviousData: true });
        });

        expect(mockSetReplacingData).toHaveBeenCalledWith(true);
      });
    });
  });

  describe("given a fetch completes after a view switch", () => {
    describe("when isFetching becomes false and isFetched becomes true", () => {
      it("clears isReplacingData", async () => {
        const { rerender } = renderHook(
          ({ isFetching, isFetched, isPreviousData }: { isFetching: boolean; isFetched: boolean; isPreviousData: boolean }) =>
            useViewSwitchingDim({ isFetching, isFetched, isPreviousData }),
          { initialProps: { isFetching: true, isFetched: false, isPreviousData: false } },
        );

        // Trigger a view switch
        mockQueryText = "error";
        await act(async () => {
          rerender({ isFetching: true, isFetched: false, isPreviousData: false });
        });

        // Fetch completes
        await act(async () => {
          rerender({ isFetching: false, isFetched: true, isPreviousData: false });
        });

        expect(mockSetReplacingData).toHaveBeenCalledWith(false);
      });
    });
  });
});
