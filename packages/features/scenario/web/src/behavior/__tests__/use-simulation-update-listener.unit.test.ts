/**
 * @vitest-environment jsdom
 *
 * @see specs/features/suites/real-time-run-updates.feature
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let capturedOnData: ((data: { event: string }) => void) | undefined;

vi.mock("@langwatch/trace-web/hooks/useSSESubscription", () => ({
  useSSESubscription: (
    _subscription: unknown,
    _input: Record<string, unknown>,
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
vi.mock("@langwatch/trace-web/hooks/usePageVisibility", () => ({
  usePageVisibility: () => mockIsVisible,
}));

const mockInvalidateRunState = vi.fn().mockResolvedValue(undefined);

vi.mock("../scenario-api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
        getSuiteRunData: { invalidate: vi.fn() },
        getRunState: {
          invalidate: mockInvalidateRunState,
          setData: vi.fn(),
        },
      },
    }),
    scenarios: {
      onSimulationUpdate: { useSubscription: vi.fn() },
    },
  },
}));

import { useSimulationUpdateListener } from "../use-simulation-update-listener";

function simulateSSEEvent(payload: { event: string }) {
  capturedOnData?.({ event: JSON.stringify(payload) });
}

describe("useSimulationUpdateListener()", () => {
  let refetchSpy: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    refetchSpy = vi.fn<() => void>();
    mockIsVisible = true;
    capturedOnData = undefined;
    mockInvalidateRunState.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("given no SSE event has fired recently", () => {
    describe("when an update arrives", () => {
      /** @scenario "First SSE event triggers immediate refetch" */
      it("fires refetch immediately without a debounce delay", () => {
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

        expect(refetchSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given an update has just fired", () => {
    describe("when more updates arrive inside the debounce window", () => {
      /** @scenario "Rapid SSE events are coalesced into a single refetch" */
      it("coalesces them into one additional refetch", () => {
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
        expect(refetchSpy).toHaveBeenCalledTimes(1);

        for (const _ of [0, 1, 2]) {
          act(() => {
            vi.advanceTimersByTime(100);
            simulateSSEEvent({ event: "simulation_updated" });
          });
        }

        expect(refetchSpy).toHaveBeenCalledTimes(1);

        act(() => {
          vi.advanceTimersByTime(500);
        });

        expect(refetchSpy).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a tab registered with a machine key", () => {
    const navigatePayload = (tabKey: string) => ({
      event: "scenario_tab_navigate",
      tabKey,
      url: "https://app.langwatch.ai/acme/simulations/checkout/batch-9",
    });

    describe("when a navigate payload names this machine", () => {
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
          simulateSSEEvent(navigatePayload("machine-abc"));
        });

        expect(onTabNavigate).toHaveBeenCalledWith(navigatePayload("machine-abc"));
      });
    });

    describe("when a navigate payload names a different machine", () => {
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
          simulateSSEEvent(navigatePayload("machine-xyz"));
        });

        expect(onTabNavigate).not.toHaveBeenCalled();
      });
    });
  });
});
