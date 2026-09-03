import { type FieldDef, UNSUPPORTED } from "./trace-query-evaluation.adapter";
import { boundedSubquery } from "./trace-query-subquery.clickhouse.adapter";
import { TraceQueryValues } from "./trace-query-values.clickhouse.adapter";

/**
 * `model:<value>` — membership in the hoisted `Models` array, with `*`
 * wildcards. In memory the same array lives on the fold state.
 */
export const MODEL_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const value = TraceQueryValues.extractStringValue(tag);
    TraceQueryValues.validateValueLength(value);
    const p = TraceQueryValues.nextParam(ctx, "model");

    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return TraceQueryValues.wrap(`arrayExists(m -> m LIKE {${p}:String}, Models)`, negated);
    }

    ctx.params[p] = value;
    return TraceQueryValues.wrap(`has(Models, {${p}:String})`, negated);
  },
  evaluateInMemory: (tag, negated, trace) => {
    const value = TraceQueryValues.extractStringValue(tag);
    const models = trace.summary.models;
    const matched = value.includes("*")
      ? models.some((m) => TraceQueryValues.likeMatch(m, value))
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
    const value = TraceQueryValues.extractStringValue(tag);
    TraceQueryValues.validateValueLength(value);
    const p = TraceQueryValues.nextParam(ctx, "label");
    ctx.params[p] = value;
    return TraceQueryValues.wrap(
      `arrayExists(x -> trim(BOTH '"' FROM x) = {${p}:String}, JSONExtractArrayRaw(Attributes['langwatch.labels']))`,
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    const value = TraceQueryValues.extractStringValue(tag);
    const labels =
      TraceQueryValues.parseJsonStringArray(trace.summary.attributes["langwatch.labels"]) ?? [];
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
    const value = TraceQueryValues.extractStringValue(tag);
    TraceQueryValues.validateValueLength(value);
    const p = TraceQueryValues.nextParam(ctx, "evaluatorId");
    ctx.params[p] = value;
    return TraceQueryValues.wrap(
      boundedSubquery("evaluation_runs", "ScheduledAt", `EvaluatorId = {${p}:String}`),
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.evaluations == null) return UNSUPPORTED;
    const value = TraceQueryValues.extractStringValue(tag);
    const matched = trace.evaluations.some((e) => e.evaluatorId === value);
    return negated ? !matched : matched;
  },
};
