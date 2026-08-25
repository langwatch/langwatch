/**
 * Compatibility import path while Evaluation callers migrate to
 * `@langwatch/evaluation-contract`. The feature contract owns this vocabulary.
 */
export {
  evaluationRunDataSchema,
  evaluationSummarySchema as evalSummarySchema,
  type EvaluationRunData,
  type EvaluationSummary as EvalSummary,
} from "@langwatch/evaluation-contract";
