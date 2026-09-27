import { describeError, showErrorToast } from "@langwatch/browser-host/errors";
import { fetchSSE } from "@langwatch/browser-host/fetch-sse";
import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import {
  type CellId,
  type EvaluationV3Event,
  type ExecutionScope,
  UNNAMED_FAILURE,
  buildExecutionRequest,
  createExecutionCellSet,
} from "@langwatch/experiment-contract";
import type { SerializedHandledError } from "@langwatch/handled-error";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  producedRowsOf,
  resultsAfterRun,
  resultsBeforePartialRun,
} from "../../model/experiments-v3/execution/execution-cells.ts";
import {
  applyEvaluatorResult,
  applyTargetError,
  applyTargetOutput,
} from "../../model/experiments-v3/execution/results-fold.ts";
import type { EvaluationsV3Store } from "../../model/experiments-v3/types.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";

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
 */
const asHandledEnvelope = (event: { domainError?: SerializedHandledError; traceId?: string }) => ({
  data: { error: event.domainError, traceId: event.traceId },
});

/** Write one target's output into the store. */
const writeTargetOutput = ({
  rowIndex,
  targetId,
  output,
  metadata,
}: {
  rowIndex: number;
  targetId: string;
  output: unknown;
  metadata?: { cost?: number; duration?: number; traceId?: string };
}): void => {
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
};

/** Write one target's failure into the store. */
const writeTargetError = ({
  rowIndex,
  targetId,
  errorMsg,
  domainError,
}: {
  rowIndex: number;
  targetId: string;
  errorMsg: string;
  domainError?: SerializedHandledError;
}): void => {
  useEvaluationsV3Store.setState((state) => ({
    results: applyTargetError({
      results: state.results,
      rowIndex,
      targetId,
      error: errorMsg,
      domainError,
    }),
  }));
};

/** Write one evaluator's result into the store. */
const writeEvaluatorResult = ({
  rowIndex,
  targetId,
  evaluatorId,
  result,
}: {
  rowIndex: number;
  targetId: string;
  evaluatorId: string;
  result: unknown;
}): void => {
  useEvaluationsV3Store.setState((state) => ({
    results: applyEvaluatorResult({
      results: state.results,
      rowIndex,
      targetId,
      evaluatorId,
      result,
    }),
  }));
};

/** The hook state an execution's events and failures write to. */
type ExecutionSink = {
  setRunId: (runId: string | null) => void;
  setProgress: (progress: { completed: number; total: number }) => void;
  addCost: (cost: number) => void;
  setError: (error: string | null) => void;
  setStatus: (status: ExecutionStatus) => void;
  setIsAborting: (isAborting: boolean) => void;
  setResults: EvaluationsV3Store["setResults"];
};

type EventOf<Type extends EvaluationV3Event["type"]> = Extract<EvaluationV3Event, { type: Type }>;

/**
 * A target's result: the code and the engine's raw string side by side when it
 * failed (the cell shows the registry's copy, never the raw string as headline).
 */
const onTargetResult = (event: EventOf<"target_result">, sink: ExecutionSink): void => {
  if (event.domainError ?? event.error) {
    writeTargetError({
      rowIndex: event.rowIndex,
      targetId: event.targetId,
      errorMsg: event.error ?? UNNAMED_FAILURE,
      domainError: event.domainError,
    });
  } else {
    writeTargetOutput({
      rowIndex: event.rowIndex,
      targetId: event.targetId,
      output: event.output,
      metadata: { cost: event.cost, duration: event.duration, traceId: event.traceId },
    });
  }
  if (event.cost) sink.addCost(event.cost);
};

/**
 * An error frame: a handled code or the unnamed-failure marker. A row's error
 * lands in its evaluator or target cell; anything else fails the run, toasted
 * through `showErrorToast` so the trace id is the copyable error id.
 */
const onErrorEvent = (event: EventOf<"error">, sink: ExecutionSink): void => {
  const envelope = asHandledEnvelope(event);
  const detail = describeError({
    error: envelope,
    fallbackTitle:
      event.rowIndex === undefined
        ? "The evaluation couldn't be completed"
        : "This row couldn't be run",
  });

  if (event.rowIndex === undefined || !event.targetId) {
    sink.setError(detail);
    sink.setResults({ status: "error" });
    showErrorToast({ error: envelope, fallbackTitle: "Couldn't finish the evaluation" });
    return;
  }
  if (event.evaluatorId) {
    writeEvaluatorResult({
      rowIndex: event.rowIndex,
      targetId: event.targetId,
      evaluatorId: event.evaluatorId,
      result: {
        status: "error",
        error_type: "EvaluatorError",
        details: detail,
        traceback: [],
        ...(event.domainError ? { domainError: event.domainError } : {}),
      },
    });
    return;
  }
  // Target error: the code, not the sentence it renders as.
  writeTargetError({
    rowIndex: event.rowIndex,
    targetId: event.targetId,
    errorMsg: event.message,
    domainError: event.domainError,
  });
};

/**
 * Fold one SSE event into the hook and the store. `stopped` and `done` never
 * clear executingCells/runningEvaluators: `resultsAfterRun` removes only this
 * execution's, so concurrent executions keep theirs.
 */
const applyExecutionEvent = (event: EvaluationV3Event, sink: ExecutionSink): void => {
  switch (event.type) {
    case "execution_started":
      sink.setRunId(event.runId);
      // This page owns the run now, so its own write-back bump is not a stranger's.
      useEvaluationsV3Store.getState().rememberRunStartedHere(event.runId);
      sink.setProgress({ completed: 0, total: event.total });
      sink.setResults({ runId: event.runId, status: "running", progress: 0, total: event.total });
      return;
    case "target_result":
      onTargetResult(event, sink);
      return;
    case "evaluator_result":
      writeEvaluatorResult({
        rowIndex: event.rowIndex,
        targetId: event.targetId,
        evaluatorId: event.evaluatorId,
        result: event.result,
      });
      return;
    case "progress":
      sink.setProgress({ completed: event.completed, total: event.total });
      sink.setResults({ progress: event.completed, total: event.total });
      return;
    case "error":
      onErrorEvent(event, sink);
      return;
    case "stopped":
      sink.setStatus("stopped");
      sink.setIsAborting(false);
      sink.setResults({ status: "stopped" });
      return;
    case "done":
      sink.setStatus("completed");
      sink.setIsAborting(false);
      sink.setResults({ status: "success" });
      return;
    default:
      return;
  }
};

/** A run that could not start or stream: its error in registry copy, never the wire message. */
const failExecution = ({ err, sink }: { err: unknown; sink: ExecutionSink }): void => {
  sink.setStatus("error");
  sink.setError(describeError({ error: err, fallbackTitle: "Couldn't run the evaluation" }));
  sink.setIsAborting(false);
};

const toastCannotExecute = (): void => {
  toaster.create({
    title: "Cannot execute",
    description: "No project or dataset selected",
    type: "error",
  });
};

/**
 * The results a run starts from: a full run clears everything; a partial run
 * keeps the rest and clears only its own cells (see `resultsBeforePartialRun`).
 */
const startRunResults = ({
  scope,
  executionCells,
  executingCells,
  setResults,
}: {
  scope: ExecutionScope;
  executionCells: CellId[];
  executingCells: Set<string>;
  setResults: EvaluationsV3Store["setResults"];
}): void => {
  if (scope.type === "full") {
    // A full run (not a cell or evaluator rerun) enables the History button.
    useEvaluationsV3Store.setState((state) => ({ ui: { ...state.ui, hasRunThisSession: true } }));
    setResults({
      status: "running",
      executingCells,
      progress: 0,
      total: executionCells.length,
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    });
    return;
  }
  useEvaluationsV3Store.setState((state) => ({
    results: resultsBeforePartialRun({
      results: state.results,
      evaluatorIds: state.evaluators.map((e) => e.id),
      scope,
      executionCells,
      executingCells,
    }),
  }));
};

/**
 * Ask the server to stop a run. `isAborting` stays true until the `stopped`
 * event arrives; a 404 means the run already finished, which is no failure.
 */
const requestAbort = async ({
  projectId,
  runId,
  setIsAborting,
}: {
  projectId: string;
  runId: string;
  setIsAborting: (isAborting: boolean) => void;
}): Promise<void> => {
  setIsAborting(true);
  try {
    const response = await fetch("/api/experiments/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, runId }),
    });
    if (response.status === 404) {
      setIsAborting(false);
      toaster.create({
        title: "Already finished",
        description: "The run completed on its own before the stop request reached the server.",
        type: "info",
      });
      return;
    }
    if (!response.ok) throw new Error("Failed to abort execution");
  } catch (err) {
    setIsAborting(false);
    showErrorToast({ error: err, fallbackTitle: "Couldn't stop the run" });
  }
};

/**
 * Stream one execution's events into the hook and store, then release only
 * this execution's cells, so concurrent executions keep theirs.
 */
const streamExecution = async ({
  request,
  executingCells,
  sink,
  onRunStarted,
}: {
  request: NonNullable<ReturnType<typeof buildExecutionRequest>>["request"];
  executingCells: Set<string>;
  sink: ExecutionSink;
  onRunStarted?: (runId: string) => void;
}): Promise<void> => {
  const release = () => {
    useEvaluationsV3Store.setState((state) => ({
      results: resultsAfterRun({ results: state.results, executingCells }),
    }));
  };
  try {
    await fetchSSE<EvaluationV3Event>({
      endpoint: "/api/experiments/execute",
      payload: request,
      onEvent: (event) => {
        // Before the fold, so a caller waiting on the id hears it as soon as it exists.
        if (event.type === "execution_started") onRunStarted?.(event.runId);
        applyExecutionEvent(event, sink);
      },
      shouldStopProcessing: (event) => event.type === "done" || event.type === "stopped",
      timeout: 30_000, // 30s to connect
      chunkTimeout: 300_000, // 5min between events
      onError: (err) => {
        failExecution({ err, sink });
        release();
        showErrorToast({ error: err, fallbackTitle: "Couldn't run the evaluation" });
      },
    });
    release();
  } catch (err) {
    failExecution({ err, sink });
    release();
  }
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
  const activeDataset = datasets.find((d) => d.id === activeDatasetId) ?? datasets[0];

  // Stable across renders, so `execute` keeps its identity like the setters it wraps.
  const sink = useMemo<ExecutionSink>(
    () => ({
      setRunId,
      setProgress,
      addCost: (cost) => setTotalCost((prev) => prev + cost),
      setError,
      setStatus,
      setIsAborting,
      setResults,
    }),
    [setResults],
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
        toastCannotExecute();
        return;
      }

      // Reset state
      setStatus("running");
      setError(null);
      setTotalCost(0);

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
        toastCannotExecute();
        return;
      }
      const { request, executionCells } = built;
      const executingCellsSet = createExecutionCellSet(executionCells);

      // Set progress based on actual cells to execute
      setProgress({ completed: 0, total: executionCells.length });

      startRunResults({ scope, executionCells, executingCells: executingCellsSet, setResults });

      await streamExecution({
        request,
        executingCells: executingCellsSet,
        sink,
        onRunStarted: options?.onRunStarted,
      });
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
      sink,
      setResults,
    ],
  );

  /**
   * Request abort
   * Sets isAborting=true which remains true until the `stopped` SSE event is received.
   */
  const abort = useCallback(async () => {
    if (!project?.id || !runId) return;
    await requestAbort({ projectId: project.id, runId, setIsAborting });
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
      writeEvaluatorResult({ rowIndex, targetId, evaluatorId, result: { status: "running" } });

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
    [execute],
  );

  /**
   * Run an evaluator on all rows that have existing target outputs.
   * Builds a map of pre-computed outputs and trace IDs, then executes via
   * the evaluator-all-rows scope.
   */
  const runEvaluatorOnAllRows = useCallback(
    async (targetId: string, evaluatorId: string) => {
      const state = useEvaluationsV3Store.getState();
      const { precomputedTargetOutputs, traceIds } = producedRowsOf({
        targetOutputs: state.results.targetOutputs[targetId] ?? [],
        targetMetadata: state.results.targetMetadata[targetId] ?? [],
      });

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
    [execute],
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
