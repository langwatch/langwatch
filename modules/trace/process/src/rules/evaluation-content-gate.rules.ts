import { canReadCapturedContent, type Protections } from "@langwatch/trace-contract";

/** The content an evaluation carries, in the shapes the in-app reads return. */
type EvaluationContent = {
  inputs?: Record<string, unknown> | null;
  details: string | null;
  error: string | null;
  errorDetails?: string | null;
};

/**
 * Inputs, details and error text quote captured content, so they survive only
 * for a viewer who may read it; score, verdict and label always survive. On an
 * aggregate the protections are the strictest member's (ADR-177 decision 9).
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
