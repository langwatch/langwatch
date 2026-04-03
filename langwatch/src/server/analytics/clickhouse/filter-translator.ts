/**
 * Filter Translator - Converts ES filter definitions to ClickHouse WHERE clauses.
 *
 * WHY REGISTRY PATTERN: ClickHouse requires different WHERE clause patterns
 * depending on where data is stored (trace_summaries vs stored_spans vs
 * evaluation_runs). Some filters use simple attribute lookups, others need
 * IN subqueries. The registry pattern:
 * 1. Makes it easy to add new filter types without modifying existing code (OCP)
 * 2. Centralizes the mapping of filter fields to their translation logic
 * 3. Provides a clear, testable contract for each filter type
 *
 * WHY IN SUBQUERIES (NOT EXISTS): ClickHouse v25.10 planner crashes with
 * "Cannot clone Sorting plan step" when EXISTS subqueries are combined with
 * LIMIT 1 BY in JOINed subqueries (issue #2660). All cross-table filters use
 * `ts.TraceId IN (SELECT TraceId FROM ... WHERE TenantId = {tenantId:String} AND ...)`
 * which is semantically equivalent to EXISTS and avoids the planner bug.
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
const filterHandlers: Record<FilterField, FilterHandler | null> = {
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
  "traces.origin": (values) => translateOriginFilter(values),
  "traces.error": (values) => translateErrorFilter(values),

  // Span Filters
  "spans.type": (values) => translateSpanTypeFilter(values),
  "spans.model": (values) => translateSpanModelFilter(values),

  // Evaluation Filters
  "evaluations.evaluator_id": (values) => translateEvaluatorIdFilter(values),
  "evaluations.evaluator_id.guardrails_only": (values) =>
    translateEvaluatorIdFilter(values),
  "evaluations.evaluator_id.has_passed": (values) =>
    translateEvaluatorIdFilter(values, "AND Passed IS NOT NULL"),
  "evaluations.evaluator_id.has_score": (values) =>
    translateEvaluatorIdFilter(values, "AND Score IS NOT NULL"),
  "evaluations.evaluator_id.has_label": (values) =>
    translateEvaluatorIdFilter(
      values,
      "AND Label IS NOT NULL AND Label != '' AND Label NOT IN ('succeeded', 'failed')",
    ),
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
 * Translate origin filter.
 *
 * "application" is the default origin for traces that have no explicit
 * langwatch.origin attribute (empty string or NULL). All other origin
 * values (e.g. "evaluation", "simulation", "playground") are matched
 * directly. When multiple origins are selected they are ORed together.
 */
function translateOriginFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;

  const hasApplication = values.includes("application");
  const otherValues = values.filter((v) => v !== "application");

  const parts: string[] = [];
  const params: Record<string, unknown> = {};

  if (hasApplication) {
    parts.push(
      `(${ts}.Attributes['langwatch.origin'] = '' OR ${ts}.Attributes['langwatch.origin'] IS NULL OR ${ts}.Attributes['langwatch.origin'] = 'application')`,
    );
  }

  if (otherValues.length > 0) {
    const paramName = genParamName("originValues");
    parts.push(
      `${ts}.Attributes['langwatch.origin'] IN ({${paramName}:Array(String)})`,
    );
    params[paramName] = otherValues;
  }

  if (parts.length === 0) {
    return { whereClause: "1=0", requiredJoins: [], params: {} };
  }

  return {
    whereClause: parts.length === 1 ? parts[0]! : `(${parts.join(" OR ")})`,
    requiredJoins: [],
    params,
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
 * WHY IN SUBQUERY: Span-level filters use IN subqueries instead of direct JOINs
 * because a trace can have multiple spans. A direct JOIN would duplicate the
 * trace for each matching span, inflating count metrics. IN returns true
 * once a matching TraceId is found, preserving correct trace counts.
 *
 * WHY NOT EXISTS: ClickHouse v25.10 planner crashes with "Cannot clone Sorting
 * plan step" when EXISTS subqueries are combined with LIMIT 1 BY in JOINed
 * subqueries (issue #2660). IN subqueries are semantically equivalent and avoid
 * this planner bug.
 */
function translateSpanTypeFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("spanTypes");

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND SpanAttributes['langwatch.span.type'] IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate span model filter (requires JOIN)
 */
function translateSpanModelFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("models");

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND SpanAttributes['gen_ai.request.model'] IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate evaluator ID filter (requires JOIN).
 *
 * @param additionalWhere - Optional extra WHERE predicates appended inside the
 *   subquery (e.g. "AND Passed IS NOT NULL"). Used by the has_passed / has_score /
 *   has_label variants so the subquery filters by result-type, not just EvaluatorId.
 */
function translateEvaluatorIdFilter(
  values: string[],
  additionalWhere = "",
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("evaluatorIds");

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM evaluation_runs
      WHERE TenantId = {tenantId:String}
        AND EvaluatorId IN ({${paramName}:Array(String)})
        ${additionalWhere}
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
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
  const paramName = genParamName("evalPassed");

  // Convert string values to UInt8 (boolean in CH)
  const passedValues = values.map((v) =>
    v === "true" || v === "1" ? 1 : 0,
  );

  const params: Record<string, unknown> = { [paramName]: passedValues };
  let evaluatorCondition = "";

  if (evaluatorId) {
    const evalIdParam = genParamName("evaluatorId");
    evaluatorCondition = `AND EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM evaluation_runs
      WHERE TenantId = {tenantId:String}
        ${evaluatorCondition}
        AND Passed IN ({${paramName}:Array(UInt8)})
    )`,
    requiredJoins: [],
    params,
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
    evaluatorCondition = `AND EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM evaluation_runs
      WHERE TenantId = {tenantId:String}
        ${evaluatorCondition}
        AND Score >= {${minParam}:Float64}
        AND Score <= {${maxParam}:Float64}
    )`,
    requiredJoins: [],
    params,
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
  const paramName = genParamName("evalLabels");

  const params: Record<string, unknown> = { [paramName]: values };
  let evaluatorCondition = "";

  if (evaluatorId) {
    const evalIdParam = genParamName("evaluatorId");
    evaluatorCondition = `AND EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM evaluation_runs
      WHERE TenantId = {tenantId:String}
        ${evaluatorCondition}
        AND Label IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params,
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
  const paramName = genParamName("evalStates");

  const params: Record<string, unknown> = { [paramName]: values };
  let evaluatorCondition = "";

  if (evaluatorId) {
    const evalIdParam = genParamName("evaluatorId");
    evaluatorCondition = `AND EvaluatorId = {${evalIdParam}:String}`;
    params[evalIdParam] = evaluatorId;
  }

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM evaluation_runs
      WHERE TenantId = {tenantId:String}
        ${evaluatorCondition}
        AND Status IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params,
  };
}

/**
 * Translate event type filter
 */
function translateEventTypeFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("eventTypes");

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND hasAny("Events.Name", {${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
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
      "Events.Name",
      "Events.Attributes"
    )`;
  } else {
    // No event type filter, just check attributes
    metricKeyCondition = `arrayExists(
      x -> arrayExists(k -> mapContains(x, k), {${keysParam}:Array(String)}),
      "Events.Attributes"
    )`;
  }

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND ${metricKeyCondition}
    )`,
    requiredJoins: [],
    params,
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
      "Events.Name",
      "Events.Attributes"
    )`;
  } else {
    // No event type filter, just check attribute value range
    valueCondition = `arrayExists(
      x -> toFloat64OrNull(x[{${metricKeyParam}:String}]) >= {${minParam}:Float64}
        AND toFloat64OrNull(x[{${metricKeyParam}:String}]) <= {${maxParam}:Float64},
      "Events.Attributes"
    )`;
  }

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        AND ${valueCondition}
    )`,
    requiredJoins: [],
    params,
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
      whereClause: `${ts}.HasAnnotation = true`,
      requiredJoins: [],
      params: {},
    };
  } else if (hasFalse && !hasTrue) {
    return {
      whereClause: `(${ts}.HasAnnotation = false OR ${ts}.HasAnnotation IS NULL)`,
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
