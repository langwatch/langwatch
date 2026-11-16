import {
  type TagToken,
  type FieldDef,
  type InMemoryTrace,
  UNSUPPORTED,
  type Unsupported,
} from "@langwatch/trace-contract";

import {
  TRACE_ATTRIBUTE_PREFIX_LEGACY,
  extractStringValue,
  likeMatch,
  parseJsonStringArray,
  readAttribute,
} from "./trace-query-values.rules.ts";

/**
 * Built-in existence categories for `has:` and `none:`.
 * `attribute.<key>` is also accepted dynamically.
 */
export const HAS_VALUES = [
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
export const SCENARIO_STATUS_BY_LABEL: Record<string, string> = {
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

export const SCENARIO_VERDICT_BY_LABEL: Record<string, string> = {
  success: "SUCCESS",
  failure: "FAILURE",
  failed: "FAILURE",
  inconclusive: "INCONCLUSIVE",
};

// ---------------------------------------------------------------------------
// trace / traceId
// ---------------------------------------------------------------------------

const TRACE_ID_DEF: FieldDef = {
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const id = trace.summary.traceId;
    const matched = value.includes("*") ? likeMatch(id, value) : id === value;
    return negated ? !matched : matched;
  },
};

// ---------------------------------------------------------------------------
// has / none — existence categories
// ---------------------------------------------------------------------------

const HAS_DEF: FieldDef = {
  evaluateInMemory: (tag, negated, trace) => evaluateExistence(tag, negated, trace),
};

const NONE_DEF: FieldDef = {
  evaluateInMemory: (tag, negated, trace) => evaluateExistence(tag, !negated, trace),
};

// ---------------------------------------------------------------------------
// eval / event / prompt
// ---------------------------------------------------------------------------

const EVAL_DEF: FieldDef = {
  needs: "evaluations",
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.evaluations == null) return UNSUPPORTED;
    const value = extractStringValue(tag);
    const matched = trace.evaluations.some((e) => e.evaluatorName === value);
    return negated ? !matched : matched;
  },
};

const EVENT_DEF: FieldDef = {
  needs: "events",
  evaluateInMemory: (tag, negated, trace) => {
    if (trace.events == null) return UNSUPPORTED;
    const value = extractStringValue(tag);
    const matched = trace.events.some((e) => e.name === value);
    return negated ? !matched : matched;
  },
};

// Prompt IDs are hoisted onto trace_summaries as a JSON array string in
// `Attributes['langwatch.prompt_ids']`; `parseJsonStringArray` reads it as the SQL does.
const PROMPT_DEF: FieldDef = {
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const promptIds = parseJsonStringArray(trace.summary.attributes["langwatch.prompt_ids"]) ?? [];
    const matched = promptIds.includes(value);
    return negated ? !matched : matched;
  },
};

// A span-level id lookup: deriving spans at dispatch time is a later phase, so it
// can't be positively evaluated yet.
const SPAN_ID_DEF: FieldDef = {
  evaluateInMemory: () => UNSUPPORTED,
};

// ---------------------------------------------------------------------------
// scenario fields
// ---------------------------------------------------------------------------

// Direct match on the hoisted attribute. No join.
const SCENARIO_RUN_DEF: FieldDef = {
  evaluateInMemory: (tag, negated, trace) => {
    const value = extractStringValue(tag);
    const matched = (trace.summary.attributes["scenario.run_id"] ?? "") === value;
    return negated ? !matched : matched;
  },
};

// scenario dimensions resolve through a `simulation_runs` subquery, a table the
// in-memory trace doesn't carry — fail closed for now.
const SCENARIO_VERDICT_DEF: FieldDef = {
  evaluateInMemory: () => UNSUPPORTED,
};

const SCENARIO_STATUS_DEF: FieldDef = {
  evaluateInMemory: () => UNSUPPORTED,
};

/**
 * Trace fields that are not columns: trace_id normalization and existence checks.
 */

/**
 * Extracts attribute key from trace.attribute.* or attribute.* prefix.
 */
export function traceAttributeKeyOf(
  value: string,
): { kind: "attribute"; key: string } | { kind: "other" } {
  if (value.startsWith("trace.attribute.")) {
    return { kind: "attribute", key: value.slice("trace.attribute.".length) };
  }
  if (value.startsWith(TRACE_ATTRIBUTE_PREFIX_LEGACY)) {
    return { kind: "attribute", key: value.slice(TRACE_ATTRIBUTE_PREFIX_LEGACY.length) };
  }
  return { kind: "other" };
}

/**
 * The event name user feedback lands under. A `thumbs_up_down` tracked event,
 * whether sent to `POST /api/events/track` or reconstructed from an SDK
 * `langwatch.event` span event, is stored as an event of this name.
 */
export const FEEDBACK_TRACKED_EVENT_TYPE = "thumbs_up_down";

/**
 * What each `has:`/`none:` value probes, keyed by the value. A Map, not an object, because
 * the key is user-supplied and a prototype key (`constructor`, `toString`) must not resolve.
 */
const EXISTENCE_PROBES: ReadonlyMap<string, (trace: InMemoryTrace) => boolean | Unsupported> =
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
        trace.events == null
          ? UNSUPPORTED
          : trace.events.some((e) => e.name === FEEDBACK_TRACKED_EVENT_TYPE),
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
    ["service", (trace: InMemoryTrace) => (trace.summary.attributes["service.name"] ?? "") !== ""],
    ["traceName", (trace: InMemoryTrace) => (trace.summary.traceName ?? "") !== ""],
    ["rootSpanType", (trace: InMemoryTrace) => (trace.summary.rootSpanType ?? "") !== ""],
  ]);

function evaluateExistence(
  tag: TagToken,
  negated: boolean,
  trace: InMemoryTrace,
): boolean | Unsupported {
  const value = extractStringValue(tag);
  const polarise = (present: boolean) => (negated ? !present : present);

  const traceAttr = traceAttributeKeyOf(value);
  if (traceAttr.kind === "attribute") {
    const traceAttrKey = traceAttr.key;
    // Empty key throws on the SQL side (422) — fail closed here.
    if (!traceAttrKey) return UNSUPPORTED;
    // Own-key read: the key is user-supplied, and a plain `attrs[key]` made
    // `has:attribute.constructor` truthy on *every* trace (inherited
    // `Object.prototype.constructor`) while the compiled
    // `Attributes['constructor'] != ''` matched none of them.
    return polarise(readAttribute(trace.summary.attributes, traceAttrKey) !== "");
  }

  const probe = EXISTENCE_PROBES.get(value);
  // Unknown value throws on the SQL side — fail closed here.
  if (!probe) return UNSUPPORTED;

  const present = probe(trace);

  return present === UNSUPPORTED ? UNSUPPORTED : polarise(present);
}

// Scenario dimensions live in `simulation_runs`, which the in-memory trace doesn't carry.
const SCENARIO_COLUMN_DEF: FieldDef = { evaluateInMemory: () => UNSUPPORTED };

/**
 * Which auxiliary collection a has/none filter reads, or null for trace summary.
 */
export function classifyExistenceSource(value: string): "evaluations" | "events" | null {
  if (value === "eval") return "evaluations";
  if (value === "feedback") return "events";
  return null;
}

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
  scenario: SCENARIO_COLUMN_DEF,
  scenarioSet: SCENARIO_COLUMN_DEF,
  scenarioBatch: SCENARIO_COLUMN_DEF,
  scenarioVerdict: SCENARIO_VERDICT_DEF,
  scenarioStatus: SCENARIO_STATUS_DEF,
} satisfies Record<string, FieldDef>;
