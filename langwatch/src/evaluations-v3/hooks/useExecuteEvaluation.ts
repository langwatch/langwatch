import { useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import { toaster } from "~/components/ui/toaster";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";
import type { EvaluationV3Event, ExecutionScope, ExecutionRequest } from "~/server/evaluations-v3/execution/types";
import type { EvaluationResults } from "../types";
import { computeExecutionCells, createExecutionCellSet } from "../utils/executionScope";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";

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
   * Helper to update target output in the store.
   * Uses functional update to properly merge with existing state.
   */
  const updateTargetOutput = useCallback(
    (
      rowIndex: number,
      targetId: string,
      output: unknown,
      metadata?: { cost?: number; duration?: number; traceId?: string }
    ) => {
      // Use the store's setState directly for atomic updates
      useEvaluationsV3Store.setState((state) => {
        // Deep copy the target's array, or create new if doesn't exist
        const existingOutputs = state.results.targetOutputs[targetId] ?? [];
        const newOutputs = [...existingOutputs];
        newOutputs[rowIndex] = output;

        // Deep copy metadata if provided
        let newMetadata = state.results.targetMetadata;
        if (metadata) {
          const existingMeta = state.results.targetMetadata[targetId] ?? [];
          const newMeta = [...existingMeta];
          newMeta[rowIndex] = metadata;
          newMetadata = {
            ...state.results.targetMetadata,
            [targetId]: newMeta,
          };
        }

        // Remove this cell from executingCells since target output is now ready.
        // This allows the cell to display its output immediately while evaluators
        // continue running in the background (their chips show spinners independently).
        let newExecutingCells = state.results.executingCells;
        if (newExecutingCells) {
          const cellKey = `${rowIndex}:${targetId}`;
          if (newExecutingCells.has(cellKey)) {
            newExecutingCells = new Set(newExecutingCells);
            newExecutingCells.delete(cellKey);
            // If no cells remain, set to undefined
            if (newExecutingCells.size === 0) {
              newExecutingCells = undefined;
            }
          }
        }

        return {
          results: {
            ...state.results,
            targetOutputs: {
              ...state.results.targetOutputs,
              [targetId]: newOutputs,
            },
            targetMetadata: newMetadata,
            executingCells: newExecutingCells,
          },
        };
      });
    },
    []
  );

  /**
   * Helper to update target error in the store.
   */
  const updateTargetError = useCallback(
    (rowIndex: number, targetId: string, errorMsg: string) => {
      useEvaluationsV3Store.setState((state) => {
        const existingErrors = state.results.errors[targetId] ?? [];
        const newErrors = [...existingErrors];
        newErrors[rowIndex] = errorMsg;

        // Remove this cell from executingCells since we have a result (error).
        // Same logic as updateTargetOutput - the cell should show the error,
        // not a loading skeleton.
        let newExecutingCells = state.results.executingCells;
        if (newExecutingCells) {
          const cellKey = `${rowIndex}:${targetId}`;
          if (newExecutingCells.has(cellKey)) {
            newExecutingCells = new Set(newExecutingCells);
            newExecutingCells.delete(cellKey);
            if (newExecutingCells.size === 0) {
              newExecutingCells = undefined;
            }
          }
        }

        return {
          results: {
            ...state.results,
            errors: {
              ...state.results.errors,
              [targetId]: newErrors,
            },
            executingCells: newExecutingCells,
          },
        };
      });
    },
    []
  );

  /**
   * Helper to update evaluator result in the store.
   */
  const updateEvaluatorResult = useCallback(
    (rowIndex: number, targetId: string, evaluatorId: string, result: unknown) => {
      useEvaluationsV3Store.setState((state) => {
        const existingTargetResults = state.results.evaluatorResults[targetId] ?? {};
        const existingEvalResults = existingTargetResults[evaluatorId] ?? [];
        const newEvalResults = [...existingEvalResults];
        newEvalResults[rowIndex] = result;

        return {
          results: {
            ...state.results,
            evaluatorResults: {
              ...state.results.evaluatorResults,
              [targetId]: {
                ...existingTargetResults,
                [evaluatorId]: newEvalResults,
              },
            },
          },
        };
      });
    },
    []
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
          // Note: executingCells will be cleared by the execute function's cleanup
          break;

        case "done":
          setStatus("completed");
          // Note: executingCells will be cleared by the execute function's cleanup
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

      // Compute which cells will be executed (single source of truth)
      const datasetRows = activeDataset.inline?.records
        ? transposeColumnsFirstToRowsFirstWithId(activeDataset.inline.records)
        : activeDataset.savedRecords ?? [];
      
      const executionCells = computeExecutionCells({
        scope,
        targetIds: targets.map((t) => t.id),
        datasetRows,
      });
      const executingCellsSet = createExecutionCellSet(executionCells);

      // Set progress based on actual cells to execute
      setProgress({ completed: 0, total: executionCells.length });

      // For full execution, clear all results
      // For partial execution, preserve existing results AND merge executingCells
      const isFullExecution = scope.type === "full";

      if (isFullExecution) {
        // Clear all results and set to running
        setResults({
          status: "running",
          executingCells: executingCellsSet,
          progress: 0,
          total: executionCells.length,
          targetOutputs: {},
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        });
      } else {
        // Partial execution: merge new executingCells with any existing ones
        // This allows running multiple targets/cells concurrently
        useEvaluationsV3Store.setState((state) => {
          const existingCells = state.results.executingCells;
          const mergedCells = existingCells
            ? new Set([...existingCells, ...executingCellsSet])
            : executingCellsSet;

          return {
            results: {
              ...state.results,
              status: "running",
              executingCells: mergedCells,
              // Note: progress/total are per-execution, not merged
              // The UI should derive progress from executingCells + actual results
            },
          };
        });
      }

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

      // Helper to remove this execution's cells from executingCells when done
      const cleanupExecutingCells = () => {
        useEvaluationsV3Store.setState((state) => {
          if (!state.results.executingCells) return state;

          // Remove only the cells from THIS execution
          const remainingCells = new Set(
            [...state.results.executingCells].filter(
              (cellKey) => !executingCellsSet.has(cellKey)
            )
          );

          // If no cells remain, set to undefined and status to idle/success
          const hasRemainingCells = remainingCells.size > 0;

          return {
            results: {
              ...state.results,
              executingCells: hasRemainingCells ? remainingCells : undefined,
              status: hasRemainingCells ? state.results.status : "success",
            },
          };
        });
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
            setError(err.message);
            cleanupExecutingCells();
            toaster.create({
              title: "Execution Failed",
              description: err.message,
              type: "error",
            });
          },
        });

        // Clean up this execution's cells when SSE completes
        cleanupExecutingCells();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setStatus("error");
        setError(message);
        cleanupExecutingCells();
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
