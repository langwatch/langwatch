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
      concurrency: 10,
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
      let resolveSSE: (() => void) | null = null;

      mockFetchSSE.mockImplementation(
        async ({
          onEvent,
          shouldStopProcessing,
        }: {
          onEvent: (event: EvaluationV3Event) => void;
          shouldStopProcessing?: (event: EvaluationV3Event) => boolean;
        }) => {
          sseOnEvent = (event: EvaluationV3Event) => {
            onEvent(event);
            // Resolve when shouldStopProcessing returns true (simulates real fetchSSE behavior)
            if (shouldStopProcessing?.(event)) {
              resolveSSE?.();
            }
          };
          await new Promise<void>((resolve) => {
            resolveSSE = resolve;
          });
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
      // This will also resolve the SSE promise, triggering cleanup
      act(() => {
        sseOnEvent({ type: "stopped", reason: "user" });
      });

      // Wait for cleanup to complete
      await waitFor(() => {
        expect(result.current.status).toBe("stopped");
      });

      // Verify store status is also stopped
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
      let resolveSSE: (() => void) | null = null;

      mockFetchSSE.mockImplementation(
        async ({
          onEvent,
          shouldStopProcessing,
        }: {
          onEvent: (event: EvaluationV3Event) => void;
          shouldStopProcessing?: (event: EvaluationV3Event) => boolean;
        }) => {
          sseOnEvent = (event: EvaluationV3Event) => {
            onEvent(event);
            // Resolve when shouldStopProcessing returns true (simulates real fetchSSE behavior)
            if (shouldStopProcessing?.(event)) {
              resolveSSE?.();
            }
          };
          await new Promise<void>((resolve) => {
            resolveSSE = resolve;
          });
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

      // Simulate done event - this will also resolve SSE and trigger cleanup
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

      // Wait for cleanup to complete
      await waitFor(() => {
        expect(result.current.status).toBe("completed");
      });

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

    it("passes concurrency setting from store to execution request", async () => {
      setupStore();

      // Set a custom concurrency value
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        ui: { ...state.ui, concurrency: 25 },
      }));

      let capturedPayload: Record<string, unknown> | undefined;
      mockFetchSSE.mockImplementation(async ({ payload }) => {
        capturedPayload = payload;
        // Don't resolve - we just want to capture the request
        await new Promise(() => {});
      });

      const { result } = renderHook(() => useExecuteEvaluation());

      // Start execution
      act(() => {
        void result.current.execute({ type: "full" });
      });

      // Verify the request included the concurrency setting
      expect(capturedPayload).toBeDefined();
      expect(capturedPayload?.concurrency).toBe(25);
    });
  });

  describe("rerunEvaluator functionality", () => {
    it("sets evaluator result to running state immediately for UI feedback", async () => {
      setupStore();

      // Add an evaluator to the store
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            settings: {},
            inputs: [],
            mappings: {},
          },
        ],
        results: {
          ...state.results,
          // Pre-populate with existing target output (so we can rerun)
          targetOutputs: {
            "target-1": [{ output: "Hello World" }, { output: "Goodbye" }],
          },
          // Pre-populate with existing evaluator result
          evaluatorResults: {
            "target-1": {
              "eval-1": [
                { status: "processed", passed: true, score: 1 },
                { status: "processed", passed: false, score: 0 },
              ],
            },
          },
        },
      }));

      // Setup SSE mock that waits before completing
      let resolveSSE: () => void;
      const ssePromise = new Promise<void>((resolve) => {
        resolveSSE = resolve;
      });

      mockFetchSSE.mockImplementation(async () => {
        await ssePromise;
      });

      const { result } = renderHook(() => useExecuteEvaluation());

      // Verify initial state - evaluator has a completed result
      const initialResult =
        useEvaluationsV3Store.getState().results.evaluatorResults["target-1"]?.[
          "eval-1"
        ]?.[0];
      expect(initialResult).toEqual({
        status: "processed",
        passed: true,
        score: 1,
      });

      // Call rerunEvaluator
      act(() => {
        void result.current.rerunEvaluator(0, "target-1", "eval-1");
      });

      // IMMEDIATELY after calling rerunEvaluator, the evaluator should be in running state
      // This provides instant UI feedback before the SSE even starts
      await waitFor(() => {
        const runningResult =
          useEvaluationsV3Store.getState().results.evaluatorResults[
            "target-1"
          ]?.["eval-1"]?.[0];
        expect(runningResult).toEqual({ status: "running" });
      });

      // Cleanup: resolve the SSE promise
      resolveSSE!();
    });

    it("passes existing target output to avoid re-running target", async () => {
      setupStore();

      // Add an evaluator and target output
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            settings: {},
            inputs: [],
            mappings: {},
          },
        ],
        results: {
          ...state.results,
          targetOutputs: {
            "target-1": [{ output: "Hello World" }],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [{ status: "processed", passed: true, score: 1 }],
            },
          },
        },
      }));

      let capturedPayload: unknown;
      mockFetchSSE.mockImplementation(
        async ({ payload }: { payload: unknown }) => {
          capturedPayload = payload;
        },
      );

      const { result } = renderHook(() => useExecuteEvaluation());

      // Call rerunEvaluator
      await act(async () => {
        await result.current.rerunEvaluator(0, "target-1", "eval-1");
      });

      // Verify the scope includes targetOutput
      expect(capturedPayload).toBeDefined();
      const payload = capturedPayload as { scope: unknown };
      expect(payload.scope).toEqual({
        type: "evaluator",
        rowIndex: 0,
        targetId: "target-1",
        evaluatorId: "eval-1",
        targetOutput: { output: "Hello World" },
      });
    });

    it("updates evaluator result when evaluator_result event is received", async () => {
      setupStore();

      // Add an evaluator
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            settings: {},
            inputs: [],
            mappings: {},
          },
        ],
        results: {
          ...state.results,
          targetOutputs: {
            "target-1": [{ output: "Hello World" }],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [{ status: "processed", passed: true, score: 1 }],
            },
          },
        },
      }));

      let sseOnEvent: (event: EvaluationV3Event) => void;

      mockFetchSSE.mockImplementation(
        async ({
          onEvent,
        }: {
          onEvent: (event: EvaluationV3Event) => void;
        }) => {
          sseOnEvent = onEvent;
          await new Promise(() => {});
        },
      );

      const { result } = renderHook(() => useExecuteEvaluation());

      // Start rerun
      act(() => {
        void result.current.rerunEvaluator(0, "target-1", "eval-1");
      });

      // Verify evaluator is in running state
      await waitFor(() => {
        const runningResult =
          useEvaluationsV3Store.getState().results.evaluatorResults[
            "target-1"
          ]?.["eval-1"]?.[0];
        expect(runningResult).toEqual({ status: "running" });
      });

      // Simulate execution_started
      act(() => {
        sseOnEvent({ type: "execution_started", runId: "run-123", total: 1 });
      });

      // Simulate evaluator_result with new result
      act(() => {
        sseOnEvent({
          type: "evaluator_result",
          rowIndex: 0,
          targetId: "target-1",
          evaluatorId: "eval-1",
          result: { status: "processed", passed: false, score: 0.5 },
        });
      });

      // Verify evaluator result is updated
      const updatedResult =
        useEvaluationsV3Store.getState().results.evaluatorResults["target-1"]?.[
          "eval-1"
        ]?.[0];
      expect(updatedResult).toEqual({
        status: "processed",
        passed: false,
        score: 0.5,
      });
    });

    it("clears target outputs and evaluator results for partial execution (cell scope)", async () => {
      setupStore();

      // Add an evaluator and pre-populate results
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            settings: {},
            inputs: [],
            mappings: {},
          },
        ],
        results: {
          ...state.results,
          targetOutputs: {
            "target-1": [{ output: "Hello" }, { output: "World" }],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [
                { status: "processed", passed: true, score: 1 },
                { status: "processed", passed: false, score: 0 },
              ],
            },
          },
        },
      }));

      // Setup SSE mock
      mockFetchSSE.mockImplementation(async () => {
        // Don't resolve - we just want to verify state was cleared
        await new Promise(() => {});
      });

      const { result } = renderHook(() => useExecuteEvaluation());

      // Execute with cell scope (partial execution)
      act(() => {
        void result.current.execute({
          type: "cell",
          rowIndex: 0,
          targetId: "target-1",
        });
      });

      // Wait for state update
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        const targetOutputs = state.results.targetOutputs["target-1"];
        const evalResults =
          state.results.evaluatorResults["target-1"]?.["eval-1"];

        // Row 0 should be cleared (undefined) for both target outputs and evaluator results
        expect(targetOutputs?.[0]).toBeUndefined();
        expect(evalResults?.[0]).toBeUndefined();

        // Row 1 should still have its values
        expect(targetOutputs?.[1]).toEqual({ output: "World" });
        expect(evalResults?.[1]).toEqual({
          status: "processed",
          passed: false,
          score: 0,
        });
      });
    });

    it("clears target outputs and evaluator results for partial execution (rows scope)", async () => {
      setupStore();

      // Add an evaluator and pre-populate results for 3 rows
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            settings: {},
            inputs: [],
            mappings: {},
          },
        ],
        datasets: [
          {
            id: "dataset-1",
            name: "Test Dataset",
            type: "inline",
            columns: [{ id: "input", name: "input", type: "string" }],
            inline: {
              columns: [{ id: "input", name: "input", type: "string" }],
              records: { input: ["A", "B", "C"] },
            },
          },
        ],
        results: {
          ...state.results,
          targetOutputs: {
            "target-1": [{ output: "A" }, { output: "B" }, { output: "C" }],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [
                { status: "processed", passed: true, score: 1 },
                { status: "processed", passed: true, score: 1 },
                { status: "processed", passed: true, score: 1 },
              ],
            },
          },
        },
      }));

      // Setup SSE mock
      mockFetchSSE.mockImplementation(async () => {
        await new Promise(() => {});
      });

      const { result } = renderHook(() => useExecuteEvaluation());

      // Execute with rows scope (rows 0 and 2)
      act(() => {
        void result.current.execute({
          type: "rows",
          rowIndices: [0, 2],
        });
      });

      // Wait for state update
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        const targetOutputs = state.results.targetOutputs["target-1"];
        const evalResults =
          state.results.evaluatorResults["target-1"]?.["eval-1"];

        // Rows 0 and 2 should be cleared for both target outputs and evaluator results
        expect(targetOutputs?.[0]).toBeUndefined();
        expect(targetOutputs?.[2]).toBeUndefined();
        expect(evalResults?.[0]).toBeUndefined();
        expect(evalResults?.[2]).toBeUndefined();

        // Row 1 should still have its values
        expect(targetOutputs?.[1]).toEqual({ output: "B" });
        expect(evalResults?.[1]).toEqual({
          status: "processed",
          passed: true,
          score: 1,
        });
      });
    });

    it("clears errors for partial execution", async () => {
      setupStore();

      // Add an evaluator and pre-populate results with an error
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            settings: {},
            inputs: [],
            mappings: {},
          },
        ],
        results: {
          ...state.results,
          targetOutputs: {
            "target-1": [{ output: "Hello" }, { output: "World" }],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [
                { status: "error", details: "Some error" },
                { status: "processed", passed: true, score: 1 },
              ],
            },
          },
          // Pre-existing errors for both rows (array with holes)
          errors: {
            "target-1": ["Error in row 0", "Error in row 1"],
          },
        },
      }));

      // Setup SSE mock
      mockFetchSSE.mockImplementation(async () => {
        await new Promise(() => {});
      });

      const { result } = renderHook(() => useExecuteEvaluation());

      // Execute with cell scope (partial execution) for row 0 only
      act(() => {
        void result.current.execute({
          type: "cell",
          rowIndex: 0,
          targetId: "target-1",
        });
      });

      // Wait for state update
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        const errors = state.results.errors["target-1"];

        // Row 0 error should be cleared
        expect(errors?.[0]).toBeUndefined();
        // Row 1 error should still exist
        expect(errors?.[1]).toBe("Error in row 1");
      });
    });

    it("clears target metadata for partial execution", async () => {
      setupStore();

      // Add target metadata
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            settings: {},
            inputs: [],
            mappings: {},
          },
        ],
        results: {
          ...state.results,
          targetOutputs: {
            "target-1": [{ output: "Hello" }, { output: "World" }],
          },
          targetMetadata: {
            "target-1": [
              { cost: 0.01, latency: 100 },
              { cost: 0.02, latency: 200 },
            ],
          },
          evaluatorResults: {
            "target-1": {
              "eval-1": [
                { status: "processed", passed: true, score: 1 },
                { status: "processed", passed: true, score: 1 },
              ],
            },
          },
        },
      }));

      // Setup SSE mock
      mockFetchSSE.mockImplementation(async () => {
        await new Promise(() => {});
      });

      const { result } = renderHook(() => useExecuteEvaluation());

      // Execute with cell scope (partial execution) for row 0 only
      act(() => {
        void result.current.execute({
          type: "cell",
          rowIndex: 0,
          targetId: "target-1",
        });
      });

      // Wait for state update
      await waitFor(() => {
        const state = useEvaluationsV3Store.getState();
        const targetMetadata = state.results.targetMetadata["target-1"];

        // Row 0 metadata should be cleared
        expect(targetMetadata?.[0]).toBeUndefined();
        // Row 1 metadata should still exist
        expect(targetMetadata?.[1]).toEqual({ cost: 0.02, latency: 200 });
      });
    });
  });

  describe("Concurrent Execution", () => {
    /**
     * This tests that when two cells are executed concurrently,
     * completing one execution doesn't clear the other's state.
     *
     * Bug scenario:
     * 1. Start cell A execution
     * 2. Start cell B execution (while A is still running)
     * 3. Cell A receives "done" event
     * 4. Cell B should STILL show loading state (not cleared by A's done)
     */
    it("does not clear other execution's state when one concurrent execution completes", async () => {
      setupStore();

      // Add a second target for clarity
      useEvaluationsV3Store.setState((state) => ({
        ...state,
        evaluators: [
          {
            id: "eval-1",
            evaluatorType: "langevals/exact_match",
            inputs: [],
            mappings: {},
          },
        ],
        targets: [
          ...state.targets,
          {
            id: "target-2",
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
      }));

      // We'll track which execution's events we're handling
      let executionAOnEvent: ((event: EvaluationV3Event) => void) | null = null;
      let executionBOnEvent: ((event: EvaluationV3Event) => void) | null = null;
      let executionAResolve: (() => void) | null = null;
      let executionBResolve: (() => void) | null = null;
      let executionCount = 0;

      mockFetchSSE.mockImplementation(
        async ({ onEvent, shouldStopProcessing }) => {
          executionCount++;
          if (executionCount === 1) {
            executionAOnEvent = (event: EvaluationV3Event) => {
              onEvent(event);
              // Resolve when shouldStopProcessing returns true (simulating fetchSSE behavior)
              if (shouldStopProcessing?.(event)) {
                executionAResolve?.();
              }
            };
            await new Promise<void>((resolve) => {
              executionAResolve = resolve;
            });
          } else {
            executionBOnEvent = (event: EvaluationV3Event) => {
              onEvent(event);
              if (shouldStopProcessing?.(event)) {
                executionBResolve?.();
              }
            };
            await new Promise<void>((resolve) => {
              executionBResolve = resolve;
            });
          }
        },
      );

      const { result } = renderHook(() => useExecuteEvaluation());

      // Step 1: Start execution A (cell at row 0, target-1)
      act(() => {
        void result.current.execute({
          type: "cell",
          rowIndex: 0,
          targetId: "target-1",
        });
      });

      // Wait for execution A to start
      await waitFor(() => {
        expect(executionAOnEvent).not.toBeNull();
      });

      // Verify cell A is in executingCells
      let state = useEvaluationsV3Store.getState();
      expect(state.results.executingCells?.has("0:target-1")).toBe(true);

      // Step 2: Start execution B (cell at row 1, target-1) while A is still running
      act(() => {
        void result.current.execute({
          type: "cell",
          rowIndex: 1,
          targetId: "target-1",
        });
      });

      // Wait for execution B to start
      await waitFor(() => {
        expect(executionBOnEvent).not.toBeNull();
      });

      // Verify BOTH cells are in executingCells
      state = useEvaluationsV3Store.getState();
      expect(state.results.executingCells?.has("0:target-1")).toBe(true);
      expect(state.results.executingCells?.has("1:target-1")).toBe(true);

      // Step 3: Execution A receives events and completes
      act(() => {
        executionAOnEvent!({
          type: "execution_started",
          runId: "run-A",
          total: 1,
        });
        executionAOnEvent!({
          type: "target_result",
          rowIndex: 0,
          targetId: "target-1",
          output: "Output A",
        });
        executionAOnEvent!({
          type: "evaluator_result",
          rowIndex: 0,
          targetId: "target-1",
          evaluatorId: "eval-1",
          result: { status: "processed", passed: true, score: 1.0 },
        });
        executionAOnEvent!({ type: "done", summary: {} as any });
      });

      // Wait for A's events to be processed
      await waitFor(() => {
        const s = useEvaluationsV3Store.getState();
        return s.results.targetOutputs["target-1"]?.[0] === "Output A";
      });

      // CRITICAL: Execution B should STILL be in executingCells
      // This is the bug - the "done" event from A clears ALL executingCells
      state = useEvaluationsV3Store.getState();
      expect(state.results.executingCells?.has("1:target-1")).toBe(true);

      // Cell A should be removed from executingCells (it's done)
      expect(state.results.executingCells?.has("0:target-1")).toBe(false);

      // Cell B should still be loading (no output yet)
      expect(state.results.targetOutputs["target-1"]?.[1]).toBeUndefined();
    });
  });
});
