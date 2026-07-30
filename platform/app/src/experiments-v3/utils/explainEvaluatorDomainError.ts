import type { SerializedHandledError } from "@langwatch/handled-error";

export type EvaluatorDomainErrorExplanation = {
  headline: string;
  hint?: string;
};

/**
 * The same auth failure reaches the user two ways: structurally, as a 401/403
 * domain error, and — for results stored before evaluators carried domain
 * errors — as a raw provider string that ComparisonCell sniffs for "api key".
 * Both paths must say the same thing, so the copy lives here once and both
 * read it from here rather than each holding its own literal.
 */
export const MISSING_MODEL_API_KEY_EXPLANATION = {
  headline: "Missing or invalid model API key",
  hint: "Add the provider key in Settings → AI Gateway, then re-run.",
} as const satisfies EvaluatorDomainErrorExplanation;

export function explainEvaluatorDomainError(
  domain: SerializedHandledError,
): EvaluatorDomainErrorExplanation | null {
  switch (domain.kind) {
    case "evaluator_execution_error": {
      const status = domain.meta.httpStatus;
      if (status !== 401 && status !== 403) return null;

      return MISSING_MODEL_API_KEY_EXPLANATION;
    }
    default:
      return null;
  }
}
