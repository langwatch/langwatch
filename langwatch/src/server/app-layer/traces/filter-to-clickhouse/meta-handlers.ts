import type { TagToken } from "liqe";
import { FilterParseError } from "../errors";
import { boundedSubquery, scenarioRunSubquery } from "./subqueries";
import {
  extractStringValue,
  type FieldHandler,
  nextParam,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  type TranslationContext,
  validateValueLength,
  wrap,
} from "./value-helpers";

/**
 * Built-in existence categories for `has:` and `none:`.
 * `attribute.<key>` is also accepted dynamically.
 */
const HAS_VALUES = [
  "error",
  "eval",
  "feedback",
  "annotation",
  "conversation",
  "user",
  "topic",
  "subtopic",
  "label",
] as const;

/** Stored simulation_runs.Status values, by their lowercase UI label. */
const SCENARIO_STATUS_BY_LABEL: Record<string, string> = {
  success: "SUCCESS",
  failed: "FAILED",
  failure: "FAILURE",
  error: "ERROR",
  cancelled: "CANCELLED",
  stalled: "STALLED",
  in_progress: "IN_PROGRESS",
  running: "IN_PROGRESS",
  pending: "PENDING",
  queued: "QUEUED",
};

const SCENARIO_VERDICT_BY_LABEL: Record<string, string> = {
  success: "SUCCESS",
  failure: "FAILURE",
  failed: "FAILURE",
  inconclusive: "INCONCLUSIVE",
};

/**
 * Returns the trailing key for either `trace.attribute.<k>` (canonical) or
 * the legacy single-namespace `attribute.<k>`, or `null` when the value
 * isn't a trace-attribute reference at all. Folds the back-compat alias
 * into one call so callers don't have to branch on the prefix flavour.
 */
function stripTraceAttributePrefix(value: string): string | null {
  if (value.startsWith("trace.attribute.")) {
    return value.slice("trace.attribute.".length);
  }
  if (value.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
    return value.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length);
  }
  return null;
}

function translateTraceId(
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  const value = extractStringValue(tag);
  validateValueLength(value);
  const p = nextParam(ctx, "traceId");
  if (value.includes("*")) {
    ctx.params[p] = value.replace(/\*/g, "%");
    return wrap(`TraceId LIKE {${p}:String}`, negated);
  }
  ctx.params[p] = value;
  return wrap(`TraceId = {${p}:String}`, negated);
}

function makeScenarioColumnHandler(column: string): FieldHandler {
  return (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, column);
    ctx.params[p] = value;
    return wrap(scenarioRunSubquery(`${column} = {${p}:String}`), negated);
  };
}

function translateExistence(
  tag: TagToken,
  negated: boolean,
  ctx: TranslationContext,
): string {
  const value = extractStringValue(tag);
  validateValueLength(value);

  // Dynamic per-attribute existence — accepts the legacy `attribute.<k>`
  // form here. The `has:trace.attribute.<k>` namespaced form is handled
  // alongside it so both surfaces work without a saved-query migration.
  const traceAttrKey = stripTraceAttributePrefix(value);
  if (traceAttrKey !== null) {
    if (!traceAttrKey) {
      throw new FilterParseError(
        "attribute.<key> requires a key after the dot",
      );
    }
    const p = nextParam(ctx, "attrKey");
    ctx.params[p] = traceAttrKey;
    return wrap(`Attributes[{${p}:String}] != ''`, negated);
  }

  switch (value) {
    case "error":
      return wrap("ContainsErrorStatus = 1", negated);

    case "eval":
      return wrap(
        boundedSubquery("evaluation_runs", "ScheduledAt", "1 = 1"),
        negated,
      );

    case "feedback":
      return wrap(
        boundedSubquery(
          "stored_spans",
          "StartTime",
          "has(`Events.Name`, 'user_feedback')",
        ),
        negated,
      );

    case "annotation":
      return wrap("length(AnnotationIds) > 0", negated);

    case "conversation":
      return wrap("Attributes['gen_ai.conversation.id'] != ''", negated);

    case "user":
      return wrap("Attributes['langwatch.user_id'] != ''", negated);

    case "customer":
      return wrap("Attributes['langwatch.customer_id'] != ''", negated);

    case "topic":
      return wrap("ifNull(TopicId, '') != ''", negated);

    case "subtopic":
      return wrap("ifNull(SubTopicId, '') != ''", negated);

    case "label":
      return wrap(
        "Attributes['langwatch.labels'] != '' AND Attributes['langwatch.labels'] != '[]'",
        negated,
      );

    default:
      throw new FilterParseError(
        `Unknown has/none value "${value}". Valid: ${HAS_VALUES.join(", ")}, attribute.<key>`,
      );
  }
}

export const META_HANDLERS: Record<string, FieldHandler> = {
  has: (tag, negated, ctx) => translateExistence(tag, negated, ctx),
  none: (tag, negated, ctx) => translateExistence(tag, !negated, ctx),

  eval: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "evaluatorName");
    ctx.params[p] = value;
    return wrap(
      boundedSubquery(
        "evaluation_runs",
        "ScheduledAt",
        `EvaluatorName = {${p}:String}`,
      ),
      negated,
    );
  },

  event: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "eventName");
    ctx.params[p] = value;
    return wrap(
      boundedSubquery(
        "stored_spans",
        "StartTime",
        `has(\`Events.Name\`, {${p}:String})`,
      ),
      negated,
    );
  },

  trace: (tag, negated, ctx) => translateTraceId(tag, negated, ctx),
  traceId: (tag, negated, ctx) => translateTraceId(tag, negated, ctx),

  // Prompt IDs are hoisted onto trace_summaries as a JSON array string in
  // `Attributes['langwatch.prompt_ids']` — every prompt referenced anywhere
  // in the trace ends up there. We parse it to Array(String) and check
  // membership; ClickHouse caches the JSONExtract per granule so this is
  // cheap relative to the rest of the WHERE.
  prompt: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "promptId");
    ctx.params[p] = value;
    return wrap(
      `has(JSONExtract(Attributes['langwatch.prompt_ids'], 'Array(String)'), {${p}:String})`,
      negated,
    );
  },

  spanId: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "spanId");
    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return wrap(
        boundedSubquery(
          "stored_spans",
          "StartTime",
          `SpanId LIKE {${p}:String}`,
        ),
        negated,
      );
    }
    ctx.params[p] = value;
    return wrap(
      boundedSubquery("stored_spans", "StartTime", `SpanId = {${p}:String}`),
      negated,
    );
  },

  // Direct match on the hoisted attribute. No join.
  scenarioRun: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "scenarioRunId");
    ctx.params[p] = value;
    return wrap(`Attributes['scenario.run_id'] = {${p}:String}`, negated);
  },

  scenario: makeScenarioColumnHandler("ScenarioId"),
  scenarioSet: makeScenarioColumnHandler("ScenarioSetId"),
  scenarioBatch: makeScenarioColumnHandler("BatchRunId"),

  scenarioVerdict: (tag, negated, ctx) => {
    const raw = extractStringValue(tag);
    validateValueLength(raw);
    const mapped = SCENARIO_VERDICT_BY_LABEL[raw.toLowerCase()];
    if (!mapped) {
      throw new FilterParseError(
        `Unknown scenario verdict "${raw}". Valid: success, failure, inconclusive`,
      );
    }
    const p = nextParam(ctx, "scenarioVerdict");
    ctx.params[p] = mapped;
    return wrap(scenarioRunSubquery(`Verdict = {${p}:String}`), negated);
  },

  scenarioStatus: (tag, negated, ctx) => {
    const raw = extractStringValue(tag);
    validateValueLength(raw);
    const mapped = SCENARIO_STATUS_BY_LABEL[raw.toLowerCase()];
    if (!mapped) {
      throw new FilterParseError(
        `Unknown scenario status "${raw}". Valid: ${Object.keys(SCENARIO_STATUS_BY_LABEL).join(", ")}`,
      );
    }
    const p = nextParam(ctx, "scenarioStatus");
    ctx.params[p] = mapped;
    return wrap(scenarioRunSubquery(`Status = {${p}:String}`), negated);
  },
};
