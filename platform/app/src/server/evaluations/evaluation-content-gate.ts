import {
  canReadCapturedContent,
  type Protections,
} from "~/server/traces/protections";

/**
 * The content an evaluation carries, in the shapes the in-app reads return:
 * the per-trace `TraceEvaluation` and the stored `EvaluationRunData`.
 */
type EvaluationContent = {
  inputs?: Record<string, unknown> | null;
  details: string | null;
  error: string | null;
  errorDetails?: string | null;
};

/**
 * An evaluation's content follows the viewer's content visibility, as the
 * span reads do. `inputs` are the captured input and output the evaluator was
 * given; `details` and the error text are evaluator prose that routinely
 * quotes both. So all of it survives only for a viewer who may read input and
 * output (`canReadCapturedContent`); the score, the verdict and the label are
 * facts about the trace and always survive.
 *
 * The protections are the route's own, resolved through its proof, so on an
 * aggregate the strictest member policy applies (ADR-144 decision 9), and on
 * a plain project its own policy does. The share page has its own, stricter
 * gate (`gateEvaluations`), which never shares inputs at all.
 */
export function gateEvaluationContent<T extends EvaluationContent>({
  evaluation,
  protections,
}: {
  evaluation: T;
  protections: Protections;
}): T {
  if (canReadCapturedContent(protections)) return evaluation;
  return {
    ...evaluation,
    ...(evaluation.inputs != null && { inputs: null }),
    details: null,
    error: evaluation.error === null ? null : "",
    ...(evaluation.errorDetails != null && { errorDetails: null }),
  };
}

/** The lazily read inputs of one evaluation, under the same rule. */
export function gateEvaluationInputs({
  inputs,
  protections,
}: {
  inputs: Record<string, unknown> | null;
  protections: Protections;
}): Record<string, unknown> | null {
  return canReadCapturedContent(protections) ? inputs : null;
}
