import similarity from "compute-cosine-similarity";
import { prisma } from "../../../server/db";
import {
  type RAGSpan,
  type Span,
  type Trace,
} from "../../../server/tracer/types";
import { scheduleTraceCheck } from "../../../server/background/queues/traceChecksQueue";
import { getEvaluatorDefinitions } from "../../../trace_checks/getEvaluator";
import type { CheckPreconditions } from "../../../trace_checks/types";
import { debug } from "../collector";
import { extractRAGTextualContext } from "./rag";
import type { EvaluatorTypes } from "../../../trace_checks/evaluators.generated";

async function evaluatePreconditions(
  checkType: string,
  trace: Trace,
  spans: Span[],
  preconditions: CheckPreconditions
): Promise<boolean> {
  const evaluator = getEvaluatorDefinitions(checkType);

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

  for (const precondition of preconditions) {
    const valueMap = {
      input: trace.input.value,
      output: trace.output?.value ?? "",
      "metadata.labels": trace.metadata.labels ?? [],
    };
    const valueToCheck = valueMap[precondition.field];
    const valueToCheckArrayOrLowercase = Array.isArray(valueToCheck)
      ? valueToCheck
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
          input: trace.input.embeddings?.embeddings ?? [],
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

export const scheduleTraceChecks = async (trace: Trace, spans: Span[]) => {
  const checks = await prisma.check.findMany({
    where: {
      projectId: trace.project_id,
      enabled: true,
      checkType: { not: "pii_check" },
    },
  });

  for (const check of checks) {
    if (Math.random() <= check.sample) {
      const preconditions = (check.preconditions ?? []) as CheckPreconditions;
      const preconditionsMet = await evaluatePreconditions(
        check.checkType,
        trace,
        spans,
        preconditions
      );
      if (preconditionsMet) {
        debug(
          `scheduling ${check.checkType} (checkId: ${check.id}) for trace ${trace.trace_id}`
        );
        void scheduleTraceCheck({
          check: {
            ...check,
            type: check.checkType as EvaluatorTypes,
          },
          trace: trace,
        });
      }
    }
  }
};
