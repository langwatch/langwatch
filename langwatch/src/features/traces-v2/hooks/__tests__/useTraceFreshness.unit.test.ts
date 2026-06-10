// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks set up before the module-under-test is imported ──────────────────

let capturedOnTraceSummaryUpdated: ((traceIds: string[]) => void) | null = null;

vi.mock("~/hooks/useTraceUpdateListener", () => ({
  useTraceUpdateListener: (opts: {
    onTraceSummaryUpdated?: (ids: string[]) => void;
    onSpanStored?: (ids: string[]) => void;
  }) => {
    capturedOnTraceSummaryUpdated = opts.onTraceSummaryUpdated ?? null;
    return { connectionState: "connected" as const, lastEventAt: 0 };
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

// The discover-freshness subscription opens a real SSE connection when
// unmocked; these tests only exercise the trace_summary_updated paths.
vi.mock("~/hooks/useSSESubscription", () => ({
  useSSESubscription: () => ({
    connectionState: "disconnected" as const,
    retryCount: 0,
    lastData: null,
    lastError: null,
    isConnected: false,
    isConnecting: false,
    hasError: false,
    isDisconnected: true,
  }),
}));

// Control what visibleTraceIds returns — overridden per test group.
let visibleIdsResult = {
  ids: new Set<string>(),
  topTimestamp: undefined as number | undefined,
  page: 1,
};

// useVisibleTraceIds is in hooks/ (same level as useTraceFreshness), so
// from __tests__/ the path to reach it is ../useVisibleTraceIds.
vi.mock("../useVisibleTraceIds", () => ({
  useVisibleTraceIds: () => visibleIdsResult,
}));

// Capture all calls to the mocked trpcUtils methods.
const mockListCancel = vi.fn().mockResolvedValue(undefined);
const mockListInvalidate = vi.fn().mockResolvedValue(undefined);
const mockNewCountCancel = vi.fn().mockResolvedValue(undefined);
const mockNewCountInvalidate = vi.fn().mockResolvedValue(undefined);
const mockDiscoverCancel = vi.fn().mockResolvedValue(undefined);
const mockDiscoverInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("~/utils/api", () => ({
  api: {
    // The hook passes this procedure object to (the mocked)
    // useSSESubscription — it only needs to exist, not function.
    tracesV2: { onDiscoverUpdate: {} },
    useContext: () => ({
      tracesV2: {
        list: {
          cancel: mockListCancel,
          invalidate: mockListInvalidate,
        },
        newCount: {
          cancel: mockNewCountCancel,
          invalidate: mockNewCountInvalidate,
        },
        discover: {
          cancel: mockDiscoverCancel,
          invalidate: mockDiscoverInvalidate,
        },
        header: { invalidate: vi.fn().mockResolvedValue(undefined) },
        spanTree: { invalidate: vi.fn().mockResolvedValue(undefined) },
        evals: { invalidate: vi.fn().mockResolvedValue(undefined) },
        spanDetail: { invalidate: vi.fn().mockResolvedValue(undefined) },
        spanLangwatchSignals: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
        traceEvents: { invalidate: vi.fn().mockResolvedValue(undefined) },
        resourceInfo: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
    }),
    useUtils: () => ({
      tracesV2: {
        list: { getData: vi.fn().mockReturnValue(null) },
      },
    }),
  },
}));

// Stores are at traces-v2/stores/ which from hooks/__tests__/ is ../../stores/.
vi.mock("../../stores/drawerStore", () => ({
  useDrawerStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({ traceId: null, occurredAtMs: null }),
    { getState: () => ({ traceId: null, occurredAtMs: null }) },
  ),
}));

// Mutable live-updates mode — mutated in beforeEach / test body.
let liveUpdatesMode: "live" | "ask" | "paused" = "live";

vi.mock("../../stores/sseStatusStore", () => ({
  useSseStatusStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        liveUpdatesMode,
        liveUpdatesEnabled: true,
        sseConnectionState: "connected",
        fastPollRequestedAt: 0,
        requestFastPoll: vi.fn(),
        setSseConnectionState: vi.fn(),
        setLastEventAt: vi.fn(),
      }),
    {
      getState: () => ({
        liveUpdatesMode,
        requestFastPoll: vi.fn(),
      }),
    },
  ),
}));

// Track pulse calls per traceId.
const pulseMock = vi.fn();

vi.mock("../../stores/rowPulseStore", () => ({
  useRowPulseStore: (selector: (s: { pulse: typeof pulseMock }) => unknown) =>
    selector({ pulse: pulseMock }),
}));

// ─── Module under test ────────────────────────────────────────────────────
import { useTraceFreshness } from "../useTraceFreshness";

// ─── Test lifecycle ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  capturedOnTraceSummaryUpdated = null;
  liveUpdatesMode = "live";
  visibleIdsResult = { ids: new Set(), topTimestamp: undefined, page: 1 };
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe("useTraceFreshness", () => {
  describe("given the user is on page 1 and a visible trace is updated", () => {
    describe("when an SSE trace_summary_updated arrives for a visible traceId", () => {
      it("pulses that row and does NOT invalidate list", async () => {
        visibleIdsResult = {
          ids: new Set(["trace-visible"]),
          topTimestamp: Date.now(),
          page: 1,
        };

        renderHook(() => useTraceFreshness());

        expect(capturedOnTraceSummaryUpdated).not.toBeNull();

        await act(async () => {
          capturedOnTraceSummaryUpdated!(["trace-visible"]);
        });

        expect(pulseMock).toHaveBeenCalledWith("trace-visible");
        expect(mockListInvalidate).not.toHaveBeenCalled();
        expect(mockNewCountInvalidate).toHaveBeenCalled();
      });
    });
  });

  describe("given the user is on page 1 and a new trace arrives", () => {
    describe("when an SSE event arrives for a traceId not in the visible set", () => {
      it("cancels and invalidates list", async () => {
        visibleIdsResult = {
          ids: new Set(["trace-old-1", "trace-old-2"]),
          topTimestamp: Date.now() - 5000,
          page: 1,
        };

        renderHook(() => useTraceFreshness());

        await act(async () => {
          capturedOnTraceSummaryUpdated!(["brand-new-trace"]);
        });

        expect(mockListCancel).toHaveBeenCalled();
        expect(mockListInvalidate).toHaveBeenCalled();
        expect(mockNewCountInvalidate).toHaveBeenCalled();
      });
    });
  });

  describe("given the user is on page 6 and an off-screen trace is updated", () => {
    describe("when an SSE event arrives for a traceId on another page", () => {
      it("does NOT invalidate list but DOES invalidate newCount", async () => {
        visibleIdsResult = {
          ids: new Set(["page-6-trace-a", "page-6-trace-b"]),
          topTimestamp: Date.now() - 10000,
          page: 6,
        };

        renderHook(() => useTraceFreshness());

        await act(async () => {
          capturedOnTraceSummaryUpdated!(["page-3-trace-x"]);
        });

        expect(mockListCancel).not.toHaveBeenCalled();
        expect(mockListInvalidate).not.toHaveBeenCalled();
        expect(mockNewCountInvalidate).toHaveBeenCalled();
      });
    });
  });

  describe("given a burst of 20 SSE events in live mode", () => {
    describe("when all events arrive within 200ms", () => {
      it("calls cancel before each list invalidate so stale fetches cannot win", async () => {
        visibleIdsResult = { ids: new Set(), topTimestamp: undefined, page: 1 };

        renderHook(() => useTraceFreshness());

        await act(async () => {
          for (let i = 0; i < 20; i++) {
            capturedOnTraceSummaryUpdated!([`trace-new-${i}`]);
          }
        });

        expect(mockListCancel).toHaveBeenCalled();
        expect(mockListInvalidate).toHaveBeenCalled();
        expect(mockListCancel.mock.calls.length).toBeGreaterThanOrEqual(
          mockListInvalidate.mock.calls.length,
        );
      });
    });
  });

  describe("given the user is in ask mode", () => {
    describe("when an SSE event arrives for a new trace", () => {
      it("does NOT invalidate list (ask mode suppresses auto-refresh)", async () => {
        liveUpdatesMode = "ask";
        visibleIdsResult = { ids: new Set(), topTimestamp: undefined, page: 1 };

        renderHook(() => useTraceFreshness());

        await act(async () => {
          capturedOnTraceSummaryUpdated!(["new-trace-in-ask-mode"]);
        });

        expect(mockListInvalidate).not.toHaveBeenCalled();
        expect(mockNewCountInvalidate).toHaveBeenCalled();
      });
    });
  });
});
