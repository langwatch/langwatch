import type { SerializedDomainError } from "~/server/app-layer/domain-error";

export type EvaluatorDomainErrorExplanation = {
  headline: string;
  hint?: string;
};

export function explainEvaluatorDomainError(
  domain: SerializedDomainError,
): EvaluatorDomainErrorExplanation | null {
  switch (domain.kind) {
    case "evaluator_execution_error": {
      const status = domain.meta.httpStatus;
      if (status !== 401 && status !== 403) return null;

      return {
        headline: "Missing or invalid model API key",
        hint: "Add the provider key in Settings → AI Gateway, then re-run.",
      };
    }
    default:
      return null;
  }
}
