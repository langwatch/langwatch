/**
 * @vitest-environment jsdom
 *
 * Tests for useExecuteEvaluation hook.
 * Specifically tests the abort functionality and state synchronization.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

// Mock optimization_studio hooks to prevent circular dependency issues
vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  store: vi.fn(() => ({})),
  initialState: {},
  useWorkflowStore: vi.fn(() => ({})),
}));

import type { EvaluationV3Event } from "~/server/evaluations-v3/execution/types";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import { useEvaluationsV3Store } from "../useEvaluationsV3Store";
import { useExecuteEvaluation } from "../useExecuteEvaluation";

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

// Mock fetchSSE
vi.mock("~/utils/sse/fetchSSE", () => ({
  fetchSSE: vi.fn(),
}));

// Mock toaster
vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

const mockFetchSSE = fetchSSE as Mock;

// Mock global fetch for abort API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Setup the store with a minimal configured evaluation
 */
const setupStore = () => {
  useEvaluationsV3Store.setState({
    name: "Test Evaluation",
    experimentId: "exp-123",
    experimentSlug: "test-eval",
    datasets: [
      {
        id: "dataset-1",
        name: "Test Dataset",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
        inline: {
          columns: [{ id: "input", name: "input", type: "string" }],
          records: { input: ["Hello", "World"] },
        },
      },
    ],
    activeDatasetId: "dataset-1",
    targets: [
      {
        id: "target-1",
        name: "Test Target",
        type: "prompt",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "dataset-1": {
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "input",
            },
          },
        },
      },
    ],
    evaluators: [],
    results: {
      status: "idle",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    },
    ui: {
      selectedRows: new Set(),
      columnWidths: {},
      rowHeightMode: "compact",
      expandedCells: new Set(),
      hiddenColumns: new Set(),
      autosaveStatus: {
        evaluation: "idle",
        dataset: "idle",
      },
    },
  });
};

describe("useExecuteEvaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    // Reset store
    useEvaluationsV3Store.getState().reset();
  });

  describe("abort functionality", () => {
    it("calls abort API with correct runId after execution starts", async () => {
      setupStore();

      // Setup SSE mock that emits execution_started and then waits
      let resolveSSE: () => void;
      const ssePromise = new Promise<void>((resolve) => {
        resolveSSE = resolve;
      });

      mockFetchSSE.mockImplementation(
        async ({
          onEvent,
        }: {
          onEvent: (event: EvaluationV3Event) => void;
        }) => {
          // Emit execution_started with the runId
          onEvent({
            type: "execution_started",
            runId: "run-abc-123",
            total: 2,
          });

          // Wait for the promise to resolve (we'll resolve it after calling abort)
          await ssePromise;

          onEvent({ type: "stopped", reason: "user" });
        },
      );

      const { result } = renderHook(() => useExecuteEvaluation());

      // Start execution
      await act(async () => {
        void result.current.execute({ type: "full" });
        // Give React time to process the execution_started event
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Verify runId is captured in the hook state
      expect(result.current.runId).toBe("run-abc-123");

      // Now call abort
      await act(async () => {
        await result.current.abort();
      });

      // Verify abort API was called with the correct runId
      expect(mockFetch).toHaveBeenCalledWith("/api/evaluations/v3/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "test-project",
          runId: "run-abc-123",
        }),
      });

      // Cleanup: resolve the SSE promise
      resolveSSE!();
    });

    it("abort sends request with correct runId", async () => {
      setupStore();

      let sseOnEvent: (event: EvaluationV3Event) => void;
      let resolveSSE: () => void;
      const ssePromise = new Promise<void>((resolve) => {
        resolveSSE = resolve;
      });

      mockFetchSSE.mockImplementation(
        async ({
          onEvent,
        }: {
          onEvent: (event: EvaluationV3Event) => void;
        }) => {
          sseOnEvent = onEvent;
          await ssePromise;
        },
      );

      const { result } = renderHook(() => useExecuteEvaluation());

      // Start execution
      act(() => {
        void result.current.execute({ type: "full" });
      });

      // Simulate SSE sending execution_started
      act(() => {
        sseOnEvent({
          type: "execution_started",
          runId: "run-xyz-789",
          total: 2,
        });
      });

      // Call abort
      await act(async () => {
        await result.current.abort();
      });

      // Verify abort API was called with the correct runId
      const abortCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/evaluations/v3/abort",
      );
      expect(abortCall).toBeDefined();
      const body = JSON.parse(abortCall![1].body);
      expect(body.runId).toBe("run-xyz-789");

      // Cleanup
      resolveSSE!();
    });

    it("updates store status to stopped when stopped event received", async () => {
      setupStore();

      let sseOnEvent: (event: EvaluationV3Event) => void;

      mockFetchSSE.mockImplementation(
        async ({
          onEvent,
        }: {
          onEvent: (event: EvaluationV3Event) => void;
        }) => {
          sseOnEvent = onEvent;
          // Don't resolve - let us control when events arrive
          // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional - promise that never resolves for test control
          await new Promise(() => {});
        },
      );

      const { result } = renderHook(() => useExecuteEvaluation());

      // Start execution
      act(() => {
        void result.current.execute({ type: "full" });
      });

      // Simulate execution_started
      act(() => {
        sseOnEvent({ type: "execution_started", runId: "run-123", total: 2 });
      });

      // Verify store status is running
      expect(useEvaluationsV3Store.getState().results.status).toBe("running");

      // Simulate stopped event (what happens when abort succeeds)
      act(() => {
        sseOnEvent({ type: "stopped", reason: "user" });
      });

      // Verify hook status is stopped
      expect(result.current.status).toBe("stopped");

      // Verify store status is also stopped (this was the bug!)
      expect(useEvaluationsV3Store.getState().results.status).toBe("stopped");

      // Verify executingCells is cleared
      expect(
        useEvaluationsV3Store.getState().results.executingCells,
      ).toBeUndefined();
    });

    it("isAborting stays true until stopped event is received", async () => {
      setupStore();

      let sseOnEvent: (event: EvaluationV3Event) => void;

      mockFetchSSE.mockImplementation(
        async ({
          onEvent,
        }: {
          onEvent: (event: EvaluationV3Event) => void;
        }) => {
          sseOnEvent = onEvent;
          // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional - promise that never resolves for test control
          await new Promise(() => {});
        },
      );

      const { result } = renderHook(() => useExecuteEvaluation());

      // Initially not aborting
      expect(result.current.isAborting).toBe(false);

      // Start execution
      act(() => {
        void result.current.execute({ type: "full" });
      });

      // Simulate execution_started
      act(() => {
        sseOnEvent({ type: "execution_started", runId: "run-123", total: 2 });
      });

      // Call abort - this sets isAborting=true and sends API request
      await act(async () => {
        await result.current.abort();
      });

      // isAborting should stay true (API returned but we're waiting for stopped event)
      expect(result.current.isAborting).toBe(true);

      // Simulate stopped event from backend
      act(() => {
        sseOnEvent({ type: "stopped", reason: "user" });
      });

      // Now isAborting should be false
      expect(result.current.isAborting).toBe(false);
    });

    it("updates store status to success when done event received", async () => {
      setupStore();

      let sseOnEvent: (event: EvaluationV3Event) => void;

      mockFetchSSE.mockImplementation(
        async ({
          onEvent,
        }: {
          onEvent: (event: EvaluationV3Event) => void;
        }) => {
          sseOnEvent = onEvent;
          // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional - promise that never resolves for test control
          await new Promise(() => {});
        },
      );

      const { result } = renderHook(() => useExecuteEvaluation());

      // Start execution
      act(() => {
        void result.current.execute({ type: "full" });
      });

      // Simulate execution_started
      act(() => {
        sseOnEvent({ type: "execution_started", runId: "run-123", total: 2 });
      });

      // Simulate done event
      act(() => {
        sseOnEvent({
          type: "done",
          summary: {
            runId: "run-123",
            totalCells: 2,
            completedCells: 2,
            failedCells: 0,
            duration: 1000,
            timestamps: {
              startedAt: Date.now() - 1000,
              finishedAt: Date.now(),
            },
          },
        });
      });

      // Verify hook status is completed
      expect(result.current.status).toBe("completed");

      // Verify store status is success
      expect(useEvaluationsV3Store.getState().results.status).toBe("success");

      // Verify executingCells is cleared
      expect(
        useEvaluationsV3Store.getState().results.executingCells,
      ).toBeUndefined();
    });

    it("abort does nothing when no execution is running", async () => {
      setupStore();

      const { result } = renderHook(() => useExecuteEvaluation());

      // Call abort without starting execution
      await act(async () => {
        await result.current.abort();
      });

      // Abort API should NOT have been called (no runId)
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
