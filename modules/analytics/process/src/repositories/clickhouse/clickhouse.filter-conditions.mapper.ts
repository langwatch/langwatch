/**
 * Analytics' filters as typed builder conditions over `trace_summaries` (ADR-202 Decided 19, 26).
 * A side-table filter is `(TenantId, TraceId) IN (SELECT …)` with `within`, so its inner read
 * carries the outer read's tenant scope; rows match clickhouse.filter-translator.mapper.ts.
 */
import type { AnalyticsFilterValue, FilterField } from "@langwatch/analytics-contract";
import {
  type ClickHouseReadStart,
  type ClickHouseTable,
  column,
  cond,
  type Condition,
  fn,
  type ProofScope,
  type ReadOps,
} from "@langwatch/clickhouse-client/builder";

import { evaluationRuns } from "./clickhouse.evaluation-runs.table.ts";
import { storedSpans } from "./clickhouse.stored-spans.table.ts";
import type { TraceSummaryColumns } from "./clickhouse.trace-summaries.table.ts";

/** The filters a dashboard, a feedback list or a filter picker is narrowed by. */
export type AnalyticsFilterInput = Partial<Record<FilterField, AnalyticsFilterValue>>;

/** `trace_summaries`, under its own name or an alias, that the conditions read. */
export type FilteredSummaries<Name extends string> = ClickHouseTable<Name, TraceSummaryColumns>;

/** The dashboard's window in epoch ms; span subqueries are pruned to it, two days wider. */
export type SpanWindow = { startMs: number; endMs: number };

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const STRING_ARRAY = column.array(column.string());

type Term = Condition<string>;
type SpanTerms = (spans: typeof storedSpans) => Condition<"stored_spans">;
type EvaluationTerms = (runs: typeof evaluationRuns) => Condition<"evaluation_runs">;

/** One filter leaf: a condition on the summary row, or a side table the trace must appear in. */
type Translation =
  | { kind: "row"; condition: Term }
  | { kind: "spans"; where: SpanTerms }
  | { kind: "evaluations"; where: EvaluationTerms }
  | { kind: "none" };

type Leaf = { values: string[]; key?: string; subkey?: string };

type Handler<Name extends string> = (input: {
  leaf: Leaf;
  ts: FilteredSummaries<Name>;
}) => Translation;

const row = (condition: Term): Translation => ({ kind: "row", condition });

/** `cond.and` and `cond.or` over a list, which may hold a single term. */
const allOf = <T extends string>([first, ...rest]: Condition<T>[]): Condition<T> =>
  first ? cond.and(first, ...rest) : cond.always();
const anyOf = <T extends string>([first, ...rest]: Condition<T>[]): Condition<T> =>
  first ? cond.or(first, ...rest) : cond.never();

/** Custom metadata sits under three stored keys; trace-custom-metadata-conditions.ts names them. */
export const storedMetadataKeys = (key: string): [string, string, string] => {
  const rawKey = key.replaceAll("·", ".");
  return [`metadata.${rawKey}`, `langwatch.metadata.${rawKey}`, rawKey];
};

const jsonArrayHasAny = <Name extends string>(
  ts: FilteredSummaries<Name>,
  attribute: string,
  values: string[],
): Term => fn.hasAny(fn.JSONExtract(fn.mapGet(ts.Attributes, attribute), STRING_ARRAY), values);

const metadataIn =
  <Name extends string>(attribute: string): Handler<Name> =>
  ({ leaf, ts }) =>
    row(cond.oneOf(fn.mapGet(ts.Attributes, attribute), leaf.values));

const NONE: Translation = { kind: "none" };

/** A trace-level flag filter: true alone, false alone (NULL counts as false), or nothing. */
const flag = (values: string[], isTrue: Term, isFalse: Term): Translation => {
  const hasTrue = values.includes("true");
  const hasFalse = values.includes("false");
  if (hasTrue && !hasFalse) return row(isTrue);
  if (hasFalse && !hasTrue) return row(isFalse);
  return NONE;
};

const evaluatorIs = (
  runs: typeof evaluationRuns,
  evaluatorId: string | undefined,
): Condition<"evaluation_runs">[] => (evaluatorId ? [cond.eq(runs.EvaluatorId, evaluatorId)] : []);

const evaluatorIdIn =
  (
    extra: (runs: typeof evaluationRuns) => Condition<"evaluation_runs">[] = () => [],
  ): Handler<string> =>
  ({ leaf }) => ({
    kind: "evaluations",
    where: (runs) => allOf([cond.oneOf(runs.EvaluatorId, leaf.values), ...extra(runs)]),
  });

/** Events.Attributes holding any of `keys`, paired with the event name at the same index. */
const eventAttributeKeys = ({ values, key }: Leaf): Translation => ({
  kind: "spans",
  where: (spans) =>
    key
      ? fn.arrayExists(
          (name, attributes) =>
            cond.and(cond.eq(name, key), fn.hasAny(fn.mapKeys(attributes), values)),
          spans["Events.Name"],
          spans["Events.Attributes"],
        )
      : fn.arrayExists(
          (attributes) => fn.hasAny(fn.mapKeys(attributes), values),
          spans["Events.Attributes"],
        ),
});

const parseBound = (value: string | undefined, fallback: string) =>
  Number.parseFloat(value ?? fallback);

// Exhaustive on purpose: a field added to `filterFieldsEnum` without a handler fails to compile.
const HANDLERS: Record<FilterField, Handler<string>> = {
  "topics.topics": ({ leaf, ts }) => row(cond.oneOf(ts.TopicId, leaf.values)),
  "topics.subtopics": ({ leaf, ts }) => row(cond.oneOf(ts.SubTopicId, leaf.values)),
  "metadata.user_id": metadataIn("langwatch.user_id"),
  "metadata.thread_id": metadataIn("gen_ai.conversation.id"),
  "metadata.customer_id": metadataIn("langwatch.customer_id"),
  "metadata.labels": ({ leaf, ts }) => row(jsonArrayHasAny(ts, "langwatch.labels", leaf.values)),
  "metadata.key": ({ leaf, ts }) =>
    row(
      anyOf(
        leaf.values.map((value) =>
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
  "metadata.value": ({ leaf, ts }) =>
    row(
      leaf.key
        ? anyOf(
            storedMetadataKeys(leaf.key).map((stored) =>
              cond.oneOf(fn.mapGet(ts.Attributes, stored), leaf.values),
            ),
          )
        : cond.never(),
    ),
  "metadata.prompt_ids": ({ leaf, ts }) =>
    row(jsonArrayHasAny(ts, "langwatch.prompt_ids", leaf.values)),
  "traces.origin": ({ leaf, ts }) => {
    const origin = fn.mapGet(ts.Attributes, "langwatch.origin");
    const others = leaf.values.filter((value) => value !== "application");
    const parts: Term[] = [];
    if (leaf.values.includes("application")) {
      parts.push(cond.or(cond.eq(origin, ""), cond.isNull(origin), cond.eq(origin, "application")));
    }
    if (others.length > 0) parts.push(cond.oneOf(origin, others));
    return row(anyOf(parts));
  },
  "traces.error": ({ leaf, ts }) =>
    flag(
      leaf.values,
      cond.eq(ts.ContainsErrorStatus, true),
      cond.or(cond.eq(ts.ContainsErrorStatus, false), cond.isNull(ts.ContainsErrorStatus)),
    ),
  "traces.name": ({ leaf, ts }) => row(cond.oneOf(ts.TraceName, leaf.values)),
  "spans.type": ({ leaf }) => ({
    kind: "spans",
    where: (spans) =>
      cond.oneOf(fn.mapGet(spans.SpanAttributes, "langwatch.span.type"), leaf.values),
  }),
  "spans.model": ({ leaf }) => ({
    kind: "spans",
    where: (spans) =>
      cond.oneOf(fn.mapGet(spans.SpanAttributes, "gen_ai.request.model"), leaf.values),
  }),
  "evaluations.evaluator_id": evaluatorIdIn(),
  "evaluations.evaluator_id.guardrails_only": evaluatorIdIn(),
  "evaluations.evaluator_id.has_passed": evaluatorIdIn((runs) => [cond.isNotNull(runs.Passed)]),
  "evaluations.evaluator_id.has_score": evaluatorIdIn((runs) => [cond.isNotNull(runs.Score)]),
  "evaluations.evaluator_id.has_label": evaluatorIdIn((runs) => [
    cond.isNotNull(runs.Label),
    cond.ne(runs.Label, ""),
    cond.not(cond.oneOf(runs.Label, ["succeeded", "failed"])),
  ]),
  "evaluations.passed": ({ leaf }) => ({
    kind: "evaluations",
    where: (runs) =>
      allOf([
        ...evaluatorIs(runs, leaf.key),
        cond.oneOf(
          runs.Passed,
          leaf.values.map((value) => (value === "true" || value === "1" ? 1 : 0)),
        ),
      ]),
  }),
  "evaluations.score": ({ leaf }) => ({
    kind: "evaluations",
    where: (runs) =>
      allOf([
        ...evaluatorIs(runs, leaf.key),
        cond.gte(runs.Score, parseBound(leaf.values[0], "0")),
        cond.lte(runs.Score, parseBound(leaf.values[1], "1")),
      ]),
  }),
  "evaluations.label": ({ leaf }) => ({
    kind: "evaluations",
    where: (runs) => allOf([...evaluatorIs(runs, leaf.key), cond.oneOf(runs.Label, leaf.values)]),
  }),
  "evaluations.state": ({ leaf }) => ({
    kind: "evaluations",
    where: (runs) => allOf([...evaluatorIs(runs, leaf.key), cond.oneOf(runs.Status, leaf.values)]),
  }),
  "events.event_type": ({ leaf }) => ({
    kind: "spans",
    where: (spans) => fn.hasAny(spans["Events.Name"], leaf.values),
  }),
  "events.metrics.key": ({ leaf }) => eventAttributeKeys(leaf),
  "events.metrics.value": ({ leaf }) => {
    const metricKey = leaf.subkey;
    if (!metricKey) return NONE;
    const min = parseBound(leaf.values[0], "0");
    const max = parseBound(leaf.values[1], "1");
    const eventType = leaf.key;
    return {
      kind: "spans",
      where: (spans) =>
        eventType
          ? fn.arrayExists(
              (name, attributes) => {
                const value = fn.toFloat64OrNull(fn.mapGet(attributes, metricKey));
                return cond.and(
                  cond.eq(name, eventType),
                  cond.gte(value, min),
                  cond.lte(value, max),
                );
              },
              spans["Events.Name"],
              spans["Events.Attributes"],
            )
          : fn.arrayExists((attributes) => {
              const value = fn.toFloat64OrNull(fn.mapGet(attributes, metricKey));
              return cond.and(cond.gte(value, min), cond.lte(value, max));
            }, spans["Events.Attributes"]),
    };
  },
  "events.event_details.key": ({ leaf }) => eventAttributeKeys(leaf),
  "annotations.hasAnnotation": ({ leaf, ts }) =>
    flag(
      leaf.values,
      cond.eq(ts.HasAnnotation, true),
      cond.or(cond.eq(ts.HasAnnotation, false), cond.isNull(ts.HasAnnotation)),
    ),
};

/** The leaves under one key: its value list, or one more key level of them. */
function keyedLeaves(key: string, sub: unknown): Leaf[] {
  if (Array.isArray(sub)) return sub.length === 0 ? [] : [{ values: sub as string[], key }];
  if (typeof sub !== "object" || sub === null) return [];
  return Object.entries(sub).flatMap(([subkey, values]) =>
    Array.isArray(values) && values.length > 0 ? [{ values: values as string[], key, subkey }] : [],
  );
}

/** Every leaf of a filter object: a flat value list, or one or two key levels of them. */
function leavesOf(value: AnalyticsFilterValue | undefined): Leaf[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.length === 0 ? [] : [{ values: value }];
  return Object.entries(value).flatMap(([key, sub]) => keyedLeaves(key, sub));
}

/** The leaves that filter at all; a flag naming both values (or neither) drops out. */
export function filterTranslations({
  filters,
  ts,
}: {
  filters: AnalyticsFilterInput;
  ts: FilteredSummaries<string>;
}): Exclude<Translation, { kind: "none" }>[] {
  return (Object.entries(filters) as [FilterField, AnalyticsFilterValue | undefined][]).flatMap(
    ([field, value]) => {
      const handler = HANDLERS[field];
      if (!handler) return [];
      return leavesOf(value).flatMap((leaf) => {
        const translation = handler({ leaf, ts });
        return translation.kind === "none" ? [] : [translation];
      });
    },
  );
}

/** The evaluation runs' `(TenantId, TraceId)` a translation keeps, in the proof's windows. */
function evaluationsRead<Ctes extends Record<string, unknown>>({
  sub,
  where,
}: {
  sub: ClickHouseReadStart<ProofScope, Ctes>;
  where: EvaluationTerms;
}) {
  return sub
    .from(evaluationRuns)
    .withinWindows()
    .select({ TenantId: evaluationRuns.TenantId, TraceId: evaluationRuns.TraceId })
    .where(() => where(evaluationRuns));
}

/** The spans' `(TenantId, TraceId)` a translation keeps, in the proof's windows and the window. */
function spansRead<Ctes extends Record<string, unknown>>({
  sub,
  where,
  spanWindow,
}: {
  sub: ClickHouseReadStart<ProofScope, Ctes>;
  where: SpanTerms;
  spanWindow: SpanWindow | undefined;
}) {
  return sub
    .from(storedSpans)
    .withinWindows()
    .select({ TenantId: storedSpans.TenantId, TraceId: storedSpans.TraceId })
    .where(({ gte, lt }) =>
      allOf([
        ...(spanWindow
          ? [
              gte(storedSpans.StartTime, spanWindow.startMs - TWO_DAYS_MS),
              lt(storedSpans.StartTime, spanWindow.endMs + TWO_DAYS_MS),
            ]
          : []),
        where(storedSpans),
      ]),
    );
}

/**
 * The filters as one condition for a fenced read's `where`; the side-table reads hold the proof's
 * windows. No filter is `1 = 1`, as main wrote it. `negated` (the negate toggle) is `NOT a OR
 * NOT b`, a side-table term `NOT IN`, so a subquery's own scope predicate is never inverted.
 */
export function analyticsFilterCondition<Name extends string>({
  filters,
  ts,
  spanWindow,
  negated = false,
}: {
  filters: AnalyticsFilterInput;
  ts: FilteredSummaries<Name>;
  spanWindow?: SpanWindow;
  negated?: boolean;
}) {
  const translations = filterTranslations({ filters, ts: ts as FilteredSummaries<string> });

  return <Tables extends string, Ctes extends Record<string, unknown>>(
    ops: ReadOps<ProofScope, Tables | Name, Ctes>,
  ): Condition<Tables | Name> => {
    if (translations.length === 0) return cond.always();
    const key = fn.tuple(ts.TenantId, ts.TraceId);
    const terms = translations.map((translation): Term => {
      switch (translation.kind) {
        case "row":
          return negated ? cond.not(translation.condition) : translation.condition;
        case "evaluations":
          return ops.within(key, (sub) => evaluationsRead({ sub, where: translation.where }), {
            negated,
          });
        case "spans":
          return ops.within(
            key,
            (sub) => spansRead({ sub, where: translation.where, spanWindow }),
            { negated },
          );
      }
    });
    // Every term reads the summaries alias or a subquery of its own, so it reads only `Name`.
    return (negated ? anyOf(terms) : allOf(terms)) as Condition<Tables | Name>;
  };
}
