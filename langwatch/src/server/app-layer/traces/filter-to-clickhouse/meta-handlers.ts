import type { TagToken } from "liqe";
import { FilterParseError } from "../errors";
import {
  type FieldDef,
  type InMemoryTrace,
  UNSUPPORTED,
  type Unsupported,
} from "./field-def";
import { boundedSubquery, scenarioRunSubquery } from "./subqueries";
import {
  extractStringValue,
  likeMatch,
  nextParam,
  parseJsonStringArray,
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
  "customer",
  "topic",
  "subtopic",
  "label",
  "model",
  "service",
  "traceName",
  "rootSpanType",
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

// ---------------------------------------------------------------------------
// trace / traceId
// ---------------------------------------------------------------------------

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

const TRACE_ID_DEF: FieldDef = {
  toClickHouse: translateTraceId,
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const id = trace.summary.traceId;
    const matched = value.includes("*")
      ? likeMatch(id, value)
      : id === value;
    return negated ? !matched : matched;
  },
};

// ---------------------------------------------------------------------------
// has / none — existence categories
// ---------------------------------------------------------------------------

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

    case "model":
      return wrap("length(Models) > 0", negated);

    case "service":
      return wrap("Attributes['service.name'] != ''", negated);

    case "traceName":
      return wrap("ifNull(TraceName, '') != ''", negated);

    case "rootSpanType":
      return wrap("ifNull(RootSpanType, '') != ''", negated);

    default:
      throw new FilterParseError(
        `Unknown has/none value "${value}". Valid: ${HAS_VALUES.join(", ")}, attribute.<key>`,
      );
  }
}

/**
 * Which auxiliary collection a `has:<value>` / `none:<value>` reads, or `null`
 * when it's answered from the trace summary alone. `has` is value-polymorphic
 * so it carries no static `FieldDef.needs`; `queryNeeds` consults this instead.
 */
export function existenceNeeds(value: string): "evaluations" | "events" | null {
  if (value === "eval") return "evaluations";
  if (value === "feedback") return "events";
  return null;
}

function evaluateExistence(
  tag: TagToken,
  negated: boolean,
  trace: InMemoryTrace,
): boolean | Unsupported {
  const value = extractStringValue(tag);
  const attrs = trace.summary.attributes;
  const polarise = (present: boolean) => (negated ? !present : present);

  const traceAttrKey = stripTraceAttributePrefix(value);
  if (traceAttrKey !== null) {
    // Empty key throws on the SQL side (422) — fail closed here.
    if (!traceAttrKey) return UNSUPPORTED;
    return polarise((attrs[traceAttrKey] ?? "") !== "");
  }

  switch (value) {
    case "error":
      return polarise(trace.summary.containsErrorStatus);
    case "eval":
      if (trace.evaluations == null) return UNSUPPORTED;
      return polarise(trace.evaluations.length > 0);
    case "feedback":
      if (trace.events == null) return UNSUPPORTED;
      return polarise(trace.events.some((e) => e.name === "user_feedback"));
    case "annotation":
      return polarise(trace.summary.annotationIds.length > 0);
    case "conversation":
      return polarise((attrs["gen_ai.conversation.id"] ?? "") !== "");
    case "user":
      return polarise((attrs["langwatch.user_id"] ?? "") !== "");
    case "customer":
      return polarise((attrs["langwatch.customer_id"] ?? "") !== "");
    case "topic":
      return polarise((trace.summary.topicId ?? "") !== "");
    case "subtopic":
      return polarise((trace.summary.subTopicId ?? "") !== "");
    case "label": {
      const raw = attrs["langwatch.labels"] ?? "";
      return polarise(raw !== "" && raw !== "[]");
    }
    case "model":
      return polarise(trace.summary.models.length > 0);
    case "service":
      return polarise((attrs["service.name"] ?? "") !== "");
    case "traceName":
      return polarise((trace.summary.traceName ?? "") !== "");
    case "rootSpanType":
      return polarise((trace.summary.rootSpanType ?? "") !== "");
    default:
      // Unknown value throws on the SQL side — fail closed here.
      return UNSUPPORTED;
  }
}

const HAS_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => translateExistence(tag, negated, ctx),
  evaluateInMemory: (tag, negated, trace) =>
    evaluateExistence(tag, negated, trace),
};

const NONE_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => translateExistence(tag, !negated, ctx),
  evaluateInMemory: (tag, negated, trace) =>
    evaluateExistence(tag, !negated, trace),
};

// ---------------------------------------------------------------------------
// eval / event / prompt
// ---------------------------------------------------------------------------

const EVAL_DEF: FieldDef = {
  needs: "evaluations",
  toClickHouse: (tag, negated, ctx) => {
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
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.evaluations == null) return UNSUPPORTED;
    const value = extractStringValue(tag);
    const matched = trace.evaluations.some((e) => e.evaluatorName === value);
    return negated ? !matched : matched;
  },
};

const EVENT_DEF: FieldDef = {
  needs: "events",
  toClickHouse: (tag, negated, ctx) => {
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
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.events == null) return UNSUPPORTED;
    const value = extractStringValue(tag);
    const matched = trace.events.some((e) => e.name === value);
    return negated ? !matched : matched;
  },
};

// Prompt IDs are hoisted onto trace_summaries as a JSON array string in
// `Attributes['langwatch.prompt_ids']` — every prompt referenced anywhere in
// the trace ends up there. The SQL parses it to Array(String) and checks
// membership; in memory `parseJsonStringArray` does the same.
const PROMPT_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "promptId");
    ctx.params[p] = value;
    return wrap(
      `has(JSONExtract(Attributes['langwatch.prompt_ids'], 'Array(String)'), {${p}:String})`,
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const promptIds =
      parseJsonStringArray(trace.summary.attributes["langwatch.prompt_ids"]) ??
      [];
    const matched = promptIds.includes(value);
    return negated ? !matched : matched;
  },
};

// span-level id lookup translates to a cross-table subquery; deriving spans at
// dispatch time is a later phase, so it can't be positively evaluated yet.
const SPAN_ID_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "spanId");
    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return wrap(
        boundedSubquery("stored_spans", "StartTime", `SpanId LIKE {${p}:String}`),
        negated,
      );
    }
    ctx.params[p] = value;
    return wrap(
      boundedSubquery("stored_spans", "StartTime", `SpanId = {${p}:String}`),
      negated,
    );
  },
  evaluateInMemory: () => UNSUPPORTED,
};

// ---------------------------------------------------------------------------
// scenario fields
// ---------------------------------------------------------------------------

// Direct match on the hoisted attribute. No join.
const SCENARIO_RUN_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx, "scenarioRunId");
    ctx.params[p] = value;
    return wrap(`Attributes['scenario.run_id'] = {${p}:String}`, negated);
  },
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const matched =
      (trace.summary.attributes["scenario.run_id"] ?? "") === value;
    return negated ? !matched : matched;
  },
};

// scenario dimensions resolve through a `simulation_runs` subquery, a table the
// in-memory trace doesn't carry — fail closed for now.
function scenarioColumnDef(column: string): FieldDef {
  return {
    toClickHouse: (tag, negated, ctx) => {
      const value = extractStringValue(tag);
      validateValueLength(value);
      const p = nextParam(ctx, column);
      ctx.params[p] = value;
      return wrap(scenarioRunSubquery(`${column} = {${p}:String}`), negated);
    },
    evaluateInMemory: () => UNSUPPORTED,
  };
}

const SCENARIO_VERDICT_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
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
  evaluateInMemory: () => UNSUPPORTED,
};

const SCENARIO_STATUS_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
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
  evaluateInMemory: () => UNSUPPORTED,
};

export const META_FIELD_DEFS = {
  has: HAS_DEF,
  none: NONE_DEF,
  eval: EVAL_DEF,
  event: EVENT_DEF,
  trace: TRACE_ID_DEF,
  traceId: TRACE_ID_DEF,
  prompt: PROMPT_DEF,
  spanId: SPAN_ID_DEF,
  scenarioRun: SCENARIO_RUN_DEF,
  scenario: scenarioColumnDef("ScenarioId"),
  scenarioSet: scenarioColumnDef("ScenarioSetId"),
  scenarioBatch: scenarioColumnDef("BatchRunId"),
  scenarioVerdict: SCENARIO_VERDICT_DEF,
  scenarioStatus: SCENARIO_STATUS_DEF,
} satisfies Record<string, FieldDef>;
