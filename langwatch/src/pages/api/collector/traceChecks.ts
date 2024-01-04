import similarity from "compute-cosine-similarity";
import { prisma } from "../../../server/db";
import { type Span, type Trace } from "../../../server/tracer/types";
import { scheduleTraceCheck } from "../../../trace_checks/queue";
import { getTraceCheckDefinitions } from "../../../trace_checks/registry";
import type {
  CheckPreconditions,
  CheckTypes
} from "../../../trace_checks/types";
import { debug } from "../collector";

async function evaluatePreconditions(
  checkType: string,
  trace: Trace,
  spans: Span[],
  preconditions: CheckPreconditions
): Promise<boolean> {
  const checkDefinitions = getTraceCheckDefinitions(checkType);

  if (checkDefinitions?.requiresRag) {
    if (!spans.some((span) => span.type === "rag")) {
      return false;
    }
  }

  for (const precondition of preconditions) {
    const valueToCheck = precondition.field === "input"
      ? trace.input.value
      : trace.output?.value ?? "";
    switch (precondition.rule) {
      case "contains":
        if (!valueToCheck.toLowerCase().includes(precondition.value.toLowerCase())) {
          return false;
        }
        break;
      case "not_contains":
        if (valueToCheck.toLowerCase().includes(precondition.value.toLowerCase())) {
          return false;
        }
        break;
      case "matches_regex":
        try {
          const regex = new RegExp(precondition.value, "gi");
          if (!regex.test(valueToCheck)) {
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
        const embeddings = precondition.openai_embeddings ?? [];
        if (embeddings.length === 0 ||
          !trace.search_embeddings.openai_embeddings) {
          console.error(
            "No embeddings provided for is_similar_to precondition."
          );
          return false;
        }
        const similarityScore = similarity(
          embeddings,
          trace.search_embeddings.openai_embeddings
        );
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
          `scheduling ${check.checkType} (checkId: ${check.id}) for trace ${trace.id}`
        );
        void scheduleTraceCheck({
          check: {
            ...check,
            type: check.checkType as CheckTypes,
          },
          trace: trace,
        });
      }
    }
  }
};
