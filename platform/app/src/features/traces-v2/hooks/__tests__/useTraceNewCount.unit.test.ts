// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTraceNewCount } from "../useTraceNewCount";

type QueryInput = {
  projectId: string;
  timeRange: { from: number; to: number; live: boolean };
  since: number;
  query: string | undefined;
};

type QueryOptions = {
  enabled: boolean;
  retry: number;
  refetchInterval: number | false;
};

type QueryCall = { input: QueryInput; options: QueryOptions };

/**
 * Store values the hook reads. Mutable so a test can put the hook in a
 * different world (SSE connected, live updates paused) and observe the
 * query it builds from it.
 */
const stores = vi.hoisted(() => ({
  debouncedTimeRange: { from: 1, to: 2, label: "Last 24h" } as {
    from: number;
    to: number;
    label: string | null;
  },
  debouncedQueryText: "evaluator:monitor_x",
  sseConnectionState: "disconnected",
  fastPollRequestedAt: 0,
  liveUpdatesMode: "live",
}));

const capturedCalls: QueryCall[] = [];

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
        useQuery: (input: QueryInput, options: QueryOptions) => {
          capturedCalls.push({ input, options });
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

vi.mock("@langwatch/trace-web/filter.store", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({
      debouncedTimeRange: stores.debouncedTimeRange,
      debouncedQueryText: stores.debouncedQueryText,
    }),
}));

vi.mock("@langwatch/trace-web/sse-status.store", () => ({
  useSseStatusStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        sseConnectionState: stores.sseConnectionState,
        fastPollRequestedAt: stores.fastPollRequestedAt,
        liveUpdatesMode: stores.liveUpdatesMode,
      }),
    { getState: () => ({ liveUpdatesMode: stores.liveUpdatesMode }) },
  ),
}));

vi.mock("../useTraceListRefresh", () => ({
  useTraceListRefresh: () => ({ refresh: vi.fn(), isRefreshing: false }),
}));

const lastCall = (): QueryCall => {
  const call = capturedCalls[capturedCalls.length - 1];
  if (!call) {
    throw new Error("no query call was captured");
  }
  return call;
};

const lastOptions = (): QueryOptions => lastCall().options;

describe("useTraceNewCount", () => {
  beforeEach(() => {
    capturedCalls.length = 0;
    queryResult.data = { count: 0 };
    queryResult.isLoading = false;
    queryResult.dataUpdatedAt = 0;
    queryResult.errorUpdatedAt = 0;
    stores.debouncedTimeRange = { from: 1, to: 2, label: "Last 24h" };
    stores.debouncedQueryText = "evaluator:monitor_x";
    stores.sseConnectionState = "disconnected";
    stores.fastPollRequestedAt = 0;
    stores.liveUpdatesMode = "live";
    vi.clearAllMocks();
  });

  describe("when the filter bar carries a search query and a live range", () => {
    it("counts against the same filters the trace list is showing", () => {
      renderHook(() => useTraceNewCount());

      expect(lastCall().input).toMatchObject({
        projectId: "p1",
        timeRange: { from: 1, to: 2, live: true },
        query: "evaluator:monitor_x",
      });
    });
  });

  describe("when the filter bar has no search query", () => {
    it("omits the query rather than counting against an empty string", () => {
      stores.debouncedQueryText = "";

      renderHook(() => useTraceNewCount());

      expect(lastCall().input.query).toBeUndefined();
    });
  });

  describe("when the time range is a fixed window rather than a live one", () => {
    it("marks the range as not live", () => {
      stores.debouncedTimeRange = { from: 10, to: 20, label: null };

      renderHook(() => useTraceNewCount());

      expect(lastCall().input.timeRange.live).toBe(false);
    });
  });

  describe("when SSE is delivering updates", () => {
    it("stops polling and leaves freshness to the stream", () => {
      stores.sseConnectionState = "connected";

      renderHook(() => useTraceNewCount());

      expect(lastOptions().refetchInterval).toBe(false);
    });
  });

  describe("when live updates are paused", () => {
    it("disables the count query entirely", () => {
      stores.liveUpdatesMode = "paused";

      renderHook(() => useTraceNewCount());

      expect(lastOptions().enabled).toBe(false);
    });
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
