/**
 * The `EvaluationV3Event`s a cell emits for itself when it could not run.
 * Pure — no port, no class. Shared by the evaluator-input and cell-execution
 * services, which is why they live here rather than private to either.
 */

import { HandledError } from "@langwatch/handled-error";
import {
  type EvaluationV3Event,
  type EvaluatorConfig,
  EvaluatorNoInputsResolvedError,
  type ExecutionCell,
} from "@langwatch/experiment-contract";
import { AVAILABLE_EVALUATORS, type EvaluatorTypes } from "@langwatch/evaluator-contract";

/** The `error_type` a row carries when an evaluator resolved no input at all. */
export const NO_INPUTS_RESOLVED = "NoInputsResolved";

/** What the row calls the evaluator that could not run. */
export const evaluatorDisplayName = (evaluator: EvaluatorConfig): string =>
  AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes]?.name ?? evaluator.evaluatorType;

/** The error cell an evaluator that could not run reports for itself. */
export const evaluatorErrorResult = ({
  cell,
  evaluatorId,
  error,
}: {
  cell: ExecutionCell;
  evaluatorId: string;
  error: unknown;
}): EvaluationV3Event => ({
  type: "evaluator_result",
  rowIndex: cell.rowIndex,
  targetId: cell.targetId,
  evaluatorId,
  result: {
    status: "error",
    error_type: "EvaluatorError",
    details: error instanceof Error ? error.message : "Evaluator execution failed",
    traceback: [],
    ...(HandledError.isHandled(error) ? { domainError: error.serialize() } : {}),
  },
});

/** The error cell an evaluator column with nothing mapped reports for itself. */
export const evaluatorTargetNoInputsResult = ({
  cell,
  name,
}: {
  cell: ExecutionCell;
  name: string;
}): EvaluationV3Event => ({
  type: "target_result",
  rowIndex: cell.rowIndex,
  targetId: cell.targetId,
  output: undefined,
  domainError: new EvaluatorNoInputsResolvedError(name).serialize(),
});

/** The error row an evaluator with nothing mapped reports for itself. */
export const noInputsResolvedResult = ({
  cell,
  evaluator,
  evaluatorId,
}: {
  cell: ExecutionCell;
  evaluator: EvaluatorConfig;
  evaluatorId: string;
}): EvaluationV3Event => ({
  type: "evaluator_result",
  rowIndex: cell.rowIndex,
  targetId: cell.targetId,
  evaluatorId,
  result: {
    status: "error",
    error_type: NO_INPUTS_RESOLVED,
    details: `${evaluatorDisplayName(
      evaluator,
    )} received no input for this row. Map its fields in the evaluator settings, then run again.`,
    traceback: [],
    domainError: new EvaluatorNoInputsResolvedError(evaluatorDisplayName(evaluator)).serialize(),
  },
});
