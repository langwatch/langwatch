import similarity from "compute-cosine-similarity";
import {
  type ElasticSearchTrace,
  type RAGSpan,
  type Span,
  type Trace,
} from "../server/tracer/types";
import { getEvaluatorDefinitions } from "../trace_checks/getEvaluator";
import type { CheckPreconditions } from "../trace_checks/types";
import { extractRAGTextualContext } from "../server/background/workers/collector/rag";

// TODO: write tests
export function evaluatePreconditions(
  evaluatorType: string,
  trace: Trace | ElasticSearchTrace,
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
      case "is_similar_to":
        const embeddingsMap = {
          input: trace.input?.embeddings?.embeddings ?? [],
          output: trace.output?.embeddings?.embeddings ?? [],
          "metadata.labels": null,
        };
        const embeddings = embeddingsMap[precondition.field];
        if (!embeddings) {
          console.error(
            `${precondition.field} is not available for embeddings match`
          );
          return false;
        }

        const preconditionEmbeddings = precondition.embeddings?.embeddings;
        if (!preconditionEmbeddings || preconditionEmbeddings.length === 0) {
          console.error(
            `No embeddings provided for is_similar_to precondition on ${precondition.field} field.`
          );
          return false;
        }
        const similarityScore = similarity(preconditionEmbeddings, embeddings);
        if ((similarityScore ?? 0) < precondition.threshold) {
          return false;
        }
        break;
    }
  }
  return true;
}
