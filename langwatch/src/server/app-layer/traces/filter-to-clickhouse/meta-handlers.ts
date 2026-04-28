import type { TagToken } from "liqe";
import { FilterParseError } from "../errors";
import { boundedSubquery, scenarioRunSubquery } from "./subqueries";
import {
  ATTRIBUTE_PREFIX,
  extractStringValue,
  nextParam,
  validateValueLength,
  wrap,
  type FieldHandler,
  type TranslationContext,
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

function makeScenarioColumnHandler(column: string): FieldHandler {
  return (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);
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

  // Dynamic per-attribute existence: `has:attribute.langwatch.user_id`
  if (value.startsWith(ATTRIBUTE_PREFIX)) {
    const attrKey = value.slice(ATTRIBUTE_PREFIX.length);
    if (!attrKey) {
      throw new FilterParseError("attribute.<key> requires a key after the dot");
    }
    const p = nextParam(ctx);
    ctx.params[p] = attrKey;
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
    const p = nextParam(ctx);
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
    const p = nextParam(ctx);
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

  trace: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);

    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return wrap(`TraceId LIKE {${p}:String}`, negated);
    }

    ctx.params[p] = value;
    return wrap(`TraceId = {${p}:String}`, negated);
  },

  // Direct match on the hoisted attribute. No join.
  scenarioRun: (tag, negated, ctx) => {
    const value = extractStringValue(tag);
    validateValueLength(value);
    const p = nextParam(ctx);
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
    const p = nextParam(ctx);
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
    const p = nextParam(ctx);
    ctx.params[p] = mapped;
    return wrap(scenarioRunSubquery(`Status = {${p}:String}`), negated);
  },
};
