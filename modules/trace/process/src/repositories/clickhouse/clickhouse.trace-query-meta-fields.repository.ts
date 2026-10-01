import {
  FilterParseError,
  type TagToken,
  type FieldDef,
  type InMemoryTrace,
  type TranslationContext,
  UNSUPPORTED,
  type Unsupported,
} from "@langwatch/trace-contract";

import { ClickHouseTraceQuerySubqueryRepository } from "./clickhouse.trace-query-subquery.repository.ts";
import {
  ClickHouseTraceQueryValuesRepository,
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
} from "./clickhouse.trace-query-values.repository.ts";

const traceQuerySubqueryRepository = ClickHouseTraceQuerySubqueryRepository.create();
const traceQueryValuesRepository = ClickHouseTraceQueryValuesRepository.create();
let traceQueryMetaFieldsRepository: ClickHouseTraceQueryMetaFieldsRepository;

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

// ---------------------------------------------------------------------------
// trace / traceId
// ---------------------------------------------------------------------------

const TRACE_ID_DEF: FieldDef = {
  // An arrow, not a bare reference: this const is evaluated at module load,
  // before the class below is initialised.
  toClickHouse: (tag, negated, ctx) =>
    traceQueryMetaFieldsRepository.translateTraceId(tag, negated, ctx),
  evaluateInMemory: (tag, negated, trace) => {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    const id = trace.summary.traceId;
    const matched = value.includes("*")
      ? traceQueryValuesRepository.likeMatch(id, value)
      : id === value;
    return negated ? !matched : matched;
  },
};

// ---------------------------------------------------------------------------
// has / none — existence categories
// ---------------------------------------------------------------------------

const HAS_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) =>
    traceQueryMetaFieldsRepository.translateExistence(tag, negated, ctx),
  evaluateInMemory: (tag, negated, trace) =>
    traceQueryMetaFieldsRepository.evaluateExistence(tag, negated, trace),
};

const NONE_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) =>
    traceQueryMetaFieldsRepository.translateExistence(tag, !negated, ctx),
  evaluateInMemory: (tag, negated, trace) =>
    traceQueryMetaFieldsRepository.evaluateExistence(tag, !negated, trace),
};

// ---------------------------------------------------------------------------
// eval / event / prompt
// ---------------------------------------------------------------------------

const EVAL_DEF: FieldDef = {
  needs: "evaluations",
  toClickHouse: (tag, negated, ctx) => {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(value);
    const p = traceQueryValuesRepository.nextParam(ctx, "evaluatorName");
    ctx.params[p] = value;
    return traceQueryValuesRepository.wrap(
      traceQuerySubqueryRepository.boundedSubquery(
        "evaluation_runs",
        "ScheduledAt",
        `EvaluatorName = {${p}:String}`,
      ),
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.evaluations == null) return UNSUPPORTED;
    const value = traceQueryValuesRepository.extractStringValue(tag);
    const matched = trace.evaluations.some((e) => e.evaluatorName === value);
    return negated ? !matched : matched;
  },
};

const EVENT_DEF: FieldDef = {
  needs: "events",
  toClickHouse: (tag, negated, ctx) => {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(value);
    const p = traceQueryValuesRepository.nextParam(ctx, "eventName");
    ctx.params[p] = value;
    return traceQueryValuesRepository.wrap(
      traceQuerySubqueryRepository.boundedSubquery(
        "stored_spans",
        "StartTime",
        `has(\`Events.Name\`, {${p}:String})`,
      ),
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.events == null) return UNSUPPORTED;
    const value = traceQueryValuesRepository.extractStringValue(tag);
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
    const value = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(value);
    const p = traceQueryValuesRepository.nextParam(ctx, "promptId");
    ctx.params[p] = value;
    return traceQueryValuesRepository.wrap(
      `has(JSONExtract(Attributes['langwatch.prompt_ids'], 'Array(String)'), {${p}:String})`,
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    const promptIds =
      traceQueryValuesRepository.parseJsonStringArray(
        trace.summary.attributes["langwatch.prompt_ids"],
      ) ?? [];
    const matched = promptIds.includes(value);
    return negated ? !matched : matched;
  },
};

// span-level id lookup translates to a cross-table subquery; deriving spans at
// dispatch time is a later phase, so it can't be positively evaluated yet.
const SPAN_ID_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(value);
    const p = traceQueryValuesRepository.nextParam(ctx, "spanId");
    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return traceQueryValuesRepository.wrap(
        traceQuerySubqueryRepository.boundedSubquery(
          "stored_spans",
          "StartTime",
          `SpanId LIKE {${p}:String}`,
        ),
        negated,
      );
    }
    ctx.params[p] = value;
    return traceQueryValuesRepository.wrap(
      traceQuerySubqueryRepository.boundedSubquery(
        "stored_spans",
        "StartTime",
        `SpanId = {${p}:String}`,
      ),
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
    const value = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(value);
    const p = traceQueryValuesRepository.nextParam(ctx, "scenarioRunId");
    ctx.params[p] = value;
    return traceQueryValuesRepository.wrap(
      `Attributes['scenario.run_id'] = {${p}:String}`,
      negated,
    );
  },
  evaluateInMemory: (tag, negated, trace) => {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    const matched = (trace.summary.attributes["scenario.run_id"] ?? "") === value;
    return negated ? !matched : matched;
  },
};

// scenario dimensions resolve through a `simulation_runs` subquery, a table the
// in-memory trace doesn't carry — fail closed for now.
const SCENARIO_VERDICT_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const raw = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(raw);
    const mapped = SCENARIO_VERDICT_BY_LABEL[raw.toLowerCase()];
    if (!mapped) {
      throw new FilterParseError(
        `Unknown scenario verdict "${raw}". Valid: success, failure, inconclusive`,
      );
    }
    const p = traceQueryValuesRepository.nextParam(ctx, "scenarioVerdict");
    ctx.params[p] = mapped;
    return traceQueryValuesRepository.wrap(
      traceQuerySubqueryRepository.scenarioRunSubquery(`Verdict = {${p}:String}`),
      negated,
    );
  },
  evaluateInMemory: () => UNSUPPORTED,
};

const SCENARIO_STATUS_DEF: FieldDef = {
  toClickHouse: (tag, negated, ctx) => {
    const raw = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(raw);
    const mapped = SCENARIO_STATUS_BY_LABEL[raw.toLowerCase()];
    if (!mapped) {
      throw new FilterParseError(
        `Unknown scenario status "${raw}". Valid: ${Object.keys(SCENARIO_STATUS_BY_LABEL).join(", ")}`,
      );
    }
    const p = traceQueryValuesRepository.nextParam(ctx, "scenarioStatus");
    ctx.params[p] = mapped;
    return traceQueryValuesRepository.wrap(
      traceQuerySubqueryRepository.scenarioRunSubquery(`Status = {${p}:String}`),
      negated,
    );
  },
  evaluateInMemory: () => UNSUPPORTED,
};

/**
 * Trace fields that are not columns: trace_id normalization and existence checks.
 */
export class ClickHouseTraceQueryMetaFieldsRepository {
  private constructor() {}

  static create(): ClickHouseTraceQueryMetaFieldsRepository {
    return new ClickHouseTraceQueryMetaFieldsRepository();
  }

  /**
   * Extracts attribute key from trace.attribute.* or attribute.* prefix.
   */
  private stripTraceAttributePrefix(value: string): string | null {
    if (value.startsWith("trace.attribute.")) {
      return value.slice("trace.attribute.".length);
    }
    if (value.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
      return value.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length);
    }
    return null;
  }

  translateTraceId(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(value);
    const p = traceQueryValuesRepository.nextParam(ctx, "traceId");
    if (value.includes("*")) {
      ctx.params[p] = value.replace(/\*/g, "%");
      return traceQueryValuesRepository.wrap(`TraceId LIKE {${p}:String}`, negated);
    }
    ctx.params[p] = value;
    return traceQueryValuesRepository.wrap(`TraceId = {${p}:String}`, negated);
  }

  translateExistence(tag: TagToken, negated: boolean, ctx: TranslationContext): string {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    traceQueryValuesRepository.validateValueLength(value);

    // Dynamic per-attribute existence — accepts the legacy `attribute.<k>`
    // form here. The `has:trace.attribute.<k>` namespaced form is handled
    // alongside it so both surfaces work without a saved-query migration.
    const traceAttrKey = this.stripTraceAttributePrefix(value);
    if (traceAttrKey !== null) {
      if (!traceAttrKey) {
        throw new FilterParseError("attribute.<key> requires a key after the dot");
      }
      const p = traceQueryValuesRepository.nextParam(ctx, "attrKey");
      ctx.params[p] = traceAttrKey;
      return traceQueryValuesRepository.wrap(`Attributes[{${p}:String}] != ''`, negated);
    }

    switch (value) {
      case "error":
        return traceQueryValuesRepository.wrap("ContainsErrorStatus = 1", negated);

      case "eval":
        return traceQueryValuesRepository.wrap(
          traceQuerySubqueryRepository.boundedSubquery("evaluation_runs", "ScheduledAt", "1 = 1"),
          negated,
        );

      case "feedback":
        return traceQueryValuesRepository.wrap(
          traceQuerySubqueryRepository.boundedSubquery(
            "stored_spans",
            "StartTime",
            "has(`Events.Name`, 'user_feedback')",
          ),
          negated,
        );

      case "annotation":
        return traceQueryValuesRepository.wrap("length(AnnotationIds) > 0", negated);

      case "conversation":
        return traceQueryValuesRepository.wrap(
          "Attributes['gen_ai.conversation.id'] != ''",
          negated,
        );

      case "user":
        return traceQueryValuesRepository.wrap("Attributes['langwatch.user_id'] != ''", negated);

      case "customer":
        return traceQueryValuesRepository.wrap(
          "Attributes['langwatch.customer_id'] != ''",
          negated,
        );

      case "topic":
        return traceQueryValuesRepository.wrap("ifNull(TopicId, '') != ''", negated);

      case "subtopic":
        return traceQueryValuesRepository.wrap("ifNull(SubTopicId, '') != ''", negated);

      case "label":
        return traceQueryValuesRepository.wrap(
          "Attributes['langwatch.labels'] != '' AND Attributes['langwatch.labels'] != '[]'",
          negated,
        );

      case "model":
        return traceQueryValuesRepository.wrap("length(Models) > 0", negated);

      case "service":
        return traceQueryValuesRepository.wrap("Attributes['service.name'] != ''", negated);

      case "traceName":
        return traceQueryValuesRepository.wrap("ifNull(TraceName, '') != ''", negated);

      case "rootSpanType":
        return traceQueryValuesRepository.wrap("ifNull(RootSpanType, '') != ''", negated);

      default:
        throw new FilterParseError(
          `Unknown has/none value "${value}". Valid: ${HAS_VALUES.join(", ")}, attribute.<key>`,
        );
    }
  }

  /**
   * What each `has:`/`none:` value probes, keyed by the value. A Map, not an object, because
   * the key is user-supplied and a prototype key (`constructor`, `toString`) must not resolve.
   */
  readonly #EXISTENCE_PROBES: ReadonlyMap<string, (trace: InMemoryTrace) => boolean | Unsupported> =
    new Map([
      ["error", (trace: InMemoryTrace) => trace.summary.containsErrorStatus],
      [
        "eval",
        (trace: InMemoryTrace) =>
          trace.evaluations == null ? UNSUPPORTED : trace.evaluations.length > 0,
      ],
      [
        "feedback",
        (trace: InMemoryTrace) =>
          trace.events == null ? UNSUPPORTED : trace.events.some((e) => e.name === "user_feedback"),
      ],
      ["annotation", (trace: InMemoryTrace) => trace.summary.annotationIds.length > 0],
      [
        "conversation",
        (trace: InMemoryTrace) => (trace.summary.attributes["gen_ai.conversation.id"] ?? "") !== "",
      ],
      [
        "user",
        (trace: InMemoryTrace) => (trace.summary.attributes["langwatch.user_id"] ?? "") !== "",
      ],
      [
        "customer",
        (trace: InMemoryTrace) => (trace.summary.attributes["langwatch.customer_id"] ?? "") !== "",
      ],
      ["topic", (trace: InMemoryTrace) => (trace.summary.topicId ?? "") !== ""],
      ["subtopic", (trace: InMemoryTrace) => (trace.summary.subTopicId ?? "") !== ""],
      [
        "label",
        (trace: InMemoryTrace) => {
          const raw = trace.summary.attributes["langwatch.labels"] ?? "";
          return raw !== "" && raw !== "[]";
        },
      ],
      ["model", (trace: InMemoryTrace) => trace.summary.models.length > 0],
      [
        "service",
        (trace: InMemoryTrace) => (trace.summary.attributes["service.name"] ?? "") !== "",
      ],
      ["traceName", (trace: InMemoryTrace) => (trace.summary.traceName ?? "") !== ""],
      ["rootSpanType", (trace: InMemoryTrace) => (trace.summary.rootSpanType ?? "") !== ""],
    ]);

  evaluateExistence(tag: TagToken, negated: boolean, trace: InMemoryTrace): boolean | Unsupported {
    const value = traceQueryValuesRepository.extractStringValue(tag);
    const polarise = (present: boolean) => (negated ? !present : present);

    const traceAttrKey = this.stripTraceAttributePrefix(value);
    if (traceAttrKey !== null) {
      // Empty key throws on the SQL side (422) — fail closed here.
      if (!traceAttrKey) return UNSUPPORTED;
      // Own-key read: the key is user-supplied, and a plain `attrs[key]` made
      // `has:attribute.constructor` truthy on *every* trace (inherited
      // `Object.prototype.constructor`) while the compiled
      // `Attributes['constructor'] != ''` matched none of them.
      return polarise(
        traceQueryValuesRepository.readAttribute(trace.summary.attributes, traceAttrKey) !== "",
      );
    }

    const probe = this.#EXISTENCE_PROBES.get(value);
    // Unknown value throws on the SQL side — fail closed here.
    if (!probe) return UNSUPPORTED;

    const present = probe(trace);

    return present === UNSUPPORTED ? UNSUPPORTED : polarise(present);
  }

  scenarioColumnDef(column: string): FieldDef {
    return {
      toClickHouse: (tag, negated, ctx) => {
        const value = traceQueryValuesRepository.extractStringValue(tag);
        traceQueryValuesRepository.validateValueLength(value);
        const p = traceQueryValuesRepository.nextParam(ctx, column);
        ctx.params[p] = value;
        return traceQueryValuesRepository.wrap(
          traceQuerySubqueryRepository.scenarioRunSubquery(`${column} = {${p}:String}`),
          negated,
        );
      },
      evaluateInMemory: () => UNSUPPORTED,
    };
  }

  /**
   * Which auxiliary collection a has/none filter reads, or null for trace summary.
   */
  classifyExistenceSource(value: string): "evaluations" | "events" | null {
    if (value === "eval") return "evaluations";
    if (value === "feedback") return "events";
    return null;
  }
}

traceQueryMetaFieldsRepository = ClickHouseTraceQueryMetaFieldsRepository.create();

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
  scenario: traceQueryMetaFieldsRepository.scenarioColumnDef("ScenarioId"),
  scenarioSet: traceQueryMetaFieldsRepository.scenarioColumnDef("ScenarioSetId"),
  scenarioBatch: traceQueryMetaFieldsRepository.scenarioColumnDef("BatchRunId"),
  scenarioVerdict: SCENARIO_VERDICT_DEF,
  scenarioStatus: SCENARIO_STATUS_DEF,
} satisfies Record<string, FieldDef>;
