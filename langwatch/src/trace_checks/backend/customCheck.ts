import similarity from "compute-cosine-similarity";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type {
  Checks,
  CustomCheckFailWhen,
  TraceCheckBackendDefinition,
  TraceCheckResult,
} from "../types";

const execute = async (
  trace: Trace,
  _spans: ElasticSearchSpan[],
  parameters: Checks["custom"]["parameters"]
): Promise<TraceCheckResult> => {
  const results = [];
  const failedRules = [];
  for (const rule of parameters.rules) {
    const valueToCheck =
      (rule.field === "input" ? trace.input.value : trace.output?.value) ?? "";

    let rulePassed = false;
    switch (rule.rule) {
      case "contains":
        rulePassed = valueToCheck.includes(rule.value);
        break;
      case "not_contains":
        rulePassed = !valueToCheck.includes(rule.value);
        break;
      case "matches_regex":
        try {
          const regex = new RegExp(rule.value);
          rulePassed = regex.test(valueToCheck);
        } catch (error) {
          throw new Error(`Invalid regex: ${rule.value}`);
        }
        break;
      case "not_matches_regex":
        try {
          const regex = new RegExp(rule.value);
          rulePassed = !regex.test(valueToCheck);
        } catch (error) {
          throw new Error(`Invalid regex: ${rule.value}`);
        }
        break;
      case "is_similar_to":
        const embeddings = rule.openai_embeddings ?? [];
        if (embeddings.length === 0) {
          throw new Error("No embeddings provided for is_similar_to rule.");
        }
        const traceEmbeddings = trace.search_embeddings.openai_embeddings;
        if (!traceEmbeddings) {
          throw new Error(
            "No embeddings found in trace for is_similar_to rule."
          );
        }
        const similarityScore = similarity(embeddings, traceEmbeddings);
        if (!similarityScore) {
          throw new Error("Error computing similarity.");
        }
        rulePassed = !matchesFailWhenCondition(similarityScore, rule.failWhen);
        break;
      // Additional rules can be implemented here
    }
    if (!rulePassed) {
      failedRules.push(rule);
    }
    results.push({ rule, passed: rulePassed });
  }
  return {
    raw_result: { results, failedRules },
    value: failedRules.length,
    status: failedRules.length > 0 ? "failed" : "succeeded",
  };
};

const matchesFailWhenCondition = (
  score: number,
  failWhen: CustomCheckFailWhen
): boolean => {
  switch (failWhen.condition) {
    case "<":
      return score < failWhen.amount;
    case ">":
      return score > failWhen.amount;
    case "<=":
      return score <= failWhen.amount;
    case ">=":
      return score >= failWhen.amount;
    case "==":
      return score === failWhen.amount;
    default:
      throw new Error(
        `Invalid failWhen condition: ${failWhen.condition as any}`
      );
  }
};

export const CustomCheck: TraceCheckBackendDefinition<"custom"> = {
  execute,
};
