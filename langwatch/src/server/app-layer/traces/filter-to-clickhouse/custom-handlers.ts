import { boundedSubquery } from "./subqueries";
import {
  extractStringValue,
  type FieldHandler,
  nextParam,
  validateValueLength,
  wrap,
} from "./value-helpers";

export const CUSTOM_FACET_HANDLERS: Record<string, FieldHandler> = {
  model: (tag, negated, ctx) => {
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

  label: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "label");
    ctx.params[p] = value;
    return wrap(
      `arrayExists(x -> trim(BOTH '"' FROM x) = {${p}:String}, JSONExtractArrayRaw(Attributes['langwatch.labels']))`,
      negated,
    );
  },

  evaluator: (tag, negated, ctx) => {
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
};
