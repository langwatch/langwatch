import {
  type ElasticSearchTrace,
  type RAGSpan,
  type Span,
} from "../tracer/types";
import { getEvaluatorDefinitions } from "./getEvaluator";
import type { CheckPreconditions } from "./types";
import { extractRAGTextualContext } from "../background/workers/collector/rag";

export type PreconditionTrace = Pick<
  ElasticSearchTrace,
  "input" | "output" | "metadata" | "expected_output"
>;

// TODO: write tests
export function evaluatePreconditions(
  evaluatorType: string,
  trace: PreconditionTrace,
  spans: Span[],
  preconditions: CheckPreconditions
): boolean {
  const evaluator = getEvaluatorDefinitions(evaluatorType);

  if (evaluator?.requiredFields.includes("contexts")) {
    // Check if any RAG span is available and has non-empty contexts
    if (
      !spans.some(
        (span) =>
          span.type === "rag" &&
          extractRAGTextualContext((span as RAGSpan).contexts).length > 0
      )
    ) {
      return false;
    }
  }

  if (evaluator?.requiredFields.includes("expected_output")) {
    if (!trace.expected_output) {
      return false;
    }
  }

  for (const precondition of preconditions) {
    const valueMap = {
      input: trace.input?.value ?? "",
      output: trace.output?.value ?? "",
      "metadata.labels": trace.metadata.labels ?? [],
    };
    const valueToCheck = valueMap[precondition.field];
    const valueToCheckArrayOrLowercase = Array.isArray(valueToCheck)
      ? valueToCheck.map((value) => value.toLowerCase())
      : valueToCheck.toLowerCase();
    const valueToCheckStringOrStringified = Array.isArray(valueToCheck)
      ? JSON.stringify(valueToCheck)
      : valueToCheck.toLowerCase();

    switch (precondition.rule) {
      case "contains":
        if (
          !valueToCheckArrayOrLowercase.includes(
            precondition.value.toLowerCase()
          )
        ) {
          return false;
        }
        break;
      case "not_contains":
        if (
          valueToCheckArrayOrLowercase.includes(
            precondition.value.toLowerCase()
          )
        ) {
          return false;
        }
        break;
      case "matches_regex":
        try {
          // TODO: should we do a match on each item of the array here?
          const regex = new RegExp(precondition.value, "gi");
          if (!regex.test(valueToCheckStringOrStringified)) {
            return false;
          }
        } catch (error) {
          console.error(
            `Invalid regex in preconditions: ${precondition.value}`
          );
          return false;
        }
        break;
    }
  }
  return true;
}
