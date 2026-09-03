import type { SerializedHandledError } from "@langwatch/handled-error";
import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { toaster } from "@langwatch/workflow-web/studio-host/toaster";
import { describeError, showErrorToast } from "@langwatch/workflow-web/studio-host/errors";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { transposeColumnsFirstToRowsFirstWithId } from "@langwatch/workflow-contract";
import {
  type EvaluationV3Event,
  type ExecutionScope,
  UNNAMED_FAILURE,
} from "@langwatch/experiment-contract";
import { fetchSSE } from "@langwatch/workflow-web/utils/sse/fetchSSE";
import { buildExecutionRequest } from "@langwatch/experiment-contract";
import {
  applyEvaluatorResult,
  applyTargetError,
  applyTargetOutput,
} from "../../model/experiments-v3/execution/results-fold";
import { createExecutionCellSet } from "@langwatch/experiment-contract";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store";

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
  /** Whether an abort request is in progress */
  isAborting: boolean;
  /**
   * Start execution with given scope.
   *
   * `onRunStarted` fires as soon as the run has an id, before any cell lands.
   * A caller that has to ANSWER with the run id (the assistant's UI action)
   * cannot wait for the whole run, and the id is only minted once the stream
   * opens.
   */
  execute: (
    scope?: ExecutionScope,
    options?: { onRunStarted?: (runId: string) => void },
  ) => Promise<void>;
  /** Re-run a single evaluator for a specific cell, using existing target output */
  rerunEvaluator: (rowIndex: number, targetId: string, evaluatorId: string) => Promise<void>;
  /** Run an evaluator on all rows that have existing target outputs */
  runEvaluatorOnAllRows: (targetId: string, evaluatorId: string) => Promise<void>;
  /** Request abort of current execution */
  abort: () => Promise<void>;
  /** Reset state to idle */
  reset: () => void;
};

/**
 * The SSE error frame, in the envelope the error layer already reads.
 *
 * `readHandledError` and `showErrorToast` take the tRPC shape — the handled
 * payload under `data.error`, the trace id beside it under `data.traceId` —
 * so presenting the frame's two fields under those names is all it takes to
 * get registry copy for a coded failure and, for one we couldn't name, the
 * generic unknown state PLUS the copyable error id (ADR-045). Without the
 * trace id that second case tells the customer, and support, nothing at all.
 */
const asHandledEnvelope = (event: { domainError?: SerializedHandledError; traceId?: string }) => ({
  data: { error: event.domainError, traceId: event.traceId },
});

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
  const activeDataset = datasets.find((d) => d.id === activeDatasetId) ?? datasets[0];

  /**
   * Write one target's output into the store.
   *
   * The fold itself is `execution/results-fold.ts`; what stays here is the store
   * write, so the same cell arithmetic can be run and asserted without a store.
   */
  const updateTargetOutput = useCallback(
    (
      rowIndex: number,
      targetId: string,
      output: unknown,
      metadata?: { cost?: number; duration?: number; traceId?: string },
    ) => {
      useEvaluationsV3Store.setState((state) => ({
        results: applyTargetOutput({
          results: state.results,
          rowIndex,
          targetId,
          output,
          metadata,
          evaluatorIds: state.evaluators.map((evaluator) => evaluator.id),
        }),
      }));
    },
    [],
  );

  /** Write one target's failure into the store. */
  const updateTargetError = useCallback(
    (
      rowIndex: number,
      targetId: string,
      errorMsg: string,
      domainError?: SerializedHandledError,
    ) => {
      useEvaluationsV3Store.setState((state) => ({
        results: applyTargetError({
          results: state.results,
          rowIndex,
          targetId,
          error: errorMsg,
          domainError,
        }),
      }));
    },
    [],
  );

  /** Write one evaluator's result into the store. */
  const updateEvaluatorResult = useCallback(
    (rowIndex: number, targetId: string, evaluatorId: string, result: unknown) => {
      useEvaluationsV3Store.setState((state) => ({
        results: applyEvaluatorResult({
          results: state.results,
          rowIndex,
          targetId,
          evaluatorId,
          result,
        }),
      }));
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
          // This page owns the run from here on. A run that writes its cells
          // back advances the saved version, and the page adopts that bump
          // rather than reading its own run's write as a stranger's.
          useEvaluationsV3Store.getState().rememberRunStartedHere(event.runId);
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
          if (event.domainError ?? event.error) {
            // The code and the engine's raw string, side by side. The cell
            // shows the registry's copy for the code and keeps the raw string
            // for whoever asks — never as the headline.
            updateTargetError(
              event.rowIndex,
              event.targetId,
              event.error ?? UNNAMED_FAILURE,
              event.domainError,
            );
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
          updateEvaluatorResult(event.rowIndex, event.targetId, event.evaluatorId, event.result);
          break;

        case "progress":
          setProgress({ completed: event.completed, total: event.total });
          setResults({
            progress: event.completed,
            total: event.total,
          });
          break;

        case "error": {
          // Every `error` frame is built by `mapThrownErrorEvent`: a handled
          // failure carries its code on `domainError`, an unhandled one carries
          // the unnamed-failure marker and a trace id, and neither carries the
          // thrown error's own words. So the words here are the client's:
          // registry copy for a code, our own fallback for a failure nobody
          // could name.
          const envelope = asHandledEnvelope(event);
          const detail = describeError({
            error: envelope,
            fallbackTitle:
              event.rowIndex === undefined
                ? "The evaluation couldn't be completed"
                : "This row couldn't be run",
          });

          if (event.rowIndex !== undefined && event.targetId) {
            if (event.evaluatorId) {
              // Evaluator error
              updateEvaluatorResult(event.rowIndex, event.targetId, event.evaluatorId, {
                status: "error",
                error_type: "EvaluatorError",
                details: detail,
                traceback: [],
                ...(event.domainError ? { domainError: event.domainError } : {}),
              });
            } else {
              // Target error — the code, not the sentence it renders as.
              updateTargetError(event.rowIndex, event.targetId, event.message, event.domainError);
            }
          } else {
            // Fatal error
            setError(detail);
            setResults({ status: "error" });
            // Through `showErrorToast` so the trace id becomes the copyable
            // error id in the toast. An unhandled failure tells the customer
            // nothing else, and "Something went wrong" with no id to quote
            // leaves support nothing to search on.
            showErrorToast({
              error: envelope,
              fallbackTitle: "Couldn't finish the evaluation",
            });
          }
          break;
        }

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
    async (
      scope: ExecutionScope = { type: "full" },
      options?: { onRunStarted?: (runId: string) => void },
    ) => {
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

      // Mark that we've run an evaluation this session (enables History button)
      // Only for full executions, not for cell/evaluator reruns
      if (scope.type === "full") {
        useEvaluationsV3Store.setState((state) => ({
          ui: { ...state.ui, hasRunThisSession: true },
        }));
      }

      // The request and the cells it covers, comparison dependencies included.
      // Built from state alone (`execution/build-execution-request.ts`) so a run
      // started here and a run started with no page attached cover the same
      // cells and seed the same outputs.
      const built = buildExecutionRequest({
        state: {
          name,
          datasets,
          activeDatasetId,
          targets,
          evaluators,
          experimentId: experimentId ?? undefined,
          experimentSlug: experimentSlug ?? undefined,
          results: useEvaluationsV3Store.getState().results,
        },
        projectId: project.id,
        scope,
        concurrency,
      });
      if (!built) {
        toaster.create({
          title: "Cannot execute",
          description: "No project or dataset selected",
          type: "error",
        });
        return;
      }
      const { request, executionCells } = built;
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
        // Partial execution: clear data for cells being executed.
        // For evaluator-only scopes, preserve target data and only clear the
        // specific evaluator's results. For other scopes, clear everything.
        const isEvaluatorOnlyScope =
          scope.type === "evaluator-all-rows" || scope.type === "evaluator";

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
          const newEvaluatorResults = { ...state.results.evaluatorResults };

          // For evaluator-only scopes, determine which single evaluator to clear
          const specificEvaluatorId =
            isEvaluatorOnlyScope && "evaluatorId" in scope ? scope.evaluatorId : undefined;

          const evaluatorIds = specificEvaluatorId
            ? [specificEvaluatorId]
            : state.evaluators.map((e) => e.id);

          for (const cell of executionCells) {
            // Only clear target data for non-evaluator scopes
            // (evaluator scopes reuse existing target outputs)
            if (!isEvaluatorOnlyScope) {
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
              newErrors = clearCellFromArrayRecord(newErrors, cell.targetId, cell.rowIndex);
            }

            // Clear evaluator results (only specific evaluator for evaluator scopes)
            // For evaluator-only scopes, set to "running" for UI feedback;
            // for other scopes, clear to undefined
            if (!newEvaluatorResults[cell.targetId]) {
              newEvaluatorResults[cell.targetId] = {};
            }
            const newTargetResults = { ...newEvaluatorResults[cell.targetId] };
            for (const evaluatorId of evaluatorIds) {
              const evalResults = newTargetResults[evaluatorId];
              if (isEvaluatorOnlyScope) {
                // Always set to "running" for evaluator scopes, even if no
                // prior results exist (freshly added evaluator)
                const newEvalResults = evalResults ? [...evalResults] : [];
                newEvalResults[cell.rowIndex] = { status: "running" };
                newTargetResults[evaluatorId] = newEvalResults;
              } else if (evalResults && evalResults[cell.rowIndex] !== undefined) {
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

      // Helper to remove this execution's cells and evaluators from state when done
      // This only removes state for THIS execution, preserving concurrent executions
      const cleanupThisExecution = () => {
        useEvaluationsV3Store.setState((state) => {
          // Remove only the cells from THIS execution
          let remainingCells: Set<string> | undefined = state.results.executingCells
            ? new Set(
                [...state.results.executingCells].filter(
                  (cellKey) => !executingCellsSet.has(cellKey),
                ),
              )
            : undefined;
          if (remainingCells?.size === 0) remainingCells = undefined;

          // Remove runningEvaluators for THIS execution's cells
          // Key format: "rowIndex:targetId:evaluatorId"
          let remainingEvaluators: Set<string> | undefined = state.results.runningEvaluators
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
            (remainingCells?.size ?? 0) > 0 || (remainingEvaluators?.size ?? 0) > 0;

          // Determine the final status:
          // - If there's remaining work, keep current status
          // - If status was explicitly set to "stopped", keep it
          // - Otherwise, set to "success"
          const shouldKeepCurrentStatus = hasRemainingWork || state.results.status === "stopped";

          return {
            results: {
              ...state.results,
              executingCells: remainingCells,
              runningEvaluators: remainingEvaluators,
              status: shouldKeepCurrentStatus ? state.results.status : "success",
            },
          };
        });
      };

      try {
        await fetchSSE<EvaluationV3Event>({
          endpoint: "/api/experiments/execute",
          payload: request,
          onEvent: (event) => {
            // Before the fold, so a caller waiting on the id is answered as
            // soon as the run has one rather than after the whole stream.
            if (event.type === "execution_started") {
              options?.onRunStarted?.(event.runId);
            }
            handleEvent(event);
          },
          shouldStopProcessing: (event) => event.type === "done" || event.type === "stopped",
          timeout: 30_000, // 30s to connect
          chunkTimeout: 300_000, // 5min between events
          onError: (err) => {
            setStatus("error");
            // `error` is exported hook state that ends up on screen, so it gets
            // the same treatment as the toast: registry copy, never the wire
            // message (which is the code slug for a handled failure).
            setError(
              describeError({
                error: err,
                fallbackTitle: "Couldn't run the evaluation",
              }),
            );
            setIsAborting(false); // Clear aborting state on error
            cleanupThisExecution();
            showErrorToast({
              error: err,
              fallbackTitle: "Couldn't run the evaluation",
            });
          },
        });

        // Clean up this execution's cells when SSE completes
        cleanupThisExecution();
      } catch (err) {
        setStatus("error");
        setError(
          describeError({
            error: err,
            fallbackTitle: "Couldn't run the evaluation",
          }),
        );
        setIsAborting(false); // Clear aborting state on error
        cleanupThisExecution();
      }
    },
    [
      project?.id,
      activeDataset,
      datasets,
      activeDatasetId,
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
      const response = await fetch("/api/experiments/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, runId }),
      });

      if (response.status === 404) {
        // Server says the run isn't running anymore — it finished (or
        // was already aborted) between the user's click and this request
        // landing. Not a failure: just inform the user and reset state.
        setIsAborting(false);
        toaster.create({
          title: "Already finished",
          description: "The run completed on its own before the stop request reached the server.",
          type: "info",
        });
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to abort execution");
        // Note: we don't setIsAborting(false) here - we wait for the `stopped` event
      }
    } catch (err) {
      // On error, reset aborting state since abort failed
      setIsAborting(false);
      showErrorToast({ error: err, fallbackTitle: "Couldn't stop the run" });
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
   * Reuses the existing trace ID to append the evaluator span to the same trace.
   */
  const rerunEvaluator = useCallback(
    async (rowIndex: number, targetId: string, evaluatorId: string) => {
      // Get the existing target output and trace ID from the store
      const state = useEvaluationsV3Store.getState();
      const targetOutput = state.results.targetOutputs[targetId]?.[rowIndex];
      const traceId = state.results.targetMetadata[targetId]?.[rowIndex]?.traceId;

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
        // Reuse existing trace ID to append evaluator span to the same trace
        traceId,
      };

      await execute(scope);
    },
    [execute, updateEvaluatorResult],
  );

  /**
   * Run an evaluator on all rows that have existing target outputs.
   * Builds a map of pre-computed outputs and trace IDs, then executes via
   * the evaluator-all-rows scope.
   */
  const runEvaluatorOnAllRows = useCallback(
    async (targetId: string, evaluatorId: string) => {
      const state = useEvaluationsV3Store.getState();
      const targetOutputs = state.results.targetOutputs[targetId] ?? [];
      const targetMetadata = state.results.targetMetadata[targetId] ?? [];

      // Build maps of only rows that have target outputs
      const precomputedTargetOutputs: Record<number, unknown> = {};
      const traceIds: Record<number, string | undefined> = {};

      for (let i = 0; i < targetOutputs.length; i++) {
        if (targetOutputs[i] !== undefined && targetOutputs[i] !== null) {
          precomputedTargetOutputs[i] = targetOutputs[i];
          traceIds[i] = targetMetadata[i]?.traceId;
        }
      }

      // Nothing to run if no rows have outputs
      if (Object.keys(precomputedTargetOutputs).length === 0) return;

      const scope: ExecutionScope = {
        type: "evaluator-all-rows",
        targetId,
        evaluatorId,
        precomputedTargetOutputs,
        traceIds,
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
    runEvaluatorOnAllRows,
    abort,
    reset,
  };
};
