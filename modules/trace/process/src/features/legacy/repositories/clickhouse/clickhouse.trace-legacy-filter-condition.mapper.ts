/**
 * A legacy `filters` document as builder conditions over `trace_summaries` (ADR-202 Decided 18):
 * each field keeps the rows main's text conditions matched; a side-table field is
 * `(TenantId, TraceId) IN (SELECT …)` under the filtered read's own scope.
 */
import {
  analyticsFilterValueSchema,
  type AnalyticsFilterValue,
  type FilterField,
} from "@langwatch/analytics-contract";
import { cond, type Condition, fn, type ReaderScope } from "@langwatch/clickhouse-client/builder";
import { z } from "zod";

import { evaluationRuns } from "../../../../repositories/clickhouse/clickhouse.evaluation-runs.table.ts";
import { storedSpans } from "../../../../repositories/clickhouse/clickhouse.stored-spans.table.ts";
import { traceSummaries } from "../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import type { TraceFilterCondition } from "../../../query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";

const ts = traceSummaries;
const spans = storedSpans;
const runs = evaluationRuns;

type SummaryTerm = Condition<"trace_summaries">;
type SpanTerm = Condition<"stored_spans">;
type RunTerm = Condition<"evaluation_runs">;

/** One leaf: a condition on the summary row, or a side table the trace must appear in. */
type Translation =
  | { kind: "row"; condition: SummaryTerm }
  | { kind: "spans"; condition: SpanTerm }
  | { kind: "evaluations"; condition: RunTerm };

type Leaf = { values: string[]; key?: string; subkey?: string };
type Handler = (leaf: Leaf) => Translation;

/** Label values that name pass/fail status rather than a classification label. */
const STATUS_LABEL_VALUES = ["succeeded", "failed"];

/** Spans start near the trace's `OccurredAt`; the span window is two days wider each side. */
const SPAN_WINDOW_BUFFER_MS = 2 * 24 * 60 * 60 * 1000;

const row = (condition: SummaryTerm): Translation => ({ kind: "row", condition });
const onSpans = (condition: SpanTerm): Translation => ({ kind: "spans", condition });
const onRuns = (condition: RunTerm): Translation => ({ kind: "evaluations", condition });

function allOf<T extends string>([first, ...rest]: readonly Condition<T>[]): Condition<T> {
  if (!first) return cond.always();
  return rest.length === 0 ? first : cond.and(first, ...rest);
}

function anyOf<T extends string>([first, ...rest]: readonly Condition<T>[]): Condition<T> {
  if (!first) return cond.never();
  return rest.length === 0 ? first : cond.or(first, ...rest);
}

/** Custom metadata sits under three stored keys, as trace-custom-metadata-conditions.ts names
 * them. */
function storedMetadataKeys(key: string): [string, string, string] {
  const rawKey = key.replaceAll("·", ".");
  return [`metadata.${rawKey}`, `langwatch.metadata.${rawKey}`, rawKey];
}

const attributeIn =
  (attribute: string): Handler =>
  ({ values }) =>
    row(cond.oneOf(fn.mapGet(ts.Attributes, attribute), values));

/** A JSON-array attribute holding any value; main quoted each value with `concat('"', x, '"')`. */
const jsonArrayHasAny =
  (attribute: string): Handler =>
  ({ values }) =>
    row(
      fn.hasAny(
        fn.JSONExtractArrayRaw(fn.mapGet(ts.Attributes, attribute)),
        values.map((value) => `"${value}"`),
      ),
    );

/** A trace flag: true, false (`isFalse`), both (everything) or neither (nothing). */
function flag(values: string[], isTrue: SummaryTerm, isFalse: SummaryTerm): Translation {
  const hasTrue = values.includes("true");
  const hasFalse = values.includes("false");
  if (hasTrue && hasFalse) return row(cond.always());
  if (hasTrue) return row(isTrue);
  if (hasFalse) return row(isFalse);
  return row(cond.never());
}

const evaluatorIdIn =
  (extra: RunTerm[] = []): Handler =>
  ({ values }) =>
    onRuns(allOf([cond.oneOf(runs.EvaluatorId, values), ...extra]));

/** A leaf's range: a finite, ordered `[min, max]` from its first two values, or invalid. */
type ValueRange = { kind: "range"; min: number; max: number } | { kind: "invalid" };

function parseRange(values: string[]): ValueRange {
  if (values.length < 2) return { kind: "invalid" };
  const min = Number.parseFloat(values[0] ?? "");
  const max = Number.parseFloat(values[1] ?? "");
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return { kind: "invalid" };
  return { kind: "range", min, max };
}

const eventTypeIs = (key: string): SpanTerm =>
  cond.eq(fn.mapGet(spans.SpanAttributes, "event.type"), key);

/** Spans of event type `key` carrying a non-empty `<prefix>.<value>` attribute for any value. */
const eventAttributeKeys =
  (prefix: string): Handler =>
  ({ values, key }) => {
    if (!key) return row(cond.never());
    const present = values.map((value) =>
      cond.ne(fn.mapGet(spans.SpanAttributes, `${prefix}.${value}`), ""),
    );
    return onSpans(cond.and(eventTypeIs(key), anyOf(present)));
  };

const evaluationOf =
  (condition: (leaf: Leaf & { key: string }) => RunTerm | undefined): Handler =>
  (leaf) => {
    if (!leaf.key) return row(cond.never());
    const term = condition({ ...leaf, key: leaf.key });
    return term ? onRuns(cond.and(cond.eq(runs.EvaluatorId, leaf.key), term)) : row(cond.never());
  };

// Exhaustive on purpose: a field added to `filterFieldsEnum` without a handler fails to compile.
const HANDLERS: Record<FilterField, Handler> = {
  "topics.topics": ({ values }) => row(cond.oneOf(ts.TopicId, values)),
  "topics.subtopics": ({ values }) => row(cond.oneOf(ts.SubTopicId, values)),
  "metadata.user_id": attributeIn("langwatch.user_id"),
  "metadata.thread_id": attributeIn("gen_ai.conversation.id"),
  "metadata.customer_id": attributeIn("langwatch.customer_id"),
  "metadata.labels": jsonArrayHasAny("langwatch.labels"),
  "metadata.key": ({ values }) =>
    row(
      anyOf(
        values.map((value) =>
          anyOf(
            storedMetadataKeys(value).map((stored) =>
              cond.and(
                fn.mapContains(ts.Attributes, stored),
                cond.ne(fn.mapGet(ts.Attributes, stored), ""),
              ),
            ),
          ),
        ),
      ),
    ),
  "metadata.value": ({ values, key }) =>
    row(
      key
        ? anyOf(
            storedMetadataKeys(key).map((stored) =>
              cond.oneOf(fn.mapGet(ts.Attributes, stored), values),
            ),
          )
        : cond.never(),
    ),
  "metadata.prompt_ids": jsonArrayHasAny("langwatch.prompt_ids"),
  "traces.origin": ({ values }) => {
    const origin = fn.mapGet(ts.Attributes, "langwatch.origin");
    // Main's `if(ifNull(o, '') = '', 'application', o)`, its branches swapped.
    const named = fn.if(cond.ne(fn.ifNull(origin, ""), ""), origin, "application");
    return row(values.length === 0 ? cond.never() : cond.oneOf(named, values));
  },
  "traces.error": ({ values }) =>
    flag(values, cond.eq(ts.ContainsErrorStatus, true), cond.eq(ts.ContainsErrorStatus, false)),
  "traces.name": ({ values }) => row(cond.oneOf(ts.TraceName, values)),
  "spans.type": ({ values }) =>
    onSpans(cond.oneOf(fn.mapGet(spans.SpanAttributes, "langwatch.span.type"), values)),
  "spans.model": ({ values }) => row(fn.hasAny(ts.Models, values)),
  "annotations.hasAnnotation": ({ values }) =>
    flag(
      values,
      cond.eq(ts.HasAnnotation, true),
      cond.or(cond.eq(ts.HasAnnotation, false), cond.isNull(ts.HasAnnotation)),
    ),
  "evaluations.evaluator_id": evaluatorIdIn(),
  "evaluations.evaluator_id.guardrails_only": evaluatorIdIn([cond.eq(runs.IsGuardrail, 1)]),
  "evaluations.evaluator_id.has_passed": evaluatorIdIn([cond.isNotNull(runs.Passed)]),
  "evaluations.evaluator_id.has_score": evaluatorIdIn([cond.isNotNull(runs.Score)]),
  "evaluations.evaluator_id.has_label": evaluatorIdIn([
    cond.isNotNull(runs.Label),
    cond.ne(runs.Label, ""),
    cond.not(cond.oneOf(runs.Label, STATUS_LABEL_VALUES)),
  ]),
  "evaluations.passed": evaluationOf(({ values }) =>
    cond.oneOf(
      runs.Passed,
      values.map((value) => (value === "true" || value === "1" ? 1 : 0)),
    ),
  ),
  "evaluations.score": evaluationOf(({ values }) => {
    const range = parseRange(values);
    return range.kind === "range"
      ? cond.and(cond.gte(runs.Score, range.min), cond.lte(runs.Score, range.max))
      : undefined;
  }),
  "evaluations.state": evaluationOf(({ values }) => cond.oneOf(runs.Status, values)),
  "evaluations.label": evaluationOf(({ values }) => cond.oneOf(runs.Label, values)),
  "events.event_type": ({ values }) =>
    onSpans(cond.oneOf(fn.mapGet(spans.SpanAttributes, "event.type"), values)),
  "events.metrics.key": eventAttributeKeys("event.metrics"),
  "events.metrics.value": ({ values, key, subkey }) => {
    const range = parseRange(values);
    if (!key || !subkey || range.kind === "invalid") return row(cond.never());
    const value = fn.toFloat64OrNull(fn.mapGet(spans.SpanAttributes, `event.metrics.${subkey}`));
    return onSpans(
      cond.and(eventTypeIs(key), cond.gte(value, range.min), cond.lte(value, range.max)),
    );
  },
  "events.event_details.key": eventAttributeKeys("event.details"),
};

/** Leaves of one key level, ORed as main ORed siblings; nested deeper levels recurse. */
type Node = { kind: "leaf"; leaf: Leaf } | { kind: "any"; nodes: Node[] };

/** The value's leaves under `keys`: none, one leaf, or one `any` over its several children. */
function findNodes({ value, keys }: { value: unknown; keys: string[] }): Node[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const [key, subkey] = keys;
    return [
      {
        kind: "leaf",
        leaf: {
          values: value as string[],
          ...(key === undefined ? {} : { key }),
          ...(subkey === undefined ? {} : { subkey }),
        },
      },
    ];
  }
  if (typeof value !== "object" || value === null) return [];
  const nodes = Object.entries(value).flatMap(([key, next]) =>
    findNodes({ value: next, keys: [...keys, key] }),
  );
  return nodes.length <= 1 ? nodes : [{ kind: "any", nodes }];
}

/** Absent, an empty list or an empty object narrows nothing. */
function isEmptyValue(value: unknown): boolean {
  if (!value) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

const legacyFiltersSchema = z.record(z.string(), analyticsFilterValueSchema);

/** The span window: the read's window two days wider each side; none without both ends. */
export type LegacySpanWindow = { startDate?: number; endDate?: number };

/** A legacy `filters` document compiled: one term per field, and whether a field is unknown. */
export interface LegacyTraceFilterTerms {
  terms: TraceFilterCondition[];
  hasUnsupportedFilters: boolean;
}

function isFilterField(field: string): field is FilterField {
  return Object.hasOwn(HANDLERS, field);
}

/**
 * Parses a legacy `filters` document into terms for a built `trace_summaries` read; fields AND,
 * a field's keyed leaves OR. Under a proof each side read keeps to its windows (Decided 27).
 */
export function legacyTraceFilterTerms({
  filters,
  window,
  scope,
}: {
  filters: Readonly<Record<string, unknown>>;
  window?: LegacySpanWindow;
  scope: ReaderScope;
}): LegacyTraceFilterTerms {
  const parsed = legacyFiltersSchema.parse(filters) as Record<string, AnalyticsFilterValue>;
  const windowed = scope.kind === "proof";
  const spanWindow =
    typeof window?.startDate === "number" && typeof window.endDate === "number"
      ? {
          from: Math.max(0, window.startDate - SPAN_WINDOW_BUFFER_MS),
          to: window.endDate + SPAN_WINDOW_BUFFER_MS,
        }
      : undefined;
  let hasUnsupportedFilters = false;
  const terms: TraceFilterCondition[] = [];
  for (const [field, value] of Object.entries(parsed)) {
    if (isEmptyValue(value)) continue;
    if (!isFilterField(field)) {
      hasUnsupportedFilters = true;
      continue;
    }
    for (const node of findNodes({ value, keys: [] })) {
      terms.push(termOf({ node, handler: HANDLERS[field], windowed, spanWindow }));
    }
  }
  return { terms, hasUnsupportedFilters };
}

function termOf({
  node,
  handler,
  windowed,
  spanWindow,
}: {
  node: Node;
  handler: Handler;
  windowed: boolean;
  spanWindow: { from: number; to: number } | undefined;
}): TraceFilterCondition {
  if (node.kind === "any") {
    const parts = node.nodes.map((inner) => termOf({ node: inner, handler, windowed, spanWindow }));
    return (ops) => anyOf(parts.map((part) => part(ops)));
  }
  const translation = handler(node.leaf);
  if (translation.kind === "row") return () => translation.condition;
  return sideTerm({ translation, windowed, spanWindow });
}

/** A trace whose (TenantId, TraceId) appears in the side table, read under the read's scope. */
function sideTerm({
  translation,
  windowed,
  spanWindow,
}: {
  translation: Exclude<Translation, { kind: "row" }>;
  windowed: boolean;
  spanWindow: { from: number; to: number } | undefined;
}): TraceFilterCondition {
  const key = fn.tuple(ts.TenantId, ts.TraceId);
  if (translation.kind === "spans") {
    return (ops) =>
      ops.within(key, (sub) => {
        const read = sub
          .from(spans)
          .select({ TenantId: spans.TenantId, TraceId: spans.TraceId })
          .where(({ gte, lte }) =>
            allOf([
              ...(spanWindow
                ? [gte(spans.StartTime, spanWindow.from), lte(spans.StartTime, spanWindow.to)]
                : []),
              translation.condition,
            ]),
          );
        return windowed ? read.withinWindows() : read;
      });
  }
  return (ops) =>
    ops.within(key, (sub) => {
      const read = sub
        .from(runs)
        .select({ TenantId: runs.TenantId, TraceId: runs.TraceId })
        .where(() => translation.condition);
      return windowed ? read.withinWindows() : read;
    });
}
