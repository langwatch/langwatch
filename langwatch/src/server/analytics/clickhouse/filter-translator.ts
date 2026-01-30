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
  /** Parameter values for parameterized queries */
  params: Record<string, unknown>;
  /** Whether this filter uses EXISTS subquery pattern */
  usesExistsSubquery?: boolean;
}

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
    return { whereClause: "1=1", requiredJoins, params: {} };
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
      return { whereClause: "1=1", requiredJoins, params: {} };
  }
}

/**
 * Translate topic filter
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
      whereClause: `${ts}.ContainsErrorStatus = 0`,
      requiredJoins: [],
      params: {},
    };
  }

  // Both or neither - no filtering
  return { whereClause: "1=1", requiredJoins: [], params: {} };
}

/**
 * Translate span type filter (requires JOIN)
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
  const es = tableAliases.evaluation_states;
  const paramName = genParamName("evaluatorIds");

  return {
    whereClause: `EXISTS (
      SELECT 1 FROM evaluation_states ${es}
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
  const es = tableAliases.evaluation_states;
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
      SELECT 1 FROM evaluation_states ${es}
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
  const es = tableAliases.evaluation_states;
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
      SELECT 1 FROM evaluation_states ${es}
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
  const es = tableAliases.evaluation_states;
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
      SELECT 1 FROM evaluation_states ${es}
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
  const es = tableAliases.evaluation_states;
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
      SELECT 1 FROM evaluation_states ${es}
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
 */
function translateEventMetricKeyFilter(
  values: string[],
  eventType?: string,
): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const ss = tableAliases.stored_spans;
  const keysParam = genParamName("metricKeys");

  const params: Record<string, unknown> = { [keysParam]: values };
  let eventCondition = "";

  if (eventType) {
    const eventTypeParam = genParamName("eventType");
    eventCondition = `AND has(${ss}."Events.Name", {${eventTypeParam}:String})`;
    params[eventTypeParam] = eventType;
  }

  // Events.Attributes is Array(Map(String, String))
  // Check if any attribute map contains any of the metric keys
  return {
    whereClause: `EXISTS (
      SELECT 1 FROM stored_spans ${ss}
      WHERE ${ss}.TenantId = ${ts}.TenantId
        AND ${ss}.TraceId = ${ts}.TraceId
        ${eventCondition}
        AND arrayExists(x -> arrayExists(k -> mapContains(x, k), {${keysParam}:Array(String)}), ${ss}."Events.Attributes")
    )`,
    requiredJoins: [],
    params,
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
  let eventCondition = "";

  if (eventType) {
    const eventTypeParam = genParamName("eventType");
    eventCondition = `AND has(${ss}."Events.Name", {${eventTypeParam}:String})`;
    params[eventTypeParam] = eventType;
  }

  // Check if any event's attribute matches the key and value is in range
  const valueCondition = `arrayExists(
    x -> toFloat64OrNull(x[{${metricKeyParam}:String}]) >= {${minParam}:Float64}
      AND toFloat64OrNull(x[{${metricKeyParam}:String}]) <= {${maxParam}:Float64},
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
 * Combine multiple filter translations with AND
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
