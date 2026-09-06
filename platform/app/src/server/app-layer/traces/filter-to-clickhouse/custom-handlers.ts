import { type FieldDef, UNSUPPORTED } from "./field-def";
import { boundedSubquery } from "./subqueries";
import {
  extractStringValue,
  likeMatch,
  nextParam,
  parseJsonStringArray,
  validateValueLength,
  wrap,
} from "./value-helpers";

/**
 * `model:<value>` — membership in the hoisted `Models` array, with `*`
 * wildcards. In memory the same array lives on the fold state.
 */
export const MODEL_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "model");

    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return wrap(`arrayExists(m -> m LIKE {${p}:String}, Models)`, negated);
    }

    ctx.params[p] = value;
    return wrap(`has(Models, {${p}:String})`, negated);
  },
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
 * `label:<value>` — membership in the JSON-encoded `langwatch.labels` array.
 * The SQL trims the raw quotes; `parseJsonStringArray` unquotes for the same
 * reason in memory.
 */
export const LABEL_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "label");
    ctx.params[p] = value;
    return wrap(
      `arrayExists(x -> trim(BOTH '"' FROM x) = {${p}:String}, JSONExtractArrayRaw(Attributes['langwatch.labels']))`,
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const labels =
      parseJsonStringArray(trace.summary.attributes["langwatch.labels"]) ?? [];
    const matched = labels.includes(value);
    return negated ? !matched : matched;
  },
};

/**
 * `evaluator:<id>` — traces with an evaluation run for that evaluator id.
 * Answered by a cross-table subquery; in memory it needs the loaded evaluation
 * runs, else it fails closed.
 */
export const EVALUATOR_DEF: FieldDef = {
  needs: "evaluations",
  toClickHouse: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "evaluatorId");
    ctx.params[p] = value;
    return wrap(
      boundedSubquery(
        "evaluation_runs",
        "ScheduledAt",
        `EvaluatorId = {${p}:String}`,
      ),
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.evaluations == null) return UNSUPPORTED;
    const value = extractStringValue(tag);
    const matched = trace.evaluations.some((e) => e.evaluatorId === value);
    return negated ? !matched : matched;
  },
};
