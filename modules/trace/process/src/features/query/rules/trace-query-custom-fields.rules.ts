import { type FieldDef, UNSUPPORTED } from "@langwatch/trace-contract";

import { extractStringValue, likeMatch, parseJsonStringArray } from "./trace-query-values.rules.ts";

/**
 * `model:<value>` — membership in the hoisted `Models` array, with `*`
 * wildcards. In memory the same array lives on the fold state.
 */
export const MODEL_DEF: FieldDef = {
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const models = trace.summary.models;
    const matched = value.includes("*")
      ? models.some((m) => likeMatch(m, value))
      : models.includes(value);
    return negated ? !matched : matched;
  },
};

/**
 * `label:<value>` — membership in the JSON-encoded `langwatch.labels` array,
 * each element decoded by `parseJsonStringArray`.
 */
export const LABEL_DEF: FieldDef = {
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const labels = parseJsonStringArray(trace.summary.attributes["langwatch.labels"]) ?? [];
    const matched = labels.includes(value);
    return negated ? !matched : matched;
  },
};

/**
 * `evaluator:<id>` — traces with an evaluation run for that evaluator id.
 * In memory it needs the loaded evaluation runs, else it fails closed.
 */
export const EVALUATOR_DEF: FieldDef = {
  needs: "evaluations",
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.evaluations == null) return UNSUPPORTED;
    const value = extractStringValue(tag);
    const matched = trace.evaluations.some((e) => e.evaluatorId === value);
    return negated ? !matched : matched;
  },
};
