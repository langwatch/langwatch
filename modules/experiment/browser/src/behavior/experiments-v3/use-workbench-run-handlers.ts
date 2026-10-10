/** The workbench's run controls: one target, row, cell or evaluator, and stop. */
import { useCallback } from "react";

import type { EvaluationResults } from "../../model/experiments-v3/types.ts";
import { useExecuteEvaluation } from "./use-execute-evaluation.ts";

export const useWorkbenchRunHandlers = (results: EvaluationResults) => {
  const { execute, abort, status, isAborting, rerunEvaluator, runEvaluatorOnAllRows } =
    useExecuteEvaluation();

  // Execution handlers for partial execution
  const handleRunTarget = useCallback(
    (targetId: string) => {
      void execute({ type: "target", targetId });
    },
    [execute],
  );

  const handleRunRow = useCallback(
    (rowIndex: number) => {
      void execute({ type: "rows", rowIndices: [rowIndex] });
    },
    [execute],
  );

  const handleRunCell = useCallback(
    (rowIndex: number, targetId: string) => {
      void execute({ type: "cell", rowIndex, targetId });
    },
    [execute],
  );

  // Handler for re-running a single evaluator
  const handleRerunEvaluator = useCallback(
    (rowIndex: number, targetId: string, evaluatorId: string) => {
      void rerunEvaluator(rowIndex, targetId, evaluatorId);
    },
    [rerunEvaluator],
  );

  // Handler for running an evaluator on all rows with target outputs
  const handleRunEvaluatorOnAllRows = useCallback(
    (targetId: string, evaluatorId: string) => {
      void runEvaluatorOnAllRows(targetId, evaluatorId);
    },
    [runEvaluatorOnAllRows],
  );

  // Check if any row has a target output for a given target
  const hasAnyTargetOutputs = useCallback(
    (targetId: string): boolean => {
      const outputs = results.targetOutputs[targetId];
      if (!outputs) return false;
      return outputs.some((output) => output !== undefined && output !== null);
    },
    [results.targetOutputs],
  );

  // Handler for stopping execution
  const handleStopExecution = useCallback(() => {
    void abort();
  }, [abort]);

  const isExecutionRunning = status === "running" || results.status === "running";

  return {
    execute,
    isAborting,
    handleRunTarget,
    handleRunRow,
    handleRunCell,
    handleRerunEvaluator,
    handleRunEvaluatorOnAllRows,
    hasAnyTargetOutputs,
    handleStopExecution,
    isExecutionRunning,
  };
};
