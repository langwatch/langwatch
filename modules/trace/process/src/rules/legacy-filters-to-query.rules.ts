import { type FilterField, filterFieldsEnum } from "@langwatch/analytics-contract";
import { z } from "zod";

import { ClickHouseTraceQueryRepository } from "../repositories/clickhouse/clickhouse.trace-query.repository.ts";

/**
 * The legacy structured `filters` written as a trace query (liqe), for the
 * conditions migration. It answers only what `LegacyFilterMatchingService` answers
 * at settlement; a filter that service cannot match positively is named, not guessed.
 */

const filterValueSchema = z.union([
  z.array(z.string()),
  z.record(z.string(), z.array(z.string())),
  z.record(z.string(), z.record(z.string(), z.array(z.string()))),
]);
type FilterValue = z.infer<typeof filterValueSchema>;

export type LegacyFilterRefusalReason =
  | "evaluation_filter"
  | "never_matches_at_settlement"
  | "no_query_equivalent"
  | "unsupported_shape"
  | "unknown_filter_key"
  | "wildcard_value"
  | "empty_value"
  | "empty_key"
  | "unmatchable_values"
  | "rejected_by_query_gate";

export type LegacyFiltersTranslation =
  | { status: "translated"; query: string }
  | { status: "untranslatable"; filter: string; reason: LegacyFilterRefusalReason };

type FieldTranslation = { clauses: string[] } | { refused: LegacyFilterRefusalReason };

type FieldHandler = (value: FilterValue) => FieldTranslation;

const traceQueryRepository = ClickHouseTraceQueryRepository.create();

const BARE_VALUE = /^[A-Za-z][\w.-]*$/;
const RESERVED_WORDS = new Set(["true", "false", "null", "and", "or", "not"]);
const BARE_FIELD = /^[\w.-]+$/;

function quote(text: string): string {
  return `"${text.replace(/[\\"]/g, "\\$&")}"`;
}

function value({ text }: { text: string }): string {
  const isReserved = RESERVED_WORDS.has(text.toLowerCase());
  return BARE_VALUE.test(text) && !isReserved ? text : quote(text);
}

function fieldName({ name }: { name: string }): string {
  return BARE_FIELD.test(name) ? name : quote(name);
}

function refuse(reason: LegacyFilterRefusalReason): () => FieldTranslation {
  return () => ({ refused: reason });
}

/** Exact membership fields; facets that read `*` as a wildcard refuse a literal one. */
function membership({ field, wildcards }: { field: string; wildcards: boolean }): FieldHandler {
  return (filterValue) => {
    if (!Array.isArray(filterValue)) {
      return { refused: "unsupported_shape" };
    }
    if (filterValue.includes("")) {
      return { refused: "empty_value" };
    }
    if (wildcards && filterValue.some((text) => text.includes("*"))) {
      return { refused: "wildcard_value" };
    }

    return { clauses: filterValue.map((text) => `${field}:${value({ text })}`) };
  };
}

/** `["true"]` and `["false"]` are the two states of a boolean; both is no condition. */
function booleanState({ present, absent }: { present: string; absent: string }): FieldHandler {
  return (filterValue) => {
    if (!Array.isArray(filterValue)) {
      return { refused: "unsupported_shape" };
    }
    const wantsTrue = filterValue.includes("true");
    const wantsFalse = filterValue.includes("false");
    if (wantsTrue && wantsFalse) {
      return { clauses: [] };
    }
    if (!wantsTrue && !wantsFalse) {
      return { refused: "unmatchable_values" };
    }

    return { clauses: [wantsTrue ? present : absent] };
  };
}

const RESERVED_METADATA_PREFIXES = ["metadata.", "langwatch.metadata."];

/** The attribute spellings one metadata key is read from (`analytics.precondition-matchers`). */
function metadataAttributeKeys({ key }: { key: string }): string[] {
  const decoded = key.replaceAll("·", ".");
  const prefix = RESERVED_METADATA_PREFIXES.find((candidate) => decoded.startsWith(candidate));
  const resolved = prefix === undefined ? decoded : decoded.slice(prefix.length);
  const keys = [`metadata.${decoded}`, `langwatch.metadata.${decoded}`, decoded];
  if (resolved !== decoded) {
    keys.push(`metadata.${resolved}`, `langwatch.metadata.${resolved}`, resolved);
  }

  return [...new Set(keys)];
}

function keyedValues({ entry }: { entry: string[] | Record<string, string[]> }): string[] {
  return Array.isArray(entry) ? entry : Object.values(entry).flat();
}

const metadataValue: FieldHandler = (filterValue) => {
  if (Array.isArray(filterValue)) {
    return { refused: "unsupported_shape" };
  }

  const clauses: string[] = [];
  for (const [key, entry] of Object.entries(filterValue)) {
    const texts = keyedValues({ entry });
    if (texts.length === 0) {
      continue;
    }
    const decoded = key.replaceAll("·", ".");
    if (decoded === "" || RESERVED_METADATA_PREFIXES.includes(decoded)) {
      return { refused: "empty_key" };
    }
    if (texts.includes("")) {
      return { refused: "empty_value" };
    }
    for (const attribute of metadataAttributeKeys({ key })) {
      const name = fieldName({ name: `trace.attribute.${attribute}` });
      clauses.push(...texts.map((text) => `${name}:${value({ text })}`));
    }
  }

  return { clauses };
};

/** One handler per legacy filter field: adding a field without one is a compile error. */
const HANDLERS: Record<FilterField, FieldHandler> = {
  "traces.origin": membership({ field: "origin", wildcards: true }),
  "traces.error": booleanState({ present: "has:error", absent: "none:error" }),
  "traces.name": refuse("never_matches_at_settlement"),
  "metadata.user_id": membership({ field: "user", wildcards: true }),
  "metadata.thread_id": membership({ field: "conversation", wildcards: true }),
  "metadata.customer_id": membership({ field: "customer", wildcards: true }),
  "metadata.labels": membership({ field: "label", wildcards: false }),
  "metadata.prompt_ids": membership({ field: "prompt", wildcards: false }),
  "metadata.key": refuse("never_matches_at_settlement"),
  "metadata.value": metadataValue,
  "topics.topics": membership({ field: "topic", wildcards: true }),
  "topics.subtopics": membership({ field: "subtopic", wildcards: true }),
  "spans.type": refuse("never_matches_at_settlement"),
  "spans.model": membership({ field: "model", wildcards: true }),
  "events.event_type": membership({ field: "event", wildcards: false }),
  "events.metrics.key": refuse("no_query_equivalent"),
  "events.metrics.value": refuse("no_query_equivalent"),
  "events.event_details.key": refuse("no_query_equivalent"),
  "annotations.hasAnnotation": booleanState({
    present: "has:annotation",
    absent: "none:annotation",
  }),
  "evaluations.evaluator_id": refuse("evaluation_filter"),
  "evaluations.evaluator_id.guardrails_only": refuse("evaluation_filter"),
  "evaluations.evaluator_id.has_passed": refuse("evaluation_filter"),
  "evaluations.evaluator_id.has_score": refuse("evaluation_filter"),
  "evaluations.evaluator_id.has_label": refuse("evaluation_filter"),
  "evaluations.passed": refuse("evaluation_filter"),
  "evaluations.score": refuse("evaluation_filter"),
  "evaluations.state": refuse("evaluation_filter"),
  "evaluations.label": refuse("evaluation_filter"),
};

/** Empty arrays at any depth are vacuous, as the in-memory matcher reads them. */
function hasActionableCondition(candidate: unknown): boolean {
  if (Array.isArray(candidate)) {
    return candidate.length > 0;
  }
  if (typeof candidate !== "object" || candidate === null) {
    return Boolean(candidate);
  }

  return Object.values(candidate).some(hasActionableCondition);
}

/** The gate the in-memory matcher applies: what it rejects fails closed on every trace. */
function passesQueryGate({ query }: { query: string }): boolean {
  try {
    traceQueryRepository.translateFilter({
      queryText: query,
      tenantId: "__legacy_filters__",
      timeRange: { from: 0, to: 0 },
    });
    return true;
  } catch {
    return false;
  }
}

function group({ clauses }: { clauses: string[] }): string {
  return clauses.length > 1 ? `(${clauses.join(" OR ")})` : (clauses[0] ?? "");
}

/**
 * Filters AND together, values within a filter OR. A vacuous filter adds nothing;
 * `translated` with an empty query matches every trace, as empty filters do.
 */
export function translateLegacyFiltersToQuery({
  filters,
}: {
  filters: Readonly<Record<string, unknown>>;
}): LegacyFiltersTranslation {
  const groups: string[] = [];

  for (const [key, raw] of Object.entries(filters)) {
    if (!raw || !hasActionableCondition(raw)) {
      continue;
    }

    const field = filterFieldsEnum.safeParse(key);
    if (!field.success) {
      return { status: "untranslatable", filter: key, reason: "unknown_filter_key" };
    }

    const parsed = filterValueSchema.safeParse(raw);
    if (!parsed.success) {
      return { status: "untranslatable", filter: key, reason: "unsupported_shape" };
    }

    const outcome = HANDLERS[field.data](parsed.data);
    if ("refused" in outcome) {
      return { status: "untranslatable", filter: key, reason: outcome.refused };
    }
    if (outcome.clauses.length > 0) {
      groups.push(group({ clauses: outcome.clauses }));
      if (!passesQueryGate({ query: groups.join(" AND ") })) {
        return { status: "untranslatable", filter: key, reason: "rejected_by_query_gate" };
      }
    }
  }

  return { status: "translated", query: groups.join(" AND ") };
}
