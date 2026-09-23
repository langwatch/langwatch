/**
 * Filter Translator — converts ES filter definitions to ClickHouse WHERE
 * clauses via a registry of per-field handlers (`filterHandlers` below).
 * IN subqueries are used rather than EXISTS; the two are equivalent here.
 */

import type { FilterField } from "@langwatch/analytics-contract";

import { type CHTable, tableAliases } from "./clickhouse.field-mappings.mapper.ts";

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
 * Handler function type for filter translation. `spanTimePredicate` is an
 * optional SQL fragment that handlers reading `stored_spans` inject into
 * their subquery WHERE, pruning the scan to the dashboard's date range.
 */
type FilterHandler = (input: {
  values: string[];
  key?: string;
  subkey?: string;
  spanTimePredicate?: string;
}) => FilterTranslation;

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

/** Registry of filter handlers by field type — replaces a large switch statement. */
// Exhaustive on purpose: a field added to `filterFieldsEnum` without a handler
// here fails to compile. The platform copy of this file had that guarantee and
// this one lost it when the type went out of reach — a `Record<string, …>`
// accepts a filter the translator then silently ignores.
const filterHandlers: Record<FilterField, FilterHandler | null> = {
  // Topic Filters
  "topics.topics": ({ values }) => translateTopicFilter(values),
  "topics.subtopics": ({ values }) => translateSubtopicFilter(values),

  // Metadata Filters
  "metadata.user_id": ({ values }) => translateMetadataFilter("langwatch.user_id", values),
  "metadata.thread_id": ({ values }) => translateMetadataFilter("gen_ai.conversation.id", values),
  "metadata.customer_id": ({ values }) => translateMetadataFilter("langwatch.customer_id", values),
  "metadata.labels": ({ values }) => translateLabelsFilter(values),
  "metadata.key": ({ values }) => translateMetadataKeyFilter(values),
  "metadata.value": ({ values, key }) => translateMetadataValueFilter(values, key),
  "metadata.prompt_ids": ({ values }) => translatePromptIdsFilter(values),

  // Trace Filters
  "traces.origin": ({ values }) => translateOriginFilter(values),
  "traces.error": ({ values }) => translateErrorFilter(values),
  "traces.name": ({ values }) => translateTraceNameFilter(values),

  // Span Filters
  "spans.type": ({ values, spanTimePredicate: spanTime }) =>
    translateSpanTypeFilter(values, spanTime),
  "spans.model": ({ values, spanTimePredicate: spanTime }) =>
    translateSpanModelFilter(values, spanTime),

  // Evaluation Filters
  "evaluations.evaluator_id": ({ values }) => translateEvaluatorIdFilter(values),
  "evaluations.evaluator_id.guardrails_only": ({ values }) => translateEvaluatorIdFilter(values),
  "evaluations.evaluator_id.has_passed": ({ values }) =>
    translateEvaluatorIdFilter(values, "AND Passed IS NOT NULL"),
  "evaluations.evaluator_id.has_score": ({ values }) =>
    translateEvaluatorIdFilter(values, "AND Score IS NOT NULL"),
  "evaluations.evaluator_id.has_label": ({ values }) =>
    translateEvaluatorIdFilter(
      values,
      "AND Label IS NOT NULL AND Label != '' AND Label NOT IN ('succeeded', 'failed')",
    ),
  "evaluations.passed": ({ values, key }) => translateEvaluationPassedFilter(values, key),
  "evaluations.score": ({ values, key }) => translateEvaluationScoreFilter(values, key),
  "evaluations.label": ({ values, key }) => translateEvaluationLabelFilter(values, key),
  "evaluations.state": ({ values, key }) => translateEvaluationStateFilter(values, key),

  // Event Filters
  "events.event_type": ({ values, spanTimePredicate: spanTime }) =>
    translateEventTypeFilter(values, spanTime),
  "events.metrics.key": ({ values, key, spanTimePredicate: spanTime }) =>
    translateEventMetricKeyFilter(values, key, spanTime),
  "events.metrics.value": ({ values, key, subkey, spanTimePredicate: spanTime }) =>
    translateEventMetricValueFilter({
      values,
      eventType: key,
      metricKey: subkey,
      spanTimePredicate: spanTime,
    }),
  "events.event_details.key": ({ values, key, spanTimePredicate: spanTime }) =>
    translateEventDetailKeyFilter(values, key, spanTime),

  // Annotation Filters
  "annotations.hasAnnotation": ({ values }) => translateAnnotationFilter(values),
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
  spanTimePredicate?: string,
): FilterTranslation {
  if (values.length === 0) {
    return noOpFilter;
  }

  const handler = filterHandlers[field];
  return handler ? handler({ values, key, subkey, spanTimePredicate }) : noOpFilter;
}

/**
 * Translate topic filter. All filter translations use parameterized queries
 * (never string interpolation) to prevent SQL injection; parameter names are
 * auto-generated with a counter for uniqueness across combined filters.
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
function translateMetadataFilter(attributeKey: string, values: string[]): FilterTranslation {
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
function translateMetadataValueFilter(values: string[], key?: string): FilterTranslation {
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
 * Translate origin filter. "application" is the default for traces with no
 * explicit langwatch.origin attribute (empty string or NULL); other values
 * ("evaluation", "simulation", "playground", ...) match directly and OR together.
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
    parts.push(`${ts}.Attributes['langwatch.origin'] IN ({${paramName}:Array(String)})`);
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
 * Translate error filter. Uses ContainsErrorStatus from trace_summaries,
 * which captures errors from multiple sources (StatusCode, error attributes,
 * exception events) — more reliable and performant than an EXISTS subquery.
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
 * Translate trace name filter.
 * Uses the dedicated TraceName column on trace_summaries.
 */
function translateTraceNameFilter(values: string[]): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("traceNames");
  return {
    whereClause: `${ts}.TraceName IN ({${paramName}:Array(String)})`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate span type filter (requires JOIN). Uses an IN subquery rather than
 * a direct JOIN: a trace with multiple matching spans would be duplicated by
 * a JOIN, inflating count metrics — IN returns true once, once is enough.
 */
function translateSpanTypeFilter(values: string[], spanTimePredicate = ""): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("spanTypes");

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        ${spanTimePredicate}
        AND SpanAttributes['langwatch.span.type'] IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate span model filter (requires JOIN)
 */
function translateSpanModelFilter(values: string[], spanTimePredicate = ""): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("models");

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        ${spanTimePredicate}
        AND SpanAttributes['gen_ai.request.model'] IN ({${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate evaluator ID filter (requires JOIN).
 * @param additionalWhere - Extra WHERE appended inside the subquery, used
 *   by has_passed/has_score/has_label to filter by result-type.
 */
function translateEvaluatorIdFilter(values: string[], additionalWhere = ""): FilterTranslation {
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
  const passedValues = values.map((v) => (v === "true" || v === "1" ? 1 : 0));

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
function translateEvaluationScoreFilter(values: string[], evaluatorId?: string): FilterTranslation {
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
function translateEvaluationLabelFilter(values: string[], evaluatorId?: string): FilterTranslation {
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
function translateEvaluationStateFilter(values: string[], evaluatorId?: string): FilterTranslation {
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
function translateEventTypeFilter(values: string[], spanTimePredicate = ""): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("eventTypes");

  return {
    whereClause: `${ts}.TraceId IN (
      SELECT TraceId FROM stored_spans
      WHERE TenantId = {tenantId:String}
        ${spanTimePredicate}
        AND hasAny("Events.Name", {${paramName}:Array(String)})
    )`,
    requiredJoins: [],
    params: { [paramName]: values },
  };
}

/**
 * Translate event metric key filter. Uses paired arrayExists to correlate
 * Events.Name with Events.Attributes at the same index — this prevents false
 * positives where event type matches at one index but key matches at another.
 */
function translateEventMetricKeyFilter(
  values: string[],
  eventType?: string,
  spanTimePredicate = "",
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
        ${spanTimePredicate}
        AND ${metricKeyCondition}
    )`,
    requiredJoins: [],
    params,
  };
}

/**
 * Translate event metric value filter (numeric range). Uses paired
 * arrayExists to correlate Events.Name with Events.Attributes at the same
 * index, preventing a type match at one index from pairing with a value at another.
 */
function translateEventMetricValueFilter({
  values,
  eventType,
  metricKey,
  spanTimePredicate = "",
}: {
  values: string[];
  eventType?: string;
  metricKey?: string;
  spanTimePredicate?: string;
}): FilterTranslation {
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
        ${spanTimePredicate}
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
  spanTimePredicate = "",
): FilterTranslation {
  // Same as metric key filter - event details are stored in Events.Attributes
  return translateEventMetricKeyFilter(values, eventType, spanTimePredicate);
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
 * Combine multiple filter translations with AND, filtering out "1=1"
 * no-op placeholders first so empty filters don't bloat the generated
 * WHERE clause with unnecessary conditions.
 */
export function combineFilters(translations: FilterTranslation[]): FilterTranslation {
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

/** The translations one nested filter value yields, at one or two key levels. */
function translateNestedFilter({
  field,
  value,
  spanTimePredicate,
}: {
  field: FilterField;
  value: Record<string, string[]> | Record<string, Record<string, string[]>>;
  spanTimePredicate?: string;
}): FilterTranslation[] {
  const translations: FilterTranslation[] = [];

  for (const [key, subValue] of Object.entries(value)) {
    if (Array.isArray(subValue)) {
      translations.push(translateFilter(field, subValue, key, undefined, spanTimePredicate));
      continue;
    }
    if (typeof subValue !== "object") continue;

    for (const [subkey, subSubValue] of Object.entries(subValue)) {
      if (Array.isArray(subSubValue)) {
        translations.push(translateFilter(field, subSubValue, key, subkey, spanTimePredicate));
      }
    }
  }

  return translations;
}

/**
 * Translate all filters from a filter object
 */
export function translateAllFilters(
  filters: Partial<
    Record<string, string[] | Record<string, string[]> | Record<string, Record<string, string[]>>>
  >,
  spanTimePredicate?: string,
): FilterTranslation {
  const translations: FilterTranslation[] = [];

  for (const [field, value] of Object.entries(filters)) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      continue;
    }

    if (Array.isArray(value)) {
      // Simple array filter
      translations.push(
        translateFilter(field as FilterField, value, undefined, undefined, spanTimePredicate),
      );
    } else if (typeof value === "object") {
      translations.push(
        ...translateNestedFilter({ field: field as FilterField, value, spanTimePredicate }),
      );
    }
  }

  return combineFilters(translations);
}
