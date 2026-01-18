import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";
import type {
  EvaluationV3Event,
  ExecutionRequest,
  ExecutionScope,
} from "~/server/evaluations-v3/execution/types";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import type { EvaluationResults } from "../types";
import {
  computeExecutionCells,
  createExecutionCellSet,
} from "../utils/executionScope";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

// ============================================================================
// Types
// ============================================================================

export type ExecutionStatus =
  | "idle"
  | "running"
  | "stopped"
  | "completed"
  | "error";

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
  /** Whether an abort request is in progress */
  isAborting: boolean;
  /** Start execution with given scope */
  execute: (scope?: ExecutionScope) => Promise<void>;
  /** Re-run a single evaluator for a specific cell, using existing target output */
  rerunEvaluator: (
    rowIndex: number,
    targetId: string,
    evaluatorId: string,
  ) => Promise<void>;
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
  const [isAborting, setIsAborting] = useState(false);

  // Get store state and actions
  const {
    experimentId,
    experimentSlug,
    name,
    datasets,
    activeDatasetId,
    targets,
    evaluators,
    concurrency,
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
      concurrency: state.ui.concurrency,
      setResults: state.setResults,
      clearResults: state.clearResults,
    })),
  );

  // Find active dataset
  const activeDataset =
    datasets.find((d) => d.id === activeDatasetId) ?? datasets[0];

  /**
   * Helper to update target output in the store.
   * Uses functional update to properly merge with existing state.
   * Also marks all evaluators for this cell as "running" since they start after target output.
   */
  const updateTargetOutput = useCallback(
    (
      rowIndex: number,
      targetId: string,
      output: unknown,
      metadata?: { cost?: number; duration?: number; traceId?: string },
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

        // Mark all evaluators for this cell as "running"
        // They will be removed when their results arrive
        const newRunningEvaluators = new Set(
          state.results.runningEvaluators ?? [],
        );
        for (const evaluator of state.evaluators) {
          newRunningEvaluators.add(`${rowIndex}:${targetId}:${evaluator.id}`);
        }

        return {
          results: {
            ...state.results,
            targetOutputs: {
              ...state.results.targetOutputs,
              [targetId]: newOutputs,
            },
            targetMetadata: newMetadata,
            runningEvaluators: newRunningEvaluators,
          },
        };
      });
    },
    [],
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

        // NOTE: We do NOT remove the cell from executingCells here.
        // The cell stays in executingCells until execution cleanup happens.
        // TargetCell's isLoading checks for both (cell in executingCells AND no output/error).

        return {
          results: {
            ...state.results,
            errors: {
              ...state.results.errors,
              [targetId]: newErrors,
            },
            // Keep executingCells unchanged
          },
        };
      });
    },
    [],
  );

  /**
   * Helper to update evaluator result in the store.
   * Also removes the evaluator from runningEvaluators since it has completed.
   */
  const updateEvaluatorResult = useCallback(
    (
      rowIndex: number,
      targetId: string,
      evaluatorId: string,
      result: unknown,
    ) => {
      useEvaluationsV3Store.setState((state) => {
        const existingTargetResults =
          state.results.evaluatorResults[targetId] ?? {};
        const existingEvalResults = existingTargetResults[evaluatorId] ?? [];
        const newEvalResults = [...existingEvalResults];
        newEvalResults[rowIndex] = result;

        // Remove this evaluator from runningEvaluators
        let newRunningEvaluators = state.results.runningEvaluators;
        if (newRunningEvaluators) {
          const evaluatorKey = `${rowIndex}:${targetId}:${evaluatorId}`;
          if (newRunningEvaluators.has(evaluatorKey)) {
            newRunningEvaluators = new Set(newRunningEvaluators);
            newRunningEvaluators.delete(evaluatorKey);
            if (newRunningEvaluators.size === 0) {
              newRunningEvaluators = undefined;
            }
          }
        }

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
            runningEvaluators: newRunningEvaluators,
          },
        };
      });
    },
    [],
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
            event.result,
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
              updateEvaluatorResult(
                event.rowIndex,
                event.targetId,
                event.evaluatorId,
                {
                  status: "error",
                  error_type: "EvaluatorError",
                  details: event.message,
                  traceback: [],
                },
              );
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
          setIsAborting(false); // Clear aborting state when stop is confirmed
          // Update store status immediately for UI feedback
          // NOTE: Don't clear executingCells/runningEvaluators here!
          // cleanupThisExecution() handles removing only THIS execution's state
          // to preserve concurrent executions.
          setResults({ status: "stopped" });
          break;

        case "done":
          setStatus("completed");
          setIsAborting(false); // Clear aborting state on completion too
          // Update store status immediately for UI feedback
          // NOTE: Don't clear executingCells/runningEvaluators here!
          // cleanupThisExecution() handles removing only THIS execution's state
          // to preserve concurrent executions.
          setResults({ status: "success" });
          break;
      }
    },
    [setResults, updateTargetOutput, updateTargetError, updateEvaluatorResult],
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
        : (activeDataset.savedRecords ?? []);

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
        // Partial execution: clear ALL data for cells being executed
        // This ensures the correct loading sequence:
        // 1. Gray (pending) - no data at all
        // 2. Spinner (running) - target output arrives, evaluators pending
        // 3. Final result - evaluator results arrive
        useEvaluationsV3Store.setState((state) => {
          const existingCells = state.results.executingCells;
          const mergedCells = existingCells
            ? new Set([...existingCells, ...executingCellsSet])
            : executingCellsSet;

          // Helper to clear a specific cell from an array-based record
          const clearCellFromArrayRecord = <T>(
            record: Record<string, (T | undefined | null)[]>,
            targetId: string,
            rowIndex: number,
          ): Record<string, (T | undefined | null)[]> => {
            const arr = record[targetId];
            if (!arr || arr[rowIndex] === undefined) return record;
            const newArr = [...arr];
            newArr[rowIndex] = undefined;
            return { ...record, [targetId]: newArr };
          };

          let newTargetOutputs = { ...state.results.targetOutputs };
          let newTargetMetadata = { ...state.results.targetMetadata };
          let newErrors = { ...state.results.errors };
          let newEvaluatorResults = { ...state.results.evaluatorResults };

          const evaluatorIds = state.evaluators.map((e) => e.id);

          for (const cell of executionCells) {
            // Clear target output
            newTargetOutputs = clearCellFromArrayRecord(
              newTargetOutputs,
              cell.targetId,
              cell.rowIndex,
            );

            // Clear target metadata
            newTargetMetadata = clearCellFromArrayRecord(
              newTargetMetadata,
              cell.targetId,
              cell.rowIndex,
            );

            // Clear errors (also array-based with holes)
            newErrors = clearCellFromArrayRecord(
              newErrors,
              cell.targetId,
              cell.rowIndex,
            );

            // Clear evaluator results for ALL evaluators
            if (!newEvaluatorResults[cell.targetId]) {
              newEvaluatorResults[cell.targetId] = {};
            }
            const newTargetResults = { ...newEvaluatorResults[cell.targetId] };
            for (const evaluatorId of evaluatorIds) {
              const evalResults = newTargetResults[evaluatorId];
              if (evalResults && evalResults[cell.rowIndex] !== undefined) {
                const newEvalResults = [...evalResults];
                newEvalResults[cell.rowIndex] = undefined;
                newTargetResults[evaluatorId] = newEvalResults;
              }
            }
            newEvaluatorResults[cell.targetId] = newTargetResults;
          }

          return {
            results: {
              ...state.results,
              status: "running",
              executingCells: mergedCells,
              targetOutputs: newTargetOutputs,
              targetMetadata: newTargetMetadata,
              errors: newErrors,
              evaluatorResults: newEvaluatorResults,
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
          inputs: e.inputs,
          mappings: e.mappings,
          dbEvaluatorId: e.dbEvaluatorId,
        })),
        scope,
        concurrency,
      };

      // Helper to remove this execution's cells and evaluators from state when done
      // This only removes state for THIS execution, preserving concurrent executions
      const cleanupThisExecution = () => {
        useEvaluationsV3Store.setState((state) => {
          // Remove only the cells from THIS execution
          let remainingCells: Set<string> | undefined = state.results
            .executingCells
            ? new Set(
                [...state.results.executingCells].filter(
                  (cellKey) => !executingCellsSet.has(cellKey),
                ),
              )
            : undefined;
          if (remainingCells?.size === 0) remainingCells = undefined;

          // Remove runningEvaluators for THIS execution's cells
          // Key format: "rowIndex:targetId:evaluatorId"
          let remainingEvaluators: Set<string> | undefined = state.results
            .runningEvaluators
            ? new Set(
                [...state.results.runningEvaluators].filter((evalKey) => {
                  // Extract rowIndex:targetId from the evaluator key
                  const parts = evalKey.split(":");
                  if (parts.length >= 2) {
                    const cellKey = `${parts[0]}:${parts[1]}`;
                    return !executingCellsSet.has(cellKey);
                  }
                  return true;
                }),
              )
            : undefined;
          if (remainingEvaluators?.size === 0) remainingEvaluators = undefined;

          // Determine if there's remaining work from other concurrent executions
          const hasRemainingWork =
            (remainingCells?.size ?? 0) > 0 ||
            (remainingEvaluators?.size ?? 0) > 0;

          // Determine the final status:
          // - If there's remaining work, keep current status
          // - If status was explicitly set to "stopped", keep it
          // - Otherwise, set to "success"
          const shouldKeepCurrentStatus =
            hasRemainingWork || state.results.status === "stopped";

          return {
            results: {
              ...state.results,
              executingCells: remainingCells,
              runningEvaluators: remainingEvaluators,
              status: shouldKeepCurrentStatus
                ? state.results.status
                : "success",
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
            setIsAborting(false); // Clear aborting state on error
            cleanupThisExecution();
            toaster.create({
              title: "Execution Failed",
              description: err.message,
              type: "error",
            });
          },
        });

        // Clean up this execution's cells when SSE completes
        cleanupThisExecution();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setStatus("error");
        setError(message);
        setIsAborting(false); // Clear aborting state on error
        cleanupThisExecution();
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
      concurrency,
      handleEvent,
      setResults,
    ],
  );

  /**
   * Request abort
   * Sets isAborting=true which remains true until the `stopped` SSE event is received.
   */
  const abort = useCallback(async () => {
    if (!project?.id || !runId) {
      return;
    }

    // Set aborting state - this stays true until we receive the `stopped` event
    setIsAborting(true);

    try {
      const response = await fetch("/api/evaluations/v3/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, runId }),
      });

      if (!response.ok) {
        throw new Error("Failed to abort execution");
        // Note: we don't setIsAborting(false) here - we wait for the `stopped` event
      }
    } catch (err) {
      // On error, reset aborting state since abort failed
      setIsAborting(false);
      const message = err instanceof Error ? err.message : "Failed to abort";
      toaster.create({
        title: "Abort Failed",
        description: message,
        type: "error",
      });
    }
    // Note: No finally block - isAborting stays true until `stopped` event
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
    setIsAborting(false);
    clearResults();
  }, [clearResults]);

  /**
   * Re-run a single evaluator for a specific cell.
   * Uses the existing target output to avoid re-running the target.
   */
  const rerunEvaluator = useCallback(
    async (rowIndex: number, targetId: string, evaluatorId: string) => {
      // Get the existing target output from the store
      const state = useEvaluationsV3Store.getState();
      const targetOutput = state.results.targetOutputs[targetId]?.[rowIndex];

      // Immediately set the evaluator result to "running" for UI feedback
      updateEvaluatorResult(rowIndex, targetId, evaluatorId, {
        status: "running",
      });

      // Build the evaluator scope with pre-computed target output
      const scope: ExecutionScope = {
        type: "evaluator",
        rowIndex,
        targetId,
        evaluatorId,
        // Pass target output if available so we don't re-run the target
        targetOutput,
      };

      await execute(scope);
    },
    [execute, updateEvaluatorResult],
  );

  return {
    status,
    runId,
    progress,
    totalCost,
    error,
    isAborting,
    execute,
    rerunEvaluator,
    abort,
    reset,
  };
};
