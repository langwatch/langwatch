import type { FilterField } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  type Condition,
  cond,
  type Expression,
  fn,
  param,
  type ReaderReadStatement,
} from "@langwatch/clickhouse-client/builder";
import { evaluationRunDataSchema } from "@langwatch/evaluation-contract";

import { evaluationRuns } from "./clickhouse.evaluation-runs.table.ts";
import {
  ATTRIBUTE_KEYS,
  extractStandardResults,
  PICKER_LIMIT,
  pickerEvaluations,
  pickerSpans,
  pickerSummaries,
  startsLike,
} from "./clickhouse.filter-query-helpers.mapper.ts";
import type {
  ClickHouseFilterDefinition,
  FilterOptionsReadInput,
} from "./clickhouse.filter-shapes.mapper.ts";
import { storedSpans } from "./clickhouse.stored-spans.table.ts";
import { traceSummaries } from "./clickhouse.trace-summaries.table.ts";

/** Label values that represent pass/fail status rather than classification labels. */
const STATUS_LABEL_VALUES = ["succeeded", "failed"] as const;

const ts = traceSummaries;
const ss = storedSpans;
const runs = evaluationRuns;

type SummaryValue = Expression<string | null, "trace_summaries">;

/**
 * A trace_summaries picker offering one expression's distinct values, by count's field and label,
 * with the prefix search on the value; `nonEmpty` leaves out the empty value.
 */
function summaryValuePicker({
  value,
  nonEmpty = true,
  needsKey = false,
}: {
  value: (input: FilterOptionsReadInput) => SummaryValue;
  nonEmpty?: boolean;
  needsKey?: boolean;
}): ClickHouseFilterDefinition {
  return {
    tableName: "trace_summaries",
    buildQuery: (input) => {
      if (needsKey && !input.key) return null;
      const of = value(input);
      const read = pickerSummaries(input).select({ field: of, label: of, count: fn.count() });
      const kept = nonEmpty ? read.where(({ ne }) => ne(of, "")) : read;
      const searched = input.query ? kept.where(() => startsLike(of, input.query ?? "")) : kept;
      return searched
        .groupBy(of)
        .orderBy("field", "ASC")
        .limit(PICKER_LIMIT)
        .build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  };
}

/**
 * A trace_summaries picker over the values of a JSON array attribute, each element unquoted. The
 * empty and `null` tests read the raw element, as main's did on 26.8 (analytics-built-reads
 * row-equality suite).
 */
function summaryJsonArrayPicker(attribute: string): ClickHouseFilterDefinition {
  return {
    tableName: "trace_summaries",
    buildQuery: (input) => {
      const raw = fn.mapGet(ts.Attributes, attribute);
      const elements = pickerSummaries(input)
        .select({ element: fn.arrayJoin(fn.JSONExtractArrayRaw(raw)) })
        .where(({ and, ne }) => and(ne(raw, ""), ne(raw, "[]")))
        .as("elements");
      const unquoted = fn.trimBoth(elements.element, '"');
      const read = clickhouseRead({ scope: input.scope })
        .from(elements)
        .select({ field: unquoted, label: unquoted, count: fn.count() })
        .where(({ and, ne }) => and(ne(elements.element, ""), ne(elements.element, "null")));
      const searched = input.query
        ? read.where(() => startsLike(unquoted, input.query ?? ""))
        : read;
      return searched
        .groupBy(elements.element)
        .orderBy(elements.element, "ASC")
        .limit(PICKER_LIMIT)
        .build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  };
}

/** A stored_spans picker offering one span attribute's distinct non-empty values. */
function spanAttributePicker(attribute: string): ClickHouseFilterDefinition {
  return {
    tableName: "stored_spans",
    buildQuery: (input) => {
      const of = fn.mapGet(ss.SpanAttributes, attribute);
      const read = pickerSpans(input)
        .select({ field: of, label: of, count: fn.count() })
        .where(({ ne }) => ne(of, ""));
      const searched = input.query ? read.where(() => startsLike(of, input.query ?? "")) : read;
      return searched
        .groupBy(of)
        .orderBy("field", "ASC")
        .limit(PICKER_LIMIT)
        .build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  };
}

/** The span attribute keys under `prefix` on one event type's spans, the prefix removed. */
function eventAttributeKeyPicker(prefix: string): ClickHouseFilterDefinition {
  return {
    tableName: "stored_spans",
    buildQuery: (input) => {
      if (!input.key) return null;
      const eventType = input.key;
      const keys = pickerSpans(input)
        .select({
          full_key: fn.arrayJoin(
            fn.arrayFilter((key) => fn.startsWith(key, prefix), fn.mapKeys(ss.SpanAttributes)),
          ),
        })
        .where(({ eq }) => eq(fn.mapGet(ss.SpanAttributes, "event.type"), eventType))
        .as("event_keys");
      const field = fn.replaceOne(keys.full_key, prefix, "");
      const read = clickhouseRead({ scope: input.scope })
        .from(keys)
        .select({ full_key: keys.full_key, field, label: field, count: fn.count() })
        .groupBy(keys.full_key)
        .having(({ ne }) => ne(field, ""));
      const searched = input.query ? read.having(() => startsLike(field, input.query ?? "")) : read;
      return searched.orderBy("field", "ASC").limit(PICKER_LIMIT).build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  };
}

/**
 * Factory for evaluator_id ClickHouse filter definitions.
 * All 5 variants share the same read, differing only in an additional condition.
 */
function buildEvaluatorIdClickHouseFilter(
  additionalWhere?: () => Condition<"evaluation_runs">,
): ClickHouseFilterDefinition {
  return {
    tableName: "evaluation_runs",
    buildQuery: (input) => {
      const label = fn.if(
        cond.ne(runs.EvaluatorName, ""),
        fn.concat("[", runs.EvaluatorType, "] ", runs.EvaluatorName),
        fn.concat("[", runs.EvaluatorType, "] ", runs.EvaluatorId),
      );
      const read = pickerEvaluations(input).select({
        field: runs.EvaluatorId,
        label,
        count: fn.count(),
      });
      const narrowed = additionalWhere ? read.where(additionalWhere) : read;
      const searched = input.query
        ? narrowed.where(() => startsLike(fn.ifNull(runs.EvaluatorName, ""), input.query ?? ""))
        : narrowed;
      return searched
        .groupBy(runs.EvaluatorId, runs.EvaluatorType, runs.EvaluatorName)
        .orderBy("label", "ASC")
        .limit(PICKER_LIMIT)
        .build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  };
}

/** A classification label: present, not empty, and not a pass/fail status. */
const isClassificationLabel = () =>
  cond.and(
    cond.isNotNull(runs.Label),
    cond.ne(runs.Label, ""),
    cond.not(cond.oneOf(runs.Label, STATUS_LABEL_VALUES)),
  );

/**
 * ClickHouse filter definitions for each filter field.
 * Each definition specifies how to query filter options from ClickHouse.
 * Set to null for filters with no ClickHouse options query.
 */
export const clickHouseFilters: Record<FilterField, ClickHouseFilterDefinition | null> = {
  // Topics filters
  "topics.topics": summaryValuePicker({ value: () => ts.TopicId }),
  "topics.subtopics": summaryValuePicker({ value: () => ts.SubTopicId }),

  // Metadata filters
  "metadata.user_id": summaryValuePicker({
    value: () => fn.mapGet(ts.Attributes, ATTRIBUTE_KEYS.user_id),
  }),
  "metadata.thread_id": summaryValuePicker({
    value: () => fn.mapGet(ts.Attributes, ATTRIBUTE_KEYS.thread_id),
  }),
  "metadata.customer_id": summaryValuePicker({
    value: () => fn.mapGet(ts.Attributes, ATTRIBUTE_KEYS.customer_id),
  }),

  "metadata.labels": summaryJsonArrayPicker("langwatch.labels"),

  "metadata.key": {
    tableName: "trace_summaries",
    buildQuery: (input) => {
      const keys = pickerSummaries(input)
        .select({ key: fn.arrayJoin(fn.mapKeys(ts.Attributes)) })
        .as("attribute_keys");
      const read = clickhouseRead({ scope: input.scope })
        .from(keys)
        .select({
          field: fn.replaceAll(keys.key, ".", "·"),
          label: keys.key,
          count: fn.count(),
        })
        .where(({ and, not }) =>
          and(not(fn.startsWith(keys.key, "langwatch.")), not(fn.startsWith(keys.key, "gen_ai."))),
        );
      const searched = input.query
        ? read.where(() => startsLike(keys.key, input.query ?? ""))
        : read;
      return searched
        .groupBy(keys.key)
        .orderBy(keys.key, "ASC")
        .limit(PICKER_LIMIT)
        .build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  },

  "metadata.value": summaryValuePicker({
    needsKey: true,
    value: (input) => fn.mapGet(ts.Attributes, input.key ?? ""),
  }),

  "metadata.prompt_ids": summaryJsonArrayPicker("langwatch.prompt_ids"),

  // Trace filters
  "traces.origin": summaryValuePicker({
    nonEmpty: false,
    value: () => {
      const origin = fn.mapGet(ts.Attributes, "langwatch.origin");
      return fn.if(cond.ne(origin, ""), origin, "application");
    },
  }),

  "traces.error": {
    tableName: "trace_summaries",
    buildQuery: (input) =>
      pickerSummaries(input)
        .select({
          field: fn.if(cond.eq(ts.ContainsErrorStatus, true), param.string("true"), "false"),
          label: fn.if(
            cond.eq(ts.ContainsErrorStatus, true),
            param.string("Traces with error"),
            "Traces without error",
          ),
          count: fn.count(),
        })
        .groupBy(ts.ContainsErrorStatus)
        .orderBy("field", "ASC")
        .build() as ReaderReadStatement,
    extractResults: extractStandardResults,
  },

  "traces.name": summaryValuePicker({ value: () => ts.TraceName }),

  // Span filters
  "spans.type": spanAttributePicker("langwatch.span.type"),

  "spans.model": {
    tableName: "trace_summaries",
    buildQuery: (input) => {
      const models = pickerSummaries(input)
        .select({ model: fn.arrayJoin(ts.Models) })
        .as("models");
      const read = clickhouseRead({ scope: input.scope })
        .from(models)
        .select({ field: models.model, label: models.model, count: fn.count() })
        .where(({ ne }) => ne(models.model, ""));
      const searched = input.query
        ? read.where(() => startsLike(models.model, input.query ?? ""))
        : read;
      return searched
        .groupBy(models.model)
        .orderBy(models.model, "ASC")
        .limit(PICKER_LIMIT)
        .build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  },

  // Annotation filters
  "annotations.hasAnnotation": {
    tableName: "trace_summaries",
    buildQuery: (input) =>
      pickerSummaries(input)
        .select({
          field: fn.if(cond.eq(ts.HasAnnotation, true), param.string("true"), "false"),
          label: fn.if(
            cond.eq(ts.HasAnnotation, true),
            param.string("Has Annotation"),
            "No Annotation",
          ),
          count: fn.count(),
        })
        .groupBy(ts.HasAnnotation)
        .orderBy("field", "DESC")
        .build() as ReaderReadStatement,
    extractResults: extractStandardResults,
  },

  // Evaluation filters - using evaluation_runs table, held to the traces the other filters pick
  "evaluations.evaluator_id": buildEvaluatorIdClickHouseFilter(),

  "evaluations.evaluator_id.guardrails_only": buildEvaluatorIdClickHouseFilter(() =>
    cond.eq(runs.IsGuardrail, 1),
  ),

  "evaluations.evaluator_id.has_passed": buildEvaluatorIdClickHouseFilter(() =>
    cond.isNotNull(runs.Passed),
  ),

  "evaluations.evaluator_id.has_score": buildEvaluatorIdClickHouseFilter(() =>
    cond.isNotNull(runs.Score),
  ),

  "evaluations.evaluator_id.has_label": buildEvaluatorIdClickHouseFilter(isClassificationLabel),

  "evaluations.passed": {
    tableName: "evaluation_runs",
    buildQuery: (input) => {
      if (!input.key) return null;
      const evaluatorId = input.key;
      return pickerEvaluations(input)
        .select({
          field: fn.if(cond.eq(runs.Passed, 1), param.string("true"), "false"),
          label: fn.if(cond.eq(runs.Passed, 1), param.string("Passed"), "Failed"),
          count: fn.count(),
        })
        .where(({ and, eq, isNotNull }) =>
          and(eq(runs.EvaluatorId, evaluatorId), isNotNull(runs.Passed)),
        )
        .groupBy(runs.Passed)
        .orderBy("field", "DESC")
        .build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  },

  "evaluations.score": {
    tableName: "evaluation_runs",
    buildQuery: (input) => {
      if (!input.key) return null;
      const evaluatorId = input.key;
      return pickerEvaluations(input)
        .select({ min_score: fn.min(runs.Score), max_score: fn.max(runs.Score) })
        .where(({ and, eq, isNotNull }) =>
          and(eq(runs.EvaluatorId, evaluatorId), isNotNull(runs.Score)),
        )
        .build() as ReaderReadStatement;
    },
    extractResults: (rows: unknown[]) => {
      const row = (rows as { min_score: number | null; max_score: number | null }[])[0];
      if (!row || row.min_score === null || row.max_score === null) {
        return [];
      }
      return [
        { field: String(row.min_score), label: "min", count: 0 },
        { field: String(row.max_score), label: "max", count: 0 },
      ];
    },
  },

  "evaluations.state": {
    tableName: "evaluation_runs",
    buildQuery: (input) => {
      if (!input.key) return null;
      const evaluatorId = input.key;
      return pickerEvaluations(input)
        .select({ field: runs.Status, label: runs.Status, count: fn.count() })
        .where(({ and, eq, not, oneOf }) =>
          and(eq(runs.EvaluatorId, evaluatorId), not(oneOf(runs.Status, STATUS_LABEL_VALUES))),
        )
        .groupBy(runs.Status)
        .orderBy(runs.Status, "ASC")
        .limit(PICKER_LIMIT)
        .build() as ReaderReadStatement;
    },
    // The option list is the canonical EvaluationStatus enum, not distinct
    // Status values in ClickHouse (#4805) — a stored-only value produced an
    // alert that could never fire. Deriving from the enum keeps them linked:
    // an enum change fails CI here. Missing statuses report a 0 count.
    extractResults: (rows) => {
      const observedCounts = new Map(
        extractStandardResults(rows).map((option) => [option.field, option.count]),
      );
      return evaluationRunDataSchema.shape.status.options.map((status) => ({
        field: status,
        label: status,
        count: observedCounts.get(status) ?? 0,
      }));
    },
  },

  "evaluations.label": {
    tableName: "evaluation_runs",
    buildQuery: (input) => {
      if (!input.key) return null;
      const evaluatorId = input.key;
      const read = pickerEvaluations(input)
        .select({ field: runs.Label, label: runs.Label, count: fn.count() })
        .where(({ and, eq }) => and(eq(runs.EvaluatorId, evaluatorId), isClassificationLabel()));
      const searched = input.query
        ? read.where(() => startsLike(runs.Label, input.query ?? ""))
        : read;
      return searched
        .groupBy(runs.Label)
        .orderBy(runs.Label, "ASC")
        .limit(PICKER_LIMIT)
        .build() as ReaderReadStatement;
    },
    extractResults: extractStandardResults,
  },

  // Event filters - using stored_spans table with span attributes
  "events.event_type": spanAttributePicker("event.type"),

  "events.metrics.key": eventAttributeKeyPicker("event.metrics."),

  "events.metrics.value": {
    tableName: "stored_spans",
    buildQuery: (input) => {
      if (!input.key || !input.subkey) return null;
      const eventType = input.key;
      const metric = fn.mapGet(ss.SpanAttributes, `event.metrics.${input.subkey}`);
      return pickerSpans(input)
        .select({
          min_value: fn.min(fn.toFloat64OrNull(metric)),
          max_value: fn.max(fn.toFloat64OrNull(metric)),
        })
        .where(({ and, eq, ne }) =>
          and(eq(fn.mapGet(ss.SpanAttributes, "event.type"), eventType), ne(metric, "")),
        )
        .build() as ReaderReadStatement;
    },
    extractResults: (rows: unknown[]) => {
      const row = (rows as { min_value: number | null; max_value: number | null }[])[0];
      if (!row || row.min_value === null || row.max_value === null) {
        return [];
      }
      return [
        { field: String(Math.floor(row.min_value)), label: "min", count: 0 },
        { field: String(Math.ceil(row.max_value)), label: "max", count: 0 },
      ];
    },
  },

  "events.event_details.key": eventAttributeKeyPicker("event.details."),
};
