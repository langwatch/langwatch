/**
 * Filter Translator - Converts ES filter definitions to ClickHouse WHERE clauses.
 *
 * WHY REGISTRY PATTERN: ClickHouse requires different WHERE clause patterns
 * depending on where data is stored (trace_summaries vs stored_spans vs
 * evaluation_runs). Some filters use simple attribute lookups, others need
 * EXISTS subqueries with JOINs. The registry pattern:
 * 1. Makes it easy to add new filter types without modifying existing code (OCP)
 * 2. Centralizes the mapping of filter fields to their translation logic
 * 3. Provides a clear, testable contract for each filter type
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
  /** Parameter values for parameterized queries */
  params: Record<string, unknown>;
  /** Whether this filter uses EXISTS subquery pattern */
  usesExistsSubquery?: boolean;
}

/**
 * Handler function type for filter translation
 */
type FilterHandler = (
  values: string[],
  key?: string,
  subkey?: string,
) => FilterTranslation;

/**
 * Parameter counter for generating unique parameter names
 */
let paramCounter = 0;

/**
 * Reset the parameter counter (useful for testing)
 */
export function resetParamCounter(): void {
  paramCounter = 0;
}

/**
 * Generate a unique parameter name
 */
function genParamName(prefix: string): string {
  return `${prefix}_${paramCounter++}`;
}

/**
 * Registry of filter handlers by field type.
 *
 * WHY: This registry maps filter fields to their translation functions,
 * eliminating the need for a large switch statement. Each handler knows
 * how to translate its specific filter type to ClickHouse SQL.
 */
const filterHandlers: Partial<Record<FilterField, FilterHandler>> = {
  // Topic Filters
  "topics.topics": (values) => translateTopicFilter(values),
  "topics.subtopics": (values) => translateSubtopicFilter(values),

  // Metadata Filters
  "metadata.user_id": (values) =>
    translateMetadataFilter("langwatch.user_id", values),
  "metadata.thread_id": (values) =>
    translateMetadataFilter("gen_ai.conversation.id", values),
  "metadata.customer_id": (values) =>
    translateMetadataFilter("langwatch.customer_id", values),
  "metadata.labels": (values) => translateLabelsFilter(values),
  "metadata.key": (values) => translateMetadataKeyFilter(values),
  "metadata.value": (values, key) => translateMetadataValueFilter(values, key),
  "metadata.prompt_ids": (values) => translatePromptIdsFilter(values),

  // Trace Filters
  "traces.error": (values) => translateErrorFilter(values),

  // Span Filters
  "spans.type": (values) => translateSpanTypeFilter(values),
  "spans.model": (values) => translateSpanModelFilter(values),

  // Evaluation Filters
  "evaluations.evaluator_id": (values) => translateEvaluatorIdFilter(values),
  "evaluations.evaluator_id.guardrails_only": (values) =>
    translateEvaluatorIdFilter(values),
  "evaluations.passed": (values, key) =>
    translateEvaluationPassedFilter(values, key),
  "evaluations.score": (values, key) =>
    translateEvaluationScoreFilter(values, key),
  "evaluations.label": (values, key) =>
    translateEvaluationLabelFilter(values, key),
  "evaluations.state": (values, key) =>
    translateEvaluationStateFilter(values, key),

  // Event Filters
  "events.event_type": (values) => translateEventTypeFilter(values),
  "events.metrics.key": (values, key) =>
    translateEventMetricKeyFilter(values, key),
  "events.metrics.value": (values, key, subkey) =>
    translateEventMetricValueFilter(values, key, subkey),
  "events.event_details.key": (values, key) =>
    translateEventDetailKeyFilter(values, key),

  // Annotation Filters
  "annotations.hasAnnotation": (values) => translateAnnotationFilter(values),
};

/**
 * Default no-op filter translation
 */
const noOpFilter: FilterTranslation = {
  whereClause: "1=1",
  requiredJoins: [],
  params: {},
};

/**
 * Translate a filter field and values to CH WHERE clause.
 *
 * Uses registry lookup instead of switch statement for better extensibility.
 */
export function translateFilter(
  field: FilterField,
  values: string[],
  key?: string,
  subkey?: string,
): FilterTranslation {
  if (values.length === 0) {
    return noOpFilter;
  }

  const handler = filterHandlers[field];
  return handler ? handler(values, key, subkey) : noOpFilter;
}

/**
 * Translate topic filter.
 *
 * WHY PARAMETERIZED QUERIES: All filter translations use parameterized queries
 * instead of string interpolation to prevent SQL injection attacks. The
 * parameter names are auto-generated with a counter to ensure uniqueness
 * when multiple filters of the same type are combined.
 */
function translateTopicFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("topicIds");
  return {
    whereClause: `${ts}.TopicId IN ({${paramName}:Array(String)})`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate subtopic filter
 */
function translateSubtopicFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("subtopicIds");
  return {
    whereClause: `${ts}.SubTopicId IN ({${paramName}:Array(String)})`,
    requiredJoins: [],
    params: { [paramName]: values },
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
  const paramName = genParamName("metaValues");
  return {
    whereClause: `${ts}.Attributes[{${paramName}_key:String}] IN ({${paramName}:Array(String)})`,
    requiredJoins: [],
    params: { [`${paramName}_key`]: attributeKey, [paramName]: values },
  };
}

/**
 * Translate labels filter (JSON array in attributes)
 */
function translateLabelsFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("labels");
  // Labels are stored as JSON array string, use hasAny with parameterized array
  return {
    whereClause: `hasAny(JSONExtract(${ts}.Attributes['langwatch.labels'], 'Array(String)'), {${paramName}:Array(String)})`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate metadata key exists filter
 */
function translateMetadataKeyFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("metaKeys");
  // Use arrayExists to check if any key exists
  return {
    whereClause: `arrayExists(k -> mapContains(${ts}.Attributes, k), {${paramName}:Array(String)})`,
    requiredJoins: [],
    params: { [paramName]: values },
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
    return { whereClause: "1=1", requiredJoins: [], params: {} };
  }

  // Key may have dots replaced with special char, restore them
  const attributeKey = key.replace(/·/g, ".");
  const paramName = genParamName("metaValue");

  return {
    whereClause: `${ts}.Attributes[{${paramName}_key:String}] IN ({${paramName}:Array(String)})`,
    requiredJoins: [],
    params: { [`${paramName}_key`]: attributeKey, [paramName]: values },
  };
}

/**
 * Translate prompt IDs filter
 */
function translatePromptIdsFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("promptIds");
  // Prompt IDs are stored as JSON array string, use hasAny with parameterized array
  return {
    whereClause: `hasAny(JSONExtract(${ts}.Attributes['langwatch.prompt_ids'], 'Array(String)'), {${paramName}:Array(String)})`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate error filter
 * Uses ContainsErrorStatus from trace_summaries which captures errors from
 * multiple sources: StatusCode, error attributes, and exception events.
 * This is more reliable and performant than an EXISTS subquery.
 */
function translateErrorFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;

  const hasTrue = values.includes("true");
  const hasFalse = values.includes("false");

  if (hasTrue && !hasFalse) {
    return {
      whereClause: `${ts}.ContainsErrorStatus = 1`,
      requiredJoins: [],
      params: {},
    };
  } else if (hasFalse && !hasTrue) {
    return {
      whereClause: `(${ts}.ContainsErrorStatus = 0 OR ${ts}.ContainsErrorStatus IS NULL)`,
      requiredJoins: [],
      params: {},
    };
  }

  // Both or neither - no filtering
  return { whereClause: "1=1", requiredJoins: [], params: {} };
}

/**
 * Translate span type filter (requires JOIN).
 *
 * WHY EXISTS SUBQUERY: Span-level filters use EXISTS instead of direct JOINs
 * because a trace can have multiple spans. A direct JOIN would duplicate the
 * trace for each matching span, inflating count metrics. EXISTS returns true
 * once a matching span is found, preserving correct trace counts.
 */
function translateSpanTypeFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const paramName = genParamName("spanTypes");

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        AND ${ss}.SpanAttributes['langwatch.span.type'] IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
    usesExistsSubquery: true,
  };
}

/**
 * Translate span model filter (requires JOIN)
 */
function translateSpanModelFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const paramName = genParamName("models");

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        AND ${ss}.SpanAttributes['gen_ai.request.model'] IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
    usesExistsSubquery: true,
  };
}

/**
 * Translate evaluator ID filter (requires JOIN)
 */
function translateEvaluatorIdFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const es = tableAliases.evaluation_runs;
  const paramName = genParamName("evaluatorIds");

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_runs ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        AND ${es}.EvaluatorId IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
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
  const es = tableAliases.evaluation_runs;
  const paramName = genParamName("evalPassed");

  // Convert string values to UInt8 (boolean in CH)
  const passedValues = values.map((v) =>
    v === "true" || v === "1" ? 1 : 0,
  );

  const params: Record<string, unknown> = { [paramName]: passedValues };
  let evaluatorCondition = "";

  if (evaluatorId) {
    const evalIdParam = genParamName("evaluatorId");
    evaluatorCondition = `AND ${es}.EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_runs ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        ${evaluatorCondition}
        AND ${es}.Passed IN ({${paramName}:Array(UInt8)})
    )`,
    requiredJoins: [],
    params,
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
  const es = tableAliases.evaluation_runs;
  const minParam = genParamName("scoreMin");
  const maxParam = genParamName("scoreMax");

  // Values should be [min, max] for numeric range
  const minValue = parseFloat(values[0] ?? "0");
  const maxValue = parseFloat(values[1] ?? "1");

  const params: Record<string, unknown> = {
    [minParam]: minValue,
    [maxParam]: maxValue,
  };
  let evaluatorCondition = "";

  if (evaluatorId) {
    const evalIdParam = genParamName("evaluatorId");
    evaluatorCondition = `AND ${es}.EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_runs ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        ${evaluatorCondition}
        AND ${es}.Score >= {${minParam}:Float64}
        AND ${es}.Score <= {${maxParam}:Float64}
    )`,
    requiredJoins: [],
    params,
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
  const es = tableAliases.evaluation_runs;
  const paramName = genParamName("evalLabels");

  const params: Record<string, unknown> = { [paramName]: values };
  let evaluatorCondition = "";

  if (evaluatorId) {
    const evalIdParam = genParamName("evaluatorId");
    evaluatorCondition = `AND ${es}.EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_runs ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        ${evaluatorCondition}
        AND ${es}.Label IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params,
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
  const es = tableAliases.evaluation_runs;
  const paramName = genParamName("evalStates");

  const params: Record<string, unknown> = { [paramName]: values };
  let evaluatorCondition = "";

  if (evaluatorId) {
    const evalIdParam = genParamName("evaluatorId");
    evaluatorCondition = `AND ${es}.EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_runs ${es}
      WHERE ${es}.TenantId = ${ts}.TenantId
        AND ${es}.TraceId = ${ts}.TraceId
        ${evaluatorCondition}
        AND ${es}.Status IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params,
    usesExistsSubquery: true,
  };
}

/**
 * Translate event type filter
 */
function translateEventTypeFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const paramName = genParamName("eventTypes");

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        AND hasAny(${ss}."Events.Name", {${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
    usesExistsSubquery: true,
  };
}

/**
 * Translate event metric key filter
 *
 * Uses paired arrayExists to correlate Events.Name with Events.Attributes at the same index.
 * This prevents false positives where event type matches at one index but key matches at another.
 */
function translateEventMetricKeyFilter(
  values: string[],
  eventType?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const keysParam = genParamName("metricKeys");

  const params: Record<string, unknown> = { [keysParam]: values };

  // Events.Attributes is Array(Map(String, String))
  // Use paired arrayExists to check name and attributes at the same index
  let metricKeyCondition: string;
  if (eventType) {
    const eventTypeParam = genParamName("eventType");
    params[eventTypeParam] = eventType;
    // Correlate event name and attributes at the same array index
    metricKeyCondition = `arrayExists(
      (name, attrs) -> name = {${eventTypeParam}:String}
        AND arrayExists(k -> mapContains(attrs, k), {${keysParam}:Array(String)}),
      ${ss}."Events.Name",
      ${ss}."Events.Attributes"
    )`;
  } else {
    // No event type filter, just check attributes
    metricKeyCondition = `arrayExists(
      x -> arrayExists(k -> mapContains(x, k), {${keysParam}:Array(String)}),
      ${ss}."Events.Attributes"
    )`;
  }

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        AND ${metricKeyCondition}
    )`,
    requiredJoins: [],
    params,
    usesExistsSubquery: true,
  };
}

/**
 * Translate event metric value filter (numeric range)
 *
 * Uses paired arrayExists to correlate Events.Name with Events.Attributes at the same index.
 * This prevents false positives where event type matches at one index but value matches at another.
 */
function translateEventMetricValueFilter(
  values: string[],
  eventType?: string,
  metricKey?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;

  if (!metricKey) {
    return { whereClause: "1=1", requiredJoins: [], params: {} };
  }

  const metricKeyParam = genParamName("metricKey");
  const minParam = genParamName("metricMin");
  const maxParam = genParamName("metricMax");

  // Values should be [min, max] for numeric range
  const minValue = parseFloat(values[0] ?? "0");
  const maxValue = parseFloat(values[1] ?? "1");

  const params: Record<string, unknown> = {
    [metricKeyParam]: metricKey,
    [minParam]: minValue,
    [maxParam]: maxValue,
  };

  // Use paired arrayExists to check name and value at the same index
  let valueCondition: string;
  if (eventType) {
    const eventTypeParam = genParamName("eventType");
    params[eventTypeParam] = eventType;
    // Correlate event name and attribute value at the same array index
    valueCondition = `arrayExists(
      (name, attrs) -> name = {${eventTypeParam}:String}
        AND toFloat64OrNull(attrs[{${metricKeyParam}:String}]) >= {${minParam}:Float64}
        AND toFloat64OrNull(attrs[{${metricKeyParam}:String}]) <= {${maxParam}:Float64},
      ${ss}."Events.Name",
      ${ss}."Events.Attributes"
    )`;
  } else {
    // No event type filter, just check attribute value range
    valueCondition = `arrayExists(
      x -> toFloat64OrNull(x[{${metricKeyParam}:String}]) >= {${minParam}:Float64}
        AND toFloat64OrNull(x[{${metricKeyParam}:String}]) <= {${maxParam}:Float64},
      ${ss}."Events.Attributes"
    )`;
  }

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        AND ${valueCondition}
    )`,
    requiredJoins: [],
    params,
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
      params: {},
    };
  } else if (hasFalse && !hasTrue) {
    return {
      whereClause: `(${ts}.HasAnnotation = 0 OR ${ts}.HasAnnotation IS NULL)`,
      requiredJoins: [],
      params: {},
    };
  }

  // Both or neither - no filtering
  return { whereClause: "1=1", requiredJoins: [], params: {} };
}

/**
 * Combine multiple filter translations with AND.
 *
 * WHY FILTER NON-TRIVIAL: "1=1" is the no-op placeholder for empty filters.
 * We filter these out before combining to avoid bloating the WHERE clause
 * with unnecessary conditions. This also makes the generated SQL more readable
 * for debugging and performance analysis.
 */
export function combineFilters(
  translations: FilterTranslation[],
): FilterTranslation {
  const nonTrivial = translations.filter((t) => t.whereClause !== "1=1");

  if (nonTrivial.length === 0) {
    return { whereClause: "1=1", requiredJoins: [], params: {} };
  }

  const whereClauses = nonTrivial.map((t) => `(${t.whereClause})`);
  const allJoins = new Set<CHTable>();
  const allParams: Record<string, unknown> = {};

  for (const t of nonTrivial) {
    for (const join of t.requiredJoins) {
      allJoins.add(join);
    }
    Object.assign(allParams, t.params);
  }

  return {
    whereClause: whereClauses.join(" AND "),
    requiredJoins: Array.from(allJoins),
    params: allParams,
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
