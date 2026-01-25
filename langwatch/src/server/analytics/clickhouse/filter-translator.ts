/**
 * Filter Translator - Converts ES filter definitions to ClickHouse WHERE clauses.
 *
 * This module translates the ES query patterns used in analytics filters
 * to equivalent ClickHouse WHERE clause fragments.
 */

import type { FilterField } from "../../filters/types";
import { type CHTable, tableAliases } from "./field-mappings";

/**
 * Result of translating an ES filter to CH WHERE clause
 */
export interface FilterTranslation {
  /** The WHERE clause fragment (without the WHERE keyword) */
  whereClause: string;
  /** Tables that need to be JOINed for this filter */
  requiredJoins: CHTable[];
  /** Whether this filter uses EXISTS subquery pattern */
  usesExistsSubquery?: boolean;
}

/**
 * Escape a string value for use in SQL
 */
function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Convert an array of values to SQL IN clause format
 */
function toInClause(values: string[]): string {
  return values.map((v) => `'${escapeString(v)}'`).join(", ");
}

/**
 * Translate a filter field and values to CH WHERE clause
 */
export function translateFilter(
  field: FilterField,
  values: string[],
  key?: string,
  subkey?: string,
): FilterTranslation {
  const requiredJoins: CHTable[] = [];

  if (values.length === 0) {
    return { whereClause: "1=1", requiredJoins };
  }

  switch (field) {
    // ===== Topic Filters =====
    case "topics.topics":
      return translateTopicFilter(values);

    case "topics.subtopics":
      return translateSubtopicFilter(values);

    // ===== Metadata Filters =====
    case "metadata.user_id":
      return translateMetadataFilter("langwatch.user_id", values);

    case "metadata.thread_id":
      return translateMetadataFilter("gen_ai.conversation.id", values);

    case "metadata.customer_id":
      return translateMetadataFilter("langwatch.customer_id", values);

    case "metadata.labels":
      return translateLabelsFilter(values);

    case "metadata.key":
      return translateMetadataKeyFilter(values);

    case "metadata.value":
      return translateMetadataValueFilter(values, key);

    case "metadata.prompt_ids":
      return translatePromptIdsFilter(values);

    // ===== Trace Filters =====
    case "traces.error":
      return translateErrorFilter(values);

    // ===== Span Filters =====
    case "spans.type":
      return translateSpanTypeFilter(values);

    case "spans.model":
      return translateSpanModelFilter(values);

    // ===== Evaluation Filters =====
    case "evaluations.evaluator_id":
    case "evaluations.evaluator_id.guardrails_only":
      return translateEvaluatorIdFilter(values);

    case "evaluations.passed":
      return translateEvaluationPassedFilter(values, key);

    case "evaluations.score":
      return translateEvaluationScoreFilter(values, key);

    case "evaluations.label":
      return translateEvaluationLabelFilter(values, key);

    case "evaluations.state":
      return translateEvaluationStateFilter(values, key);

    // ===== Event Filters =====
    case "events.event_type":
      return translateEventTypeFilter(values);

    case "events.metrics.key":
      return translateEventMetricKeyFilter(values, key);

    case "events.metrics.value":
      return translateEventMetricValueFilter(values, key, subkey);

    case "events.event_details.key":
      return translateEventDetailKeyFilter(values, key);

    // ===== Annotation Filters =====
    case "annotations.hasAnnotation":
      return translateAnnotationFilter(values);

    default:
      // Unknown filter - return no-op
      return { whereClause: "1=1", requiredJoins };
  }
}

/**
 * Translate topic filter
 */
function translateTopicFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  return {
    whereClause: `${ts}.TopicId IN (${toInClause(values)})`,
    requiredJoins: [],
  };
}

/**
 * Translate subtopic filter
 */
function translateSubtopicFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  return {
    whereClause: `${ts}.SubTopicId IN (${toInClause(values)})`,
    requiredJoins: [],
  };
}

/**
 * Translate metadata attribute filter
 */
function translateMetadataFilter(
  attributeKey: string,
  values: string[],
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  return {
    whereClause: `${ts}.Attributes['${attributeKey}'] IN (${toInClause(values)})`,
    requiredJoins: [],
  };
}

/**
 * Translate labels filter (JSON array in attributes)
 */
function translateLabelsFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  // Labels are stored as JSON array string, need to check if any label matches
  const conditions = values.map(
    (v) =>
      `has(JSONExtract(${ts}.Attributes['langwatch.labels'], 'Array(String)'), '${escapeString(v)}')`,
  );
  return {
    whereClause: `(${conditions.join(" OR ")})`,
    requiredJoins: [],
  };
}

/**
 * Translate metadata key exists filter
 */
function translateMetadataKeyFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  // Check if any of the keys exist in Attributes
  const conditions = values.map(
    (v) => `mapContains(${ts}.Attributes, '${escapeString(v)}')`,
  );
  return {
    whereClause: `(${conditions.join(" OR ")})`,
    requiredJoins: [],
  };
}

/**
 * Translate metadata value filter (requires key)
 */
function translateMetadataValueFilter(
  values: string[],
  key?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  if (!key) {
    return { whereClause: "1=1", requiredJoins: [] };
  }

  // Key may have dots replaced with special char, restore them
  const attributeKey = key.replace(/·/g, ".");

  return {
    whereClause: `${ts}.Attributes['${escapeString(attributeKey)}'] IN (${toInClause(values)})`,
    requiredJoins: [],
  };
}

/**
 * Translate prompt IDs filter
 */
function translatePromptIdsFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  // Prompt IDs are stored as JSON array string
  const conditions = values.map(
    (v) =>
      `has(JSONExtract(${ts}.Attributes['langwatch.prompt_ids'], 'Array(String)'), '${escapeString(v)}')`,
  );
  return {
    whereClause: `(${conditions.join(" OR ")})`,
    requiredJoins: [],
  };
}

/**
 * Translate error filter
 */
function translateErrorFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;

  const hasTrue = values.includes("true");
  const hasFalse = values.includes("false");

  if (hasTrue && !hasFalse) {
    return {
      whereClause: `${ts}.ContainsErrorStatus = 1`,
      requiredJoins: [],
    };
  } else if (hasFalse && !hasTrue) {
    return {
      whereClause: `${ts}.ContainsErrorStatus = 0`,
      requiredJoins: [],
    };
  }

  // Both or neither - no filtering
  return { whereClause: "1=1", requiredJoins: [] };
}

/**
 * Translate span type filter (requires JOIN)
 */
function translateSpanTypeFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        AND ${ss}.SpanAttributes['langwatch.span.type'] IN (${toInClause(values)})
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate span model filter (requires JOIN)
 */
function translateSpanModelFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        AND ${ss}.SpanAttributes['gen_ai.request.model'] IN (${toInClause(values)})
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate evaluator ID filter (requires JOIN)
 */
function translateEvaluatorIdFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const es = tableAliases.evaluation_states;

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_states ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        AND ${es}.EvaluatorId IN (${toInClause(values)})
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate evaluation passed filter
 */
function translateEvaluationPassedFilter(
  values: string[],
  evaluatorId?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const es = tableAliases.evaluation_states;

  // Convert string values to boolean
  const passedValues = values.map((v) =>
    v === "true" || v === "1" ? "1" : "0",
  );

  const evaluatorCondition = evaluatorId
    ? `AND ${es}.EvaluatorId = '${escapeString(evaluatorId)}'`
    : "";

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_states ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        ${evaluatorCondition}
        AND ${es}.Passed IN (${passedValues.join(", ")})
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate evaluation score filter (numeric range)
 */
function translateEvaluationScoreFilter(
  values: string[],
  evaluatorId?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const es = tableAliases.evaluation_states;

  // Values should be [min, max] for numeric range
  const minValue = parseFloat(values[0] ?? "0");
  const maxValue = parseFloat(values[1] ?? "1");

  const evaluatorCondition = evaluatorId
    ? `AND ${es}.EvaluatorId = '${escapeString(evaluatorId)}'`
    : "";

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_states ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        ${evaluatorCondition}
        AND ${es}.Score >= ${minValue}
        AND ${es}.Score <= ${maxValue}
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate evaluation label filter
 */
function translateEvaluationLabelFilter(
  values: string[],
  evaluatorId?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const es = tableAliases.evaluation_states;

  const evaluatorCondition = evaluatorId
    ? `AND ${es}.EvaluatorId = '${escapeString(evaluatorId)}'`
    : "";

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_states ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        ${evaluatorCondition}
        AND ${es}.Label IN (${toInClause(values)})
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate evaluation state filter
 */
function translateEvaluationStateFilter(
  values: string[],
  evaluatorId?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const es = tableAliases.evaluation_states;

  const evaluatorCondition = evaluatorId
    ? `AND ${es}.EvaluatorId = '${escapeString(evaluatorId)}'`
    : "";

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_states ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        ${evaluatorCondition}
        AND ${es}.Status IN (${toInClause(values)})
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate event type filter
 */
function translateEventTypeFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  const conditions = values.map(
    (v) => `has(${ss}."Events.Name", '${escapeString(v)}')`,
  );

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        AND (${conditions.join(" OR ")})
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate event metric key filter
 */
function translateEventMetricKeyFilter(
  values: string[],
  eventType?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  const eventCondition = eventType
    ? `AND has(${ss}."Events.Name", '${escapeString(eventType)}')`
    : "";

  // Events.Attributes is Array(Map(String, String))
  // Need to check if any attribute map contains the metric key
  const keyConditions = values.map(
    (v) =>
      `arrayExists(x -> mapContains(x, '${escapeString(v)}'), ${ss}."Events.Attributes")`,
  );

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        ${eventCondition}
        AND (${keyConditions.join(" OR ")})
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate event metric value filter (numeric range)
 */
function translateEventMetricValueFilter(
  values: string[],
  eventType?: string,
  metricKey?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  if (!metricKey) {
    return { whereClause: "1=1", requiredJoins: [] };
  }

  const eventCondition = eventType
    ? `AND has(${ss}."Events.Name", '${escapeString(eventType)}')`
    : "";

  // Values should be [min, max] for numeric range
  const minValue = parseFloat(values[0] ?? "0");
  const maxValue = parseFloat(values[1] ?? "1");

  // Check if any event's attribute matches the key and value is in range
  const valueCondition = `arrayExists(
    x -> toFloat64OrNull(x['${escapeString(metricKey)}']) >= ${minValue}
      AND toFloat64OrNull(x['${escapeString(metricKey)}']) <= ${maxValue},
    ${ss}."Events.Attributes"
  )`;

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        ${eventCondition}
        AND ${valueCondition}
    )`,
    requiredJoins: [],
    usesExistsSubquery: true,
  };
}

/**
 * Translate event detail key filter
 */
function translateEventDetailKeyFilter(
  values: string[],
  eventType?: string,
): FilterTranslation {
  // Same as metric key filter - event details are stored in Events.Attributes
  return translateEventMetricKeyFilter(values, eventType);
}

/**
 * Translate annotation filter
 */
function translateAnnotationFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;

  const hasTrue = values.includes("true");
  const hasFalse = values.includes("false");

  if (hasTrue && !hasFalse) {
    return {
      whereClause: `${ts}.HasAnnotation = 1`,
      requiredJoins: [],
    };
  } else if (hasFalse && !hasTrue) {
    return {
      whereClause: `(${ts}.HasAnnotation = 0 OR ${ts}.HasAnnotation IS NULL)`,
      requiredJoins: [],
    };
  }

  // Both or neither - no filtering
  return { whereClause: "1=1", requiredJoins: [] };
}

/**
 * Combine multiple filter translations with AND
 */
export function combineFilters(
  translations: FilterTranslation[],
): FilterTranslation {
  const nonTrivial = translations.filter((t) => t.whereClause !== "1=1");

  if (nonTrivial.length === 0) {
    return { whereClause: "1=1", requiredJoins: [] };
  }

  const whereClauses = nonTrivial.map((t) => `(${t.whereClause})`);
  const allJoins = new Set<CHTable>();
  for (const t of nonTrivial) {
    for (const join of t.requiredJoins) {
      allJoins.add(join);
    }
  }

  return {
    whereClause: whereClauses.join(" AND "),
    requiredJoins: Array.from(allJoins),
  };
}

/**
 * Translate all filters from a filter object
 */
export function translateAllFilters(
  filters: Partial<
    Record<
      FilterField,
      | string[]
      | Record<string, string[]>
      | Record<string, Record<string, string[]>>
    >
  >,
): FilterTranslation {
  const translations: FilterTranslation[] = [];

  for (const [field, value] of Object.entries(filters)) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      continue;
    }

    if (Array.isArray(value)) {
      // Simple array filter
      translations.push(translateFilter(field as FilterField, value));
    } else if (typeof value === "object") {
      // Nested filter with key
      for (const [key, subValue] of Object.entries(value)) {
        if (Array.isArray(subValue)) {
          translations.push(
            translateFilter(field as FilterField, subValue, key),
          );
        } else if (typeof subValue === "object") {
          // Double nested with key and subkey
          for (const [subkey, subSubValue] of Object.entries(subValue)) {
            if (Array.isArray(subSubValue)) {
              translations.push(
                translateFilter(
                  field as FilterField,
                  subSubValue,
                  key,
                  subkey,
                ),
              );
            }
          }
        }
      }
    }
  }

  return combineFilters(translations);
}
