// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTraceNewCount } from "../useTraceNewCount";

type QueryOptions = {
  retry: number;
  refetchInterval: number | false;
};

const capturedOptions: QueryOptions[] = [];

// Mutable query result the mock hands back — tests simulate a settled poll by
// mutating it (bumping dataUpdatedAt / errorUpdatedAt, as React Query does per
// fetch) and re-rendering; the hook's per-fetch effects key on those stamps.
const queryResult: {
  data: { count: number } | undefined;
  isLoading: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
} = {
  data: { count: 0 },
  isLoading: false,
  dataUpdatedAt: 0,
  errorUpdatedAt: 0,
};

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      newCount: {
        useQuery: (_input: unknown, options: QueryOptions) => {
          capturedOptions.push(options);
          return queryResult;
        },
      },
    },
    useUtils: () => ({
      tracesV2: {
        newCount: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1" } }),
}));

vi.mock("~/hooks/usePageVisibility", () => ({
  usePageVisibility: () => true,
}));

vi.mock("../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({
      debouncedTimeRange: { from: 1, to: 2, label: "Last 24h" },
      debouncedQueryText: "evaluator:monitor_x",
    }),
}));

vi.mock("../stores/sseStatusStore", () => ({
  useSseStatusStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        sseConnectionState: "disconnected",
        fastPollRequestedAt: 0,
        liveUpdatesMode: "live",
      }),
    { getState: () => ({ liveUpdatesMode: "live" }) },
  ),
}));

vi.mock("../useTraceListRefresh", () => ({
  useTraceListRefresh: () => ({ refresh: vi.fn(), isRefreshing: false }),
}));

const lastOptions = (): QueryOptions => {
  const options = capturedOptions[capturedOptions.length - 1];
  if (!options) {
    throw new Error("no query options were captured");
  }
  return options;
};

describe("useTraceNewCount", () => {
  beforeEach(() => {
    capturedOptions.length = 0;
    queryResult.data = { count: 0 };
    queryResult.isLoading = false;
    queryResult.dataUpdatedAt = 0;
    queryResult.errorUpdatedAt = 0;
    vi.clearAllMocks();
  });

  describe("when a live poll fails because ClickHouse is overloaded", () => {
    /** @scenario Live polling eases off when ClickHouse is overloaded */
    it("backs the poll cadence off to the slow interval", () => {
      const { rerender } = renderHook(() => useTraceNewCount());

      const initialOptions = lastOptions();
      expect(initialOptions.retry).toBe(1);
      expect(initialOptions.refetchInterval).toBe(5000);

      act(() => {
        queryResult.errorUpdatedAt = 1_000;
        rerender();
      });

      expect(lastOptions().refetchInterval).toBe(30000);
    });

    it("returns to the fast cadence once a poll succeeds again", () => {
      const { rerender } = renderHook(() => useTraceNewCount());

      act(() => {
        queryResult.errorUpdatedAt = 1_000;
        rerender();
      });
      expect(lastOptions().refetchInterval).toBe(30000);

      act(() => {
        queryResult.data = { count: 3 };
        queryResult.dataUpdatedAt = 2_000;
        rerender();
      });

      expect(lastOptions().refetchInterval).toBe(5000);
    });
  });
});
