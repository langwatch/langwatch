/**
 * Filter Translator — converts ES filter definitions to ClickHouse WHERE
 * clauses via a registry of per-field handlers (`filterHandlers` below).
 * IN subqueries are used rather than EXISTS; the two are equivalent here.
 */

import type { FilterField } from "@langwatch/analytics-contract";
import {
  customMetadataKeyCondition,
  customMetadataValueCondition,
} from "@langwatch/trace-contract";

import { type CHTable, tableAliases } from "./clickhouse.field-mappings.mapper.ts";
import type { TenantSql } from "./clickhouse.tenant-predicate.mapper.ts";

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
  /** The selection inverted, for the negate toggle; set by {@link combineFilters}. */
  negatedWhereClause?: string;
}

/**
 * Handler for one filter. `spanTimePredicate` prunes a `stored_spans` subquery to the
 * dashboard's date range; `tenant` names the side-table subquery's tenants.
 */
type FilterHandler = (input: {
  values: string[];
  key?: string;
  subkey?: string;
  spanTimePredicate?: string;
  tenant: TenantSql;
}) => FilterTranslation;

/** What every side-table subquery handler is handed. */
type SubqueryFilterInput = {
  values: string[];
  tenant: TenantSql;
  spanTimePredicate?: string;
};

/** An evaluation_runs subquery handler's input, optionally narrowed to one evaluator. */
type EvaluationFilterInput = {
  values: string[];
  evaluatorId?: string;
  tenant: TenantSql;
};

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
  "metadata.key": ({ values }) => translateCustomMetadataFilter({ field: "metadata.key", values }),
  "metadata.value": ({ values, key }) =>
    translateCustomMetadataFilter({ field: "metadata.value", values, key }),
  "metadata.prompt_ids": ({ values }) => translatePromptIdsFilter(values),

  // Trace Filters
  "traces.origin": ({ values }) => translateOriginFilter(values),
  "traces.error": ({ values }) => translateErrorFilter(values),
  "traces.name": ({ values }) => translateTraceNameFilter(values),

  // Span Filters
  "spans.type": ({ values, spanTimePredicate, tenant }) =>
    translateSpanTypeFilter({ values, spanTimePredicate, tenant }),
  "spans.model": ({ values, spanTimePredicate, tenant }) =>
    translateSpanModelFilter({ values, spanTimePredicate, tenant }),

  // Evaluation Filters
  "evaluations.evaluator_id": ({ values, tenant }) =>
    translateEvaluatorIdFilter({ values, tenant }),
  "evaluations.evaluator_id.guardrails_only": ({ values, tenant }) =>
    translateEvaluatorIdFilter({ values, tenant }),
  "evaluations.evaluator_id.has_passed": ({ values, tenant }) =>
    translateEvaluatorIdFilter({ values, tenant, additionalWhere: "AND Passed IS NOT NULL" }),
  "evaluations.evaluator_id.has_score": ({ values, tenant }) =>
    translateEvaluatorIdFilter({ values, tenant, additionalWhere: "AND Score IS NOT NULL" }),
  "evaluations.evaluator_id.has_label": ({ values, tenant }) =>
    translateEvaluatorIdFilter({
      values,
      tenant,
      additionalWhere:
        "AND Label IS NOT NULL AND Label != '' AND Label NOT IN ('succeeded', 'failed')",
    }),
  "evaluations.passed": ({ values, key, tenant }) =>
    translateEvaluationPassedFilter({ values, evaluatorId: key, tenant }),
  "evaluations.score": ({ values, key, tenant }) =>
    translateEvaluationScoreFilter({ values, evaluatorId: key, tenant }),
  "evaluations.label": ({ values, key, tenant }) =>
    translateEvaluationLabelFilter({ values, evaluatorId: key, tenant }),
  "evaluations.state": ({ values, key, tenant }) =>
    translateEvaluationStateFilter({ values, evaluatorId: key, tenant }),

  // Event Filters
  "events.event_type": ({ values, spanTimePredicate, tenant }) =>
    translateEventTypeFilter({ values, spanTimePredicate, tenant }),
  "events.metrics.key": ({ values, key, spanTimePredicate, tenant }) =>
    translateEventMetricKeyFilter({ values, eventType: key, spanTimePredicate, tenant }),
  "events.metrics.value": ({ values, key, subkey, spanTimePredicate, tenant }) =>
    translateEventMetricValueFilter({
      values,
      eventType: key,
      metricKey: subkey,
      spanTimePredicate,
      tenant,
    }),
  "events.event_details.key": ({ values, key, spanTimePredicate, tenant }) =>
    translateEventDetailKeyFilter({ values, eventType: key, spanTimePredicate, tenant }),

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
export function translateFilter({
  field,
  values,
  key,
  subkey,
  spanTimePredicate,
  tenant,
}: {
  field: FilterField;
  values: string[];
  key?: string;
  subkey?: string;
  spanTimePredicate?: string;
  /** How a side-table subquery names its tenants. */
  tenant: TenantSql;
}): FilterTranslation {
  if (values.length === 0) {
    return noOpFilter;
  }

  const handler = filterHandlers[field];
  return handler ? handler({ values, key, subkey, spanTimePredicate, tenant }) : noOpFilter;
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
 * Translates a custom metadata key or value filter with trace search's own builders, so a
 * graph and the trace list read the same three storage formats. See langwatch/tasks#919.
 */
function translateCustomMetadataFilter({
  field,
  values,
  key,
}: {
  field: "metadata.key" | "metadata.value";
  values: string[];
  key?: string;
}): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramId = genParamName("customMeta");
  const { sql, params } =
    field === "metadata.key"
      ? customMetadataKeyCondition({ values, paramId, alias: ts })
      : customMetadataValueCondition({ values, paramId, key, alias: ts });
  return { whereClause: sql, requiredJoins: [], params };
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
 * Translate span type filter. An IN subquery, since a JOIN duplicates a trace with several
 * matching spans. It matches tenant and trace id together, so a trace id two members share
 * never keeps the other member's trace (ADR-177).
 */
function translateSpanTypeFilter({
  values,
  tenant,
  spanTimePredicate = "",
}: SubqueryFilterInput): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("spanTypes");

  return {
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM stored_spans
      WHERE ${tenant.sideTable}
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
function translateSpanModelFilter({
  values,
  tenant,
  spanTimePredicate = "",
}: SubqueryFilterInput): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("models");

  return {
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM stored_spans
      WHERE ${tenant.sideTable}
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
function translateEvaluatorIdFilter({
  values,
  tenant,
  additionalWhere = "",
}: {
  values: string[];
  tenant: TenantSql;
  additionalWhere?: string;
}): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("evaluatorIds");

  return {
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM evaluation_runs
      WHERE ${tenant.sideTable}
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
function translateEvaluationPassedFilter({
  values,
  evaluatorId,
  tenant,
}: EvaluationFilterInput): FilterTranslation {
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
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM evaluation_runs
      WHERE ${tenant.sideTable}
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
function translateEvaluationScoreFilter({
  values,
  evaluatorId,
  tenant,
}: EvaluationFilterInput): FilterTranslation {
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
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM evaluation_runs
      WHERE ${tenant.sideTable}
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
function translateEvaluationLabelFilter({
  values,
  evaluatorId,
  tenant,
}: EvaluationFilterInput): FilterTranslation {
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
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM evaluation_runs
      WHERE ${tenant.sideTable}
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
function translateEvaluationStateFilter({
  values,
  evaluatorId,
  tenant,
}: EvaluationFilterInput): FilterTranslation {
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
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM evaluation_runs
      WHERE ${tenant.sideTable}
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
function translateEventTypeFilter({
  values,
  tenant,
  spanTimePredicate = "",
}: SubqueryFilterInput): FilterTranslation {
  const ts = tableAliases.trace_summaries;
  const paramName = genParamName("eventTypes");

  return {
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM stored_spans
      WHERE ${tenant.sideTable}
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
function translateEventMetricKeyFilter({
  values,
  eventType,
  tenant,
  spanTimePredicate = "",
}: SubqueryFilterInput & { eventType?: string }): FilterTranslation {
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
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM stored_spans
      WHERE ${tenant.sideTable}
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
  tenant,
  spanTimePredicate = "",
}: SubqueryFilterInput & { eventType?: string; metricKey?: string }): FilterTranslation {
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
    whereClause: `(${ts}.TenantId, ${ts}.TraceId) IN (
      SELECT TenantId, TraceId FROM stored_spans
      WHERE ${tenant.sideTable}
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
  input: SubqueryFilterInput & { eventType?: string },
): FilterTranslation {
  // Same as metric key filter - event details are stored in Events.Attributes
  return translateEventMetricKeyFilter(input);
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
    negatedWhereClause: negatedConjunction(nonTrivial.map((t) => t.whereClause)),
  };
}

/** `NOT (a AND b)` as `NOT a OR NOT b`, one bracket around the disjunction. */
function negatedConjunction(whereClauses: string[]): string {
  const negated = whereClauses.map(negateFilterClause);
  return negated.length === 1 ? negated[0]! : `(${negated.join(" OR ")})`;
}

const SPAN_SUBQUERY_FILTER = /^(\(\w+\.TenantId, \w+\.TraceId\)) IN (\(.*\))$/s;

/**
 * One filter inverted. A side-table subquery becomes `NOT IN`: its subquery carries its own
 * tenant predicate, which a `NOT (…)` bracket would appear to negate to the tenant guard
 * (WEB-17801).
 */
function negateFilterClause(whereClause: string): string {
  const subquery = SPAN_SUBQUERY_FILTER.exec(whereClause.trim());
  return subquery && closesAtEnd(subquery[2]!)
    ? `${subquery[1]} NOT IN ${subquery[2]}`
    : `NOT (${whereClause})`;
}

/** Whether the bracket opening `text` is the one closing it, so the match is one operand. */
function closesAtEnd(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;
    if (depth === 0) return index === text.length - 1;
  }
  return false;
}

/** The translations one nested filter value yields, at one or two key levels. */
function translateNestedFilter({
  field,
  value,
  spanTimePredicate,
  tenant,
}: {
  field: FilterField;
  value: Record<string, string[]> | Record<string, Record<string, string[]>>;
  spanTimePredicate?: string;
  tenant: TenantSql;
}): FilterTranslation[] {
  const translations: FilterTranslation[] = [];

  for (const [key, subValue] of Object.entries(value)) {
    if (Array.isArray(subValue)) {
      translations.push(
        translateFilter({ field, values: subValue, key, spanTimePredicate, tenant }),
      );
      continue;
    }
    if (typeof subValue !== "object") continue;

    for (const [subkey, subSubValue] of Object.entries(subValue)) {
      if (Array.isArray(subSubValue)) {
        translations.push(
          translateFilter({ field, values: subSubValue, key, subkey, spanTimePredicate, tenant }),
        );
      }
    }
  }

  return translations;
}

/**
 * Translate all filters from a filter object. `tenant` names the side-table subqueries'
 * tenants.
 */
export function translateAllFilters(
  filters: Partial<
    Record<string, string[] | Record<string, string[]> | Record<string, Record<string, string[]>>>
  >,
  { spanTimePredicate, tenant }: { spanTimePredicate?: string; tenant: TenantSql },
): FilterTranslation {
  const translations: FilterTranslation[] = [];

  for (const [field, value] of Object.entries(filters)) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      continue;
    }

    if (Array.isArray(value)) {
      // Simple array filter
      translations.push(
        translateFilter({ field: field as FilterField, values: value, spanTimePredicate, tenant }),
      );
    } else if (typeof value === "object") {
      translations.push(
        ...translateNestedFilter({
          field: field as FilterField,
          value,
          spanTimePredicate,
          tenant,
        }),
      );
    }
  }

  return combineFilters(translations);
}
