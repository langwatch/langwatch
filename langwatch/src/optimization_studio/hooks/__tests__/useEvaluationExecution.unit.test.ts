/**
 * @vitest-environment jsdom
 *
 * Unit tests for useEvaluationExecution hook.
 * Tests the timeout mechanism for evaluation execution.
 *
 * Acceptance criteria:
 * - When evaluation stays in "waiting" status past timeout, it transitions to error
 * - When evaluation transitions away from "waiting" before timeout, no error is set
 * - When stop evaluation stays in "running" status past timeout, it transitions to error
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const mockPostEvent = vi.fn();
const mockSetEvaluationState = vi.fn();
const mockSetOpenResultsPanelRequest = vi.fn();

let mockWorkflowState: any = {
  state: { evaluation: undefined },
  nodes: [],
};

const mockGetWorkflow = vi.fn(() => mockWorkflowState);

vi.mock("~/optimization_studio/hooks/usePostEvent", () => ({
  usePostEvent: () => ({
    postEvent: mockPostEvent,
    socketStatus: "connected",
  }),
}));

vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: any) =>
    selector({
      getWorkflow: mockGetWorkflow,
      setEvaluationState: mockSetEvaluationState,
      setOpenResultsPanelRequest: mockSetOpenResultsPanelRequest,
    }),
}));

vi.mock("~/optimization_studio/utils/mergeLocalConfigs", () => ({
  mergeLocalConfigsIntoDsl: (nodes: any) => nodes,
}));

vi.mock("../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import { useEvaluationExecution } from "../useEvaluationExecution";

describe("useEvaluationExecution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWorkflowState = {
      state: { evaluation: undefined },
      nodes: [],
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when evaluation stays in waiting status past timeout", () => {
    it("transitions to error state", () => {
      const { result } = renderHook(() => useEvaluationExecution());

      act(() => {
        result.current.startEvaluationExecution({
          workflow_version_id: "v1",
          evaluate_on: "full",
        });
      });

      // Capture the run_id from the setEvaluationState call
      const runId = mockSetEvaluationState.mock.calls[0]![0].run_id as string;

      // Simulate that the workflow state is still "waiting" when timeout fires
      mockWorkflowState = {
        state: {
          evaluation: {
            run_id: runId,
            status: "waiting",
          },
        },
        nodes: [],
      };

      // Advance past the 20s timeout
      act(() => {
        vi.advanceTimersByTime(20_000);
      });

      // Should have set error state
      expect(mockSetEvaluationState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "error",
          error: "Timeout",
        }),
      );
    });
  });

  describe("when evaluation transitions away from waiting before timeout", () => {
    it("does not set error state", () => {
      const { result } = renderHook(() => useEvaluationExecution());

      act(() => {
        result.current.startEvaluationExecution({
          workflow_version_id: "v1",
          evaluate_on: "full",
        });
      });

      const runId = mockSetEvaluationState.mock.calls[0]![0].run_id as string;

      // Simulate that the workflow transitioned to "running" before timeout
      mockWorkflowState = {
        state: {
          evaluation: {
            run_id: runId,
            status: "running",
          },
        },
        nodes: [],
      };

      mockSetEvaluationState.mockClear();

      act(() => {
        vi.advanceTimersByTime(20_000);
      });

      // Should NOT have set error state
      expect(mockSetEvaluationState).not.toHaveBeenCalled();
    });
  });

  describe("when stop evaluation stays in running status past timeout", () => {
    it("transitions to error state", () => {
      const { result } = renderHook(() => useEvaluationExecution());

      const runId = "run_test123";

      // Set workflow to running state
      mockWorkflowState = {
        state: {
          evaluation: {
            run_id: runId,
            status: "running",
          },
        },
        nodes: [],
      };

      act(() => {
        result.current.stopEvaluationExecution({ run_id: runId });
      });

      // Advance past 10s stop timeout
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(mockSetEvaluationState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "error",
          error: "Timeout",
        }),
      );
    });
  });
});
