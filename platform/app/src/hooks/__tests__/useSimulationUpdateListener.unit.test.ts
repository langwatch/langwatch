/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the onData callback from useSSESubscription
let capturedOnData: ((data: { event: string }) => void) | undefined;
let capturedInput: Record<string, unknown> | undefined;

vi.mock("../useSSESubscription", () => ({
  useSSESubscription: (
    _subscription: unknown,
    input: Record<string, unknown>,
    options: { onData?: (data: { event: string }) => void },
  ) => {
    capturedOnData = options.onData;
    capturedInput = input;
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
const mockInvalidateRunState = vi.fn().mockResolvedValue(undefined);
const mockSetRunStateData = vi.fn();

vi.mock("../../utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getScenarioSetBatchHistory: {
          invalidate: mockInvalidateBatchHistory,
        },
        getSuiteRunData: {
          invalidate: mockInvalidateSuiteRunData,
        },
        getRunState: {
          invalidate: mockInvalidateRunState,
          setData: mockSetRunStateData,
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
  scenarioRunId?: string;
  status?: string;
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
    capturedInput = undefined;
    mockInvalidateRunState.mockResolvedValue(undefined);
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

  describe("when filter is 'default' and payload has empty scenarioSetId", () => {
    it("accepts the update by normalizing empty string to default", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
          filter: { scenarioSetId: "default" },
        }),
      );

      act(() => {
        simulateSSEEvent({
          event: "simulation_updated",
          scenarioSetId: "",
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
    /** @scenario "First SSE event triggers immediate refetch" */
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
    /** @scenario "Rapid SSE events are coalesced into a single refetch" */
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

      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });
      expect(refetchSpy).not.toHaveBeenCalled();

      // Past the debounce window, so the later event is free to fire at once
      // and the count below can only come from the flush.
      act(() => {
        vi.advanceTimersByTime(600);
      });

      mockIsVisible = true;
      act(() => {
        rerender();
      });
      expect(refetchSpy).toHaveBeenCalledTimes(1);

      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });

      expect(refetchSpy).toHaveBeenCalledTimes(2);
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
  describe("browser tab handoff", () => {
    const navigatePayload = (tabKey: string) => ({
      event: "scenario_tab_navigate",
      tabKey,
      url: "https://app.langwatch.ai/acme/simulations/checkout/batch-9",
    });

    /** @scenario "A simulations tab opened by the SDK registers itself" */
    it("offers this tab to the SDK when it carries a machine key", () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          tabKey: "machine-abc",
          tabId: "tab-1",
        }),
      );

      expect(capturedInput).toEqual({
        projectId: "proj_1",
        tabKey: "machine-abc",
        tabId: "tab-1",
      });
    });

    /** @scenario "A simulations tab without a scenario tab key never registers" */
    it("stays anonymous without a machine key", () => {
      renderHook(() => useSimulationUpdateListener({ projectId: "proj_1" }));

      expect(capturedInput).toEqual({ projectId: "proj_1" });
    });

    /** @scenario "The registered tab navigates to the handed-off run" */
    it("follows a run handed to this machine", () => {
      const onTabNavigate = vi.fn();

      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          tabKey: "machine-abc",
          tabId: "tab-1",
          onTabNavigate,
        }),
      );

      act(() => {
        capturedOnData?.({
          event: JSON.stringify(navigatePayload("machine-abc")),
        });
      });

      expect(onTabNavigate).toHaveBeenCalledWith(navigatePayload("machine-abc"));
    });

    /** @scenario "A navigate payload for another machine is ignored" */
    it("ignores a run handed to a different machine", () => {
      const onTabNavigate = vi.fn();

      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          tabKey: "machine-abc",
          tabId: "tab-1",
          onTabNavigate,
        }),
      );

      act(() => {
        capturedOnData?.({
          event: JSON.stringify(navigatePayload("machine-xyz")),
        });
      });

      expect(onTabNavigate).not.toHaveBeenCalled();
    });

    it("ignores handoffs entirely on a tab with no machine key", () => {
      const onTabNavigate = vi.fn();

      renderHook(() =>
        useSimulationUpdateListener({ projectId: "proj_1", onTabNavigate }),
      );

      act(() => {
        capturedOnData?.({
          event: JSON.stringify(navigatePayload("machine-abc")),
        });
      });

      expect(onTabNavigate).not.toHaveBeenCalled();
    });

    it("does not mistake a handoff for run data", () => {
      const onNewBatchRun = vi.fn();
      const refetch = vi.fn();

      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch,
          onNewBatchRun,
          debounceMs: 0,
          tabKey: "machine-abc",
          tabId: "tab-1",
          onTabNavigate: vi.fn(),
        }),
      );

      act(() => {
        capturedOnData?.({
          event: JSON.stringify(navigatePayload("machine-abc")),
        });
      });

      expect(onNewBatchRun).not.toHaveBeenCalled();
      expect(refetch).not.toHaveBeenCalled();
    });
  });
  describe("when a run finishes", () => {
    it("stamps the terminal status the event carried, after the refetch settles", async () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
        }),
      );

      await act(async () => {
        simulateSSEEvent({
          event: "simulation_updated",
          scenarioRunId: "run_1",
          status: "SUCCESS",
        });
        await vi.runAllTimersAsync();
      });

      // The refetch alone can read back the pre-terminal row, and finished is
      // the last event — nothing follows to correct it. The event's own status
      // is what closes that race.
      expect(mockInvalidateRunState).toHaveBeenCalledWith({
        scenarioRunId: "run_1",
      });
      expect(mockSetRunStateData).toHaveBeenCalledTimes(1);

      const updater = mockSetRunStateData.mock.calls[0]![1] as (
        previous: { status: string } | undefined,
      ) => { status: string } | undefined;

      // Upgrades a stale read...
      expect(updater({ status: "IN_PROGRESS" })).toEqual({ status: "SUCCESS" });
      // ...but never downgrades a settled one.
      expect(updater({ status: "CANCELLED" })).toEqual({ status: "CANCELLED" });
      expect(updater(undefined)).toBeUndefined();
    });

    it("withholds the stamp while the refetch is still in flight", async () => {
      // The test above cannot see the ordering it is named for: its invalidate
      // mock resolves immediately, so stamping before the refetch would pass it
      // just as well. Holding the promise open is what makes the order
      // observable — and the order is the fix, since a stamp applied first
      // would be overwritten by the refetch's own pre-terminal response.
      let settleRefetch: (() => void) | undefined;
      mockInvalidateRunState.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            settleRefetch = resolve;
          }),
      );

      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
        }),
      );

      await act(async () => {
        simulateSSEEvent({
          event: "simulation_updated",
          scenarioRunId: "run_1",
          status: "SUCCESS",
        });
        await vi.runAllTimersAsync();
      });

      expect(mockSetRunStateData).not.toHaveBeenCalled();

      await act(async () => {
        settleRefetch?.();
        await vi.runAllTimersAsync();
      });

      expect(mockSetRunStateData).toHaveBeenCalledTimes(1);
    });

    it("does not stamp anything for a non-terminal update", async () => {
      renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
        }),
      );

      await act(async () => {
        simulateSSEEvent({
          event: "simulation_updated",
          scenarioRunId: "run_1",
          status: "IN_PROGRESS",
        });
        await vi.runAllTimersAsync();
      });

      expect(mockSetRunStateData).not.toHaveBeenCalled();
    });
  });

  describe("when an update arrives while the tab is hidden", () => {
    it("defers it and flushes on return rather than dropping it", () => {
      mockIsVisible = false;
      const { rerender } = renderHook(() =>
        useSimulationUpdateListener({
          projectId: "proj_1",
          refetch: refetchSpy,
        }),
      );

      act(() => {
        simulateSSEEvent({ event: "simulation_updated" });
      });

      expect(refetchSpy).not.toHaveBeenCalled();

      mockIsVisible = true;
      act(() => {
        rerender();
      });

      // A dropped update is never retried: the broadcast has been and gone,
      // so without this the run stays "running" until a manual reload.
      expect(refetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
