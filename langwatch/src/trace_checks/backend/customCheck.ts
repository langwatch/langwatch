import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type {
  Checks,
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
      case 'matches_regex':
        try {
          const regex = new RegExp(rule.value);
          rulePassed = regex.test(valueToCheck);
        } catch (error) {
          throw new Error(`Invalid regex: ${rule.value}`);
        }
        break;
      case 'not_matches_regex':
        try {
          const regex = new RegExp(rule.value);
          rulePassed = !regex.test(valueToCheck);
        } catch (error) {
          throw new Error(`Invalid regex: ${rule.value}`);
        }
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

export const CustomCheck: TraceCheckBackendDefinition<"custom"> = {
  execute,
};
