import { useState, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import { toaster } from "~/components/ui/toaster";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";
import type { EvaluationV3Event, ExecutionScope, ExecutionRequest } from "~/server/evaluations-v3/execution/types";
import type { EvaluationResults } from "../types";

// ============================================================================
// Types
// ============================================================================

export type ExecutionStatus = "idle" | "running" | "stopped" | "completed" | "error";

export type UseExecuteEvaluationReturn = {
  /** Current execution status */
  status: ExecutionStatus;
  /** Run ID of current or last execution */
  runId: string | null;
  /** Progress: completed cells / total cells */
  progress: { completed: number; total: number };
  /** Total cost of execution so far */
  totalCost: number;
  /** Error message if execution failed */
  error: string | null;
  /** Start execution with given scope */
  execute: (scope?: ExecutionScope) => Promise<void>;
  /** Request abort of current execution */
  abort: () => Promise<void>;
  /** Reset state to idle */
  reset: () => void;
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for managing evaluation execution.
 * Handles SSE streaming, state updates, and abort functionality.
 */
export const useExecuteEvaluation = (): UseExecuteEvaluationReturn => {
  const { project } = useOrganizationTeamProject();
  const [status, setStatus] = useState<ExecutionStatus>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [totalCost, setTotalCost] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Ref to track accumulated results during execution
  const resultsRef = useRef<{
    targetOutputs: Record<string, unknown[]>;
    targetMetadata: Record<string, Array<{ cost?: number; duration?: number; traceId?: string }>>;
    evaluatorResults: Record<string, Record<string, unknown[]>>;
    errors: Record<string, string[]>;
  }>({
    targetOutputs: {},
    targetMetadata: {},
    evaluatorResults: {},
    errors: {},
  });

  // Get store state and actions
  const {
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    targets,
    evaluators,
    results,
    setResults,
    clearResults,
  } = useEvaluationsV3Store(
    useShallow((state) => ({
      experimentId: state.experimentId,
      experimentSlug: state.experimentSlug,
      name: state.name,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      targets: state.targets,
      evaluators: state.evaluators,
      results: state.results,
      setResults: state.setResults,
      clearResults: state.clearResults,
    }))
  );

  // Find active dataset
  const activeDataset = datasets.find((d) => d.id === activeDatasetId) ?? datasets[0];

  /**
   * Helper to update target output in accumulated results
   */
  const updateTargetOutput = useCallback(
    (
      rowIndex: number,
      targetId: string,
      output: unknown,
      metadata?: { cost?: number; duration?: number; traceId?: string }
    ) => {
      const current = resultsRef.current;
      if (!current.targetOutputs[targetId]) {
        current.targetOutputs[targetId] = [];
      }
      current.targetOutputs[targetId]![rowIndex] = output;

      // Update metadata if provided
      if (metadata) {
        if (!current.targetMetadata[targetId]) {
          current.targetMetadata[targetId] = [];
        }
        current.targetMetadata[targetId]![rowIndex] = metadata;
      }

      // Update store
      setResults({
        targetOutputs: { ...current.targetOutputs },
        targetMetadata: { ...current.targetMetadata },
      });
    },
    [setResults]
  );

  /**
   * Helper to update target error in accumulated results
   */
  const updateTargetError = useCallback(
    (rowIndex: number, targetId: string, errorMsg: string) => {
      const current = resultsRef.current;
      if (!current.errors[targetId]) {
        current.errors[targetId] = [];
      }
      current.errors[targetId]![rowIndex] = errorMsg;

      // Update store
      setResults({
        errors: { ...current.errors },
      });
    },
    [setResults]
  );

  /**
   * Helper to update evaluator result in accumulated results
   */
  const updateEvaluatorResult = useCallback(
    (rowIndex: number, targetId: string, evaluatorId: string, result: unknown) => {
      const current = resultsRef.current;
      if (!current.evaluatorResults[targetId]) {
        current.evaluatorResults[targetId] = {};
      }
      if (!current.evaluatorResults[targetId]![evaluatorId]) {
        current.evaluatorResults[targetId]![evaluatorId] = [];
      }
      current.evaluatorResults[targetId]![evaluatorId]![rowIndex] = result;

      // Update store
      setResults({
        evaluatorResults: { ...current.evaluatorResults },
      });
    },
    [setResults]
  );

  /**
   * Handle incoming SSE events
   */
  const handleEvent = useCallback(
    (event: EvaluationV3Event) => {
      switch (event.type) {
        case "execution_started":
          setRunId(event.runId);
          setProgress({ completed: 0, total: event.total });
          setResults({
            runId: event.runId,
            status: "running",
            progress: 0,
            total: event.total,
          });
          break;

        case "cell_started":
          // Cell started - no state update needed yet
          break;

        case "target_result":
          if (event.error) {
            updateTargetError(event.rowIndex, event.targetId, event.error);
          } else {
            updateTargetOutput(event.rowIndex, event.targetId, event.output, {
              cost: event.cost,
              duration: event.duration,
              traceId: event.traceId,
            });
          }
          if (event.cost) {
            setTotalCost((prev) => prev + event.cost!);
          }
          break;

        case "evaluator_result":
          updateEvaluatorResult(
            event.rowIndex,
            event.targetId,
            event.evaluatorId,
            event.result
          );
          break;

        case "progress":
          setProgress({ completed: event.completed, total: event.total });
          setResults({
            progress: event.completed,
            total: event.total,
          });
          break;

        case "error":
          if (event.rowIndex !== undefined && event.targetId) {
            if (event.evaluatorId) {
              // Evaluator error
              updateEvaluatorResult(event.rowIndex, event.targetId, event.evaluatorId, {
                status: "error",
                error_type: "EvaluatorError",
                details: event.message,
                traceback: [],
              });
            } else {
              // Target error
              updateTargetError(event.rowIndex, event.targetId, event.message);
            }
          } else {
            // Fatal error
            setError(event.message);
            setResults({ status: "error" });
            toaster.create({
              title: "Execution Error",
              description: event.message,
              type: "error",
            });
          }
          break;

        case "stopped":
          setStatus("stopped");
          setResults({ status: "idle" }); // Reset to idle on stop
          break;

        case "done":
          setStatus("completed");
          setResults({ status: "success" });
          break;
      }
    },
    [
      setResults,
      updateTargetOutput,
      updateTargetError,
      updateEvaluatorResult,
    ]
  );

  /**
   * Start execution
   */
  const execute = useCallback(
    async (scope: ExecutionScope = { type: "full" }) => {
      if (!project?.id || !activeDataset) {
        toaster.create({
          title: "Cannot execute",
          description: "No project or dataset selected",
          type: "error",
        });
        return;
      }

      // Reset state
      setStatus("running");
      setError(null);
      setTotalCost(0);
      setProgress({ completed: 0, total: 0 });

      // Reset accumulated results
      resultsRef.current = {
        targetOutputs: {},
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
      };

      // Clear previous results and set to running
      setResults({
        status: "running",
        targetOutputs: {},
        targetMetadata: {},
        evaluatorResults: {},
        errors: {},
      });

      // Build dataset for request
      const datasetColumns = activeDataset.columns ?? [];

      // Build request payload
      const request: ExecutionRequest = {
        projectId: project.id,
        experimentId: experimentId ?? undefined,
        experimentSlug: experimentSlug ?? undefined,
        name: name || "Evaluation",
        dataset: {
          id: activeDataset.id,
          name: activeDataset.name,
          type: activeDataset.type ?? "inline",
          inline: activeDataset.inline,
          datasetId: activeDataset.datasetId,
          columns: datasetColumns,
          savedRecords: activeDataset.savedRecords,
        },
        targets: targets.map((t) => ({
          id: t.id,
          type: t.type,
          name: t.name,
          promptId: t.promptId,
          promptVersionId: t.promptVersionId,
          promptVersionNumber: t.promptVersionNumber,
          dbAgentId: t.dbAgentId,
          inputs: t.inputs,
          outputs: t.outputs,
          mappings: t.mappings,
          localPromptConfig: t.localPromptConfig,
        })),
        evaluators: evaluators.map((e) => ({
          id: e.id,
          evaluatorType: e.evaluatorType,
          name: e.name,
          settings: e.settings,
          inputs: e.inputs,
          mappings: e.mappings,
        })),
        scope,
      };

      try {
        await fetchSSE<EvaluationV3Event>({
          endpoint: "/api/evaluations/v3/execute",
          payload: request,
          onEvent: handleEvent,
          shouldStopProcessing: (event) =>
            event.type === "done" || event.type === "stopped",
          timeout: 30_000, // 30s to connect
          chunkTimeout: 300_000, // 5min between events
          onError: (err) => {
            setStatus("error");
            setResults({ status: "error" });
            setError(err.message);
            toaster.create({
              title: "Execution Failed",
              description: err.message,
              type: "error",
            });
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setStatus("error");
        setResults({ status: "error" });
        setError(message);
      }
    },
    [
      project?.id,
      activeDataset,
      experimentId,
      experimentSlug,
      name,
      targets,
      evaluators,
      handleEvent,
      setResults,
    ]
  );

  /**
   * Request abort
   */
  const abort = useCallback(async () => {
    if (!project?.id || !runId) return;

    try {
      const response = await fetch("/api/evaluations/v3/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, runId }),
      });

      if (!response.ok) {
        throw new Error("Failed to abort execution");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to abort";
      toaster.create({
        title: "Abort Failed",
        description: message,
        type: "error",
      });
    }
  }, [project?.id, runId]);

  /**
   * Reset to idle state
   */
  const reset = useCallback(() => {
    setStatus("idle");
    setRunId(null);
    setProgress({ completed: 0, total: 0 });
    setTotalCost(0);
    setError(null);
    resultsRef.current = {
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    };
    clearResults();
  }, [clearResults]);

  return {
    status,
    runId,
    progress,
    totalCost,
    error,
    execute,
    abort,
    reset,
  };
};
