/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Capture the onData callback from useSSESubscription
let capturedOnData: ((data: { event: string }) => void) | undefined;

vi.mock("../useSSESubscription", () => ({
  useSSESubscription: (
    _subscription: unknown,
    _input: unknown,
    options: { onData?: (data: { event: string }) => void },
  ) => {
    capturedOnData = options.onData;
    return {
      connectionState: "connected",
      isConnected: true,
      isConnecting: false,
      hasError: false,
      isDisconnected: false,
      retryCount: 0,
      lastData: undefined,
      lastError: undefined,
    };
  },
}));

let mockIsVisible = true;
vi.mock("../usePageVisibility", () => ({
  usePageVisibility: () => mockIsVisible,
}));

const mockInvalidateBatchHistory = vi.fn();
const mockInvalidateSuiteRunData = vi.fn();

vi.mock("../../utils/api", () => ({
  api: {
    useContext: () => ({
      scenarios: {
        getScenarioSetBatchHistory: {
          invalidate: mockInvalidateBatchHistory,
        },
        getSuiteRunData: {
          invalidate: mockInvalidateSuiteRunData,
        },
      },
    }),
    scenarios: {
      onSimulationUpdate: {
        useSubscription: vi.fn(),
      },
    },
  },
}));

import { useSimulationUpdateListener } from "../useSimulationUpdateListener";

function simulateSSEEvent(payload: {
  event: string;
  scenarioSetId?: string;
  batchRunId?: string;
}) {
  capturedOnData?.({ event: JSON.stringify(payload) });
}

describe("useSimulationUpdateListener()", () => {
  let refetchSpy: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    refetchSpy = vi.fn<() => void>();
    mockIsVisible = true;
    capturedOnData = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("when an SSE event fires for matching scenarioSetId", () => {
    it("triggers refetch", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
          filter: { scenarioSetId: "set_A" },
        }),
      );

      act(() => {
        simulateSSEEvent({
          event: "simulation_updated",
          scenarioSetId: "set_A",
        });
      });

      expect(refetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when an SSE event fires for a different scenarioSetId", () => {
    it("does not trigger refetch", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
          filter: { scenarioSetId: "set_A" },
        }),
      );

      act(() => {
        simulateSSEEvent({
          event: "simulation_updated",
          scenarioSetId: "set_B",
        });
      });

      expect(refetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when no filter is set (AllRunsPanel mode)", () => {
    it("triggers refetch for any event", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
        }),
      );

      act(() => {
        simulateSSEEvent({
          event: "simulation_updated",
          scenarioSetId: "set_X",
        });
      });

      expect(refetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no SSE event has fired recently", () => {
    it("fires refetch immediately without debounce delay", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
          debounceMs: 500,
        }),
      );

      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });

      // Should fire immediately, not after a timer
      expect(refetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when rapid SSE events fire within the debounce window", () => {
    it("coalesces them into one additional refetch", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
          debounceMs: 500,
        }),
      );

      // First event fires immediately
      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });
      expect(refetchSpy).toHaveBeenCalledTimes(1);

      // Three more events within debounce window
      act(() => {
        vi.advanceTimersByTime(100);
        simulateSSEEvent({ event: "simulation_updated" });
      });
      act(() => {
        vi.advanceTimersByTime(100);
        simulateSSEEvent({ event: "simulation_updated" });
      });
      act(() => {
        vi.advanceTimersByTime(100);
        simulateSSEEvent({ event: "simulation_updated" });
      });

      // Still only one call (the first immediate one)
      expect(refetchSpy).toHaveBeenCalledTimes(1);

      // After debounce period, one additional refetch
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(refetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("when browser tab is hidden", () => {
    it("does not trigger refetch", () => {
      mockIsVisible = false;

      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
        }),
      );

      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });

      expect(refetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when tab becomes visible after hidden events", () => {
    it("triggers refetch on the next SSE event after becoming visible", () => {
      mockIsVisible = false;

      const { rerender } = renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
          debounceMs: 500,
        }),
      );

      // Event fires while hidden - scheduleUpdate runs but fireUpdate is suppressed
      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });
      expect(refetchSpy).not.toHaveBeenCalled();

      // Advance past the debounce window so next event can fire immediately
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // Tab becomes visible again
      mockIsVisible = true;
      rerender();

      // The next SSE event fires and refetch runs immediately
      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });

      expect(refetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when an SSE event fires", () => {
    it("invalidates getSuiteRunData so RunHistoryPanel refreshes", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
        }),
      );

      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });

      expect(mockInvalidateSuiteRunData).toHaveBeenCalledTimes(1);
    });

    it("invalidates getScenarioSetBatchHistory for sidebar refresh", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
        }),
      );

      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });

      expect(mockInvalidateBatchHistory).toHaveBeenCalledTimes(1);
    });
  });

  describe("when onNewBatchRun callback is provided", () => {
    it("calls onNewBatchRun for new batch run IDs", () => {
      const onNewBatchRun = vi.fn();

      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
          onNewBatchRun,
        }),
      );

      act(() => {
        simulateSSEEvent({
          event: "simulation_updated",
          batchRunId: "batch_123",
        });
      });

      expect(onNewBatchRun).toHaveBeenCalledWith("batch_123");
    });

    it("does not call onNewBatchRun for already-seen batch run IDs", () => {
      const onNewBatchRun = vi.fn();

      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
          onNewBatchRun,
          debounceMs: 500,
        }),
      );

      act(() => {
        simulateSSEEvent({
          event: "simulation_updated",
          batchRunId: "batch_123",
        });
      });

      // Advance past debounce window so next event is immediate
      act(() => {
        vi.advanceTimersByTime(600);
      });

      act(() => {
        simulateSSEEvent({
          event: "simulation_updated",
          batchRunId: "batch_123",
        });
      });

      expect(onNewBatchRun).toHaveBeenCalledTimes(1);
    });

    describe("when knownBatchRunIds exceeds 500 entries", () => {
      it("evicts old IDs so onNewBatchRun fires again for them", () => {
        const onNewBatchRun = vi.fn();

        renderHook(() =>
          useSimulationUpdateListener({
            projectId: "proj_1",
            refetch: refetchSpy,
            onNewBatchRun,
            debounceMs: 0,
          }),
        );

        // Send 501 unique batch run IDs to exceed the 500 cap
        for (let i = 0; i < 501; i++) {
          act(() => {
            simulateSSEEvent({
              event: "simulation_updated",
              batchRunId: `batch_${i}`,
            });
          });
        }

        expect(onNewBatchRun).toHaveBeenCalledTimes(501);

        // The first ID was evicted when the set exceeded 500,
        // so sending it again triggers onNewBatchRun
        act(() => {
          simulateSSEEvent({
            event: "simulation_updated",
            batchRunId: "batch_0",
          });
        });

        expect(onNewBatchRun).toHaveBeenCalledTimes(502);
      });
    });
  });
});
