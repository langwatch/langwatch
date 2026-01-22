import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterField } from "./types";

/**
 * Result of building a filter condition - contains both the SQL fragment
 * and any parameters needed for the query.
 */
export type FilterConditionResult = {
  sql: string;
  params: Record<string, unknown>;
};

export type ClickHouseFilterQueryParams = {
  tenantId: string;
  query?: string;
  key?: string;
  subkey?: string;
  startDate: number;
  endDate: number;
};

export type FilterOption = {
  field: string;
  label: string;
  count: number;
};

export type ClickHouseFilterDefinition = {
  /**
   * The ClickHouse table to query. If null, this filter is not supported in ClickHouse.
   */
  tableName: "trace_summaries" | "stored_spans" | "evaluation_states" | null;
  /**
   * Build the SQL query for this filter.
   */
  buildQuery: (params: ClickHouseFilterQueryParams) => string;
  /**
   * Extract filter options from the query result rows.
   */
  extractResults: (rows: unknown[]) => FilterOption[];
};

/**
 * Build common WHERE conditions for trace_summaries queries.
 */
function buildTraceSummariesConditions(_params: ClickHouseFilterQueryParams): string {
  const conditions: string[] = [
    "TenantId = {tenantId:String}",
    "CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
    "CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
  ];
  return conditions.join(" AND ");
}

/**
 * Build common WHERE conditions for stored_spans queries.
 */
function buildStoredSpansConditions(_params: ClickHouseFilterQueryParams): string {
  const conditions: string[] = [
    "TenantId = {tenantId:String}",
    "StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})",
    "StartTime <= fromUnixTimestamp64Milli({endDate:UInt64})",
  ];
  return conditions.join(" AND ");
}

/**
 * Build common WHERE conditions for evaluation_states queries.
 */
function buildEvaluationStatesConditions(_params: ClickHouseFilterQueryParams): string {
  const conditions: string[] = [
    "TenantId = {tenantId:String}",
    "ScheduledAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
    "ScheduledAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
  ];
  return conditions.join(" AND ");
}

/**
 * Build a LIKE filter clause for optional query string matching.
 */
function buildQueryFilter(column: string, params: ClickHouseFilterQueryParams): string {
  if (!params.query) {
    return "";
  }
  return `AND lower(${column}) LIKE lower(concat({query:String}, '%'))`;
}

/**
 * Standard result extractor for field/label/count rows.
 */
function extractStandardResults(rows: unknown[]): FilterOption[] {
  return (rows as Array<{ field: string; label: string; count: string }>).map(
    (row) => ({
      field: row.field,
      label: row.label,
      count: parseInt(row.count, 10),
    })
  );
}

/**
 * Attribute keys as stored in ClickHouse trace_summaries.Attributes map.
 *
 * The traceAggregationService reads from canonical span attributes (gen_ai.conversation.id,
 * langwatch.user.id, etc.) but stores them with simplified keys in the trace summary.
 * See: src/server/event-sourcing/pipelines/trace-processing/services/traceAggregationService.ts
 */
const ATTRIBUTE_KEYS = {
  // Thread ID: stored as "thread.id" (from gen_ai.conversation.id, langwatch.thread_id, etc.)
  thread_id: "Attributes['thread.id']",
  // User ID: stored as "user.id" (from langwatch.user.id, langwatch.user_id, etc.)
  user_id: "Attributes['user.id']",
  // Customer ID: stored as "customer.id" (from langwatch.customer.id, langwatch.customer_id, etc.)
  customer_id: "Attributes['customer.id']",
};

/**
 * ClickHouse filter definitions for each filter field.
 * Set to null for filters not supported in ClickHouse (will fall back to Elasticsearch).
 */
export const clickHouseFilters: Record<FilterField, ClickHouseFilterDefinition | null> = {
  // Topics filters
  "topics.topics": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        TopicId as field,
        TopicId as label,
        count() as count
      FROM trace_summaries FINAL
      WHERE ${buildTraceSummariesConditions(params)}
        AND TopicId IS NOT NULL
        AND TopicId != ''
        ${buildQueryFilter("TopicId", params)}
      GROUP BY TopicId
      ORDER BY TopicId ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "topics.subtopics": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        SubTopicId as field,
        SubTopicId as label,
        count() as count
      FROM trace_summaries FINAL
      WHERE ${buildTraceSummariesConditions(params)}
        AND SubTopicId IS NOT NULL
        AND SubTopicId != ''
        ${buildQueryFilter("SubTopicId", params)}
      GROUP BY SubTopicId
      ORDER BY SubTopicId ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  // Metadata filters
  "metadata.user_id": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        ${ATTRIBUTE_KEYS.user_id} as field,
        ${ATTRIBUTE_KEYS.user_id} as label,
        count() as count
      FROM trace_summaries FINAL
      WHERE ${buildTraceSummariesConditions(params)}
        AND ${ATTRIBUTE_KEYS.user_id} != ''
        ${buildQueryFilter(ATTRIBUTE_KEYS.user_id, params)}
      GROUP BY field
      ORDER BY field ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "metadata.thread_id": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        ${ATTRIBUTE_KEYS.thread_id} as field,
        ${ATTRIBUTE_KEYS.thread_id} as label,
        count() as count
      FROM trace_summaries FINAL
      WHERE ${buildTraceSummariesConditions(params)}
        AND ${ATTRIBUTE_KEYS.thread_id} != ''
        ${buildQueryFilter(ATTRIBUTE_KEYS.thread_id, params)}
      GROUP BY field
      ORDER BY field ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "metadata.customer_id": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        ${ATTRIBUTE_KEYS.customer_id} as field,
        ${ATTRIBUTE_KEYS.customer_id} as label,
        count() as count
      FROM trace_summaries FINAL
      WHERE ${buildTraceSummariesConditions(params)}
        AND ${ATTRIBUTE_KEYS.customer_id} != ''
        ${buildQueryFilter(ATTRIBUTE_KEYS.customer_id, params)}
      GROUP BY field
      ORDER BY field ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "metadata.labels": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        trim(BOTH '"' FROM label) as field,
        trim(BOTH '"' FROM label) as label,
        count() as count
      FROM (
        SELECT arrayJoin(JSONExtractArrayRaw(Attributes['langwatch.labels'])) as label
        FROM trace_summaries FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND Attributes['langwatch.labels'] != ''
          AND Attributes['langwatch.labels'] != '[]'
      )
      WHERE label != '' AND label != 'null'
        ${params.query ? `AND lower(trim(BOTH '"' FROM label)) LIKE lower(concat({query:String}, '%'))` : ""}
      GROUP BY label
      ORDER BY label ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "metadata.key": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        replaceAll(key, '.', '·') as field,
        key as label,
        count() as count
      FROM (
        SELECT arrayJoin(mapKeys(Attributes)) as key
        FROM trace_summaries FINAL
        WHERE ${buildTraceSummariesConditions(params)}
      )
      WHERE NOT startsWith(key, 'langwatch.')
        AND NOT startsWith(key, 'gen_ai.')
        ${buildQueryFilter("key", params)}
      GROUP BY key
      ORDER BY key ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "metadata.value": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      // Convert the dot-encoded key back to actual key
      const actualKey = params.key.replaceAll("·", ".");
      return `
        SELECT
          Attributes['${actualKey}'] as field,
          Attributes['${actualKey}'] as label,
          count() as count
        FROM trace_summaries FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND Attributes['${actualKey}'] != ''
          ${params.query ? `AND lower(Attributes['${actualKey}']) LIKE lower(concat({query:String}, '%'))` : ""}
        GROUP BY field
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "metadata.prompt_ids": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        trim(BOTH '"' FROM prompt_id) as field,
        trim(BOTH '"' FROM prompt_id) as label,
        count() as count
      FROM (
        SELECT arrayJoin(JSONExtractArrayRaw(Attributes['langwatch.prompt_ids'])) as prompt_id
        FROM trace_summaries FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND Attributes['langwatch.prompt_ids'] != ''
          AND Attributes['langwatch.prompt_ids'] != '[]'
      )
      WHERE prompt_id != '' AND prompt_id != 'null'
        ${params.query ? `AND lower(trim(BOTH '"' FROM prompt_id)) LIKE lower(concat({query:String}, '%'))` : ""}
      GROUP BY prompt_id
      ORDER BY prompt_id ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  // Trace filters
  "traces.error": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        if(ContainsErrorStatus, 'true', 'false') as field,
        if(ContainsErrorStatus, 'Traces with error', 'Traces without error') as label,
        count() as count
      FROM trace_summaries FINAL
      WHERE ${buildTraceSummariesConditions(params)}
      GROUP BY ContainsErrorStatus
      ORDER BY field ASC
    `,
    extractResults: extractStandardResults,
  },

  // Span filters
  "spans.type": {
    tableName: "stored_spans",
    buildQuery: (params) => `
      SELECT
        SpanAttributes['langwatch.span.type'] as field,
        SpanAttributes['langwatch.span.type'] as label,
        count() as count
      FROM stored_spans
      WHERE ${buildStoredSpansConditions(params)}
        AND SpanAttributes['langwatch.span.type'] != ''
        ${buildQueryFilter("SpanAttributes['langwatch.span.type']", params)}
      GROUP BY field
      ORDER BY field ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "spans.model": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        model as field,
        model as label,
        count() as count
      FROM (
        SELECT arrayJoin(Models) as model
        FROM trace_summaries FINAL
        WHERE ${buildTraceSummariesConditions(params)}
      )
      WHERE model != ''
        ${buildQueryFilter("model", params)}
      GROUP BY model
      ORDER BY model ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  // Annotation filters
  "annotations.hasAnnotation": {
    tableName: "trace_summaries",
    buildQuery: (params) => `
      SELECT
        if(HasAnnotation = true, 'true', 'false') as field,
        if(HasAnnotation = true, 'Has Annotation', 'No Annotation') as label,
        count() as count
      FROM trace_summaries FINAL
      WHERE ${buildTraceSummariesConditions(params)}
      GROUP BY HasAnnotation
      ORDER BY field DESC
    `,
    extractResults: extractStandardResults,
  },

  // Evaluation filters - using evaluation_states table
  "evaluations.evaluator_id": {
    tableName: "evaluation_states",
    buildQuery: (params) => `
      SELECT
        EvaluatorId as field,
        if(EvaluatorName != '', concat('[', EvaluatorType, '] ', EvaluatorName), concat('[', EvaluatorType, '] ', EvaluatorId)) as label,
        count() as count
      FROM evaluation_states FINAL
      WHERE ${buildEvaluationStatesConditions(params)}
        ${params.query ? `AND lower(ifNull(EvaluatorName, '')) LIKE lower(concat({query:String}, '%'))` : ""}
      GROUP BY EvaluatorId, EvaluatorType, EvaluatorName
      ORDER BY label ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "evaluations.evaluator_id.guardrails_only": {
    tableName: "evaluation_states",
    buildQuery: (params) => `
      SELECT
        EvaluatorId as field,
        if(EvaluatorName != '', concat('[', EvaluatorType, '] ', EvaluatorName), concat('[', EvaluatorType, '] ', EvaluatorId)) as label,
        count() as count
      FROM evaluation_states FINAL
      WHERE ${buildEvaluationStatesConditions(params)}
        AND IsGuardrail = 1
        ${params.query ? `AND lower(ifNull(EvaluatorName, '')) LIKE lower(concat({query:String}, '%'))` : ""}
      GROUP BY EvaluatorId, EvaluatorType, EvaluatorName
      ORDER BY label ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "evaluations.passed": {
    tableName: "evaluation_states",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      return `
        SELECT
          if(Passed = 1, 'true', 'false') as field,
          if(Passed = 1, 'Passed', 'Failed') as label,
          count() as count
        FROM evaluation_states FINAL
        WHERE ${buildEvaluationStatesConditions(params)}
          AND EvaluatorId = {key:String}
          AND Passed IS NOT NULL
        GROUP BY Passed
        ORDER BY field DESC
      `;
    },
    extractResults: extractStandardResults,
  },

  "evaluations.score": {
    tableName: "evaluation_states",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      return `
        SELECT
          min(Score) as min_score,
          max(Score) as max_score
        FROM evaluation_states FINAL
        WHERE ${buildEvaluationStatesConditions(params)}
          AND EvaluatorId = {key:String}
          AND Score IS NOT NULL
      `;
    },
    extractResults: (rows: unknown[]) => {
      const row = (rows as Array<{ min_score: number | null; max_score: number | null }>)[0];
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
    tableName: "evaluation_states",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      return `
        SELECT
          Status as field,
          Status as label,
          count() as count
        FROM evaluation_states FINAL
        WHERE ${buildEvaluationStatesConditions(params)}
          AND EvaluatorId = {key:String}
          AND Status NOT IN ('succeeded', 'failed')
        GROUP BY Status
        ORDER BY Status ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "evaluations.label": {
    tableName: "evaluation_states",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      return `
        SELECT
          Label as field,
          Label as label,
          count() as count
        FROM evaluation_states FINAL
        WHERE ${buildEvaluationStatesConditions(params)}
          AND EvaluatorId = {key:String}
          AND Label IS NOT NULL
          AND Label != ''
          AND Label NOT IN ('succeeded', 'failed')
          ${params.query ? `AND lower(Label) LIKE lower(concat({query:String}, '%'))` : ""}
        GROUP BY Label
        ORDER BY Label ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  // Event filters - using stored_spans table with span attributes
  "events.event_type": {
    tableName: "stored_spans",
    buildQuery: (params) => `
      SELECT
        SpanAttributes['event.type'] as field,
        SpanAttributes['event.type'] as label,
        count() as count
      FROM stored_spans
      WHERE ${buildStoredSpansConditions(params)}
        AND SpanAttributes['event.type'] != ''
        ${params.query ? `AND lower(SpanAttributes['event.type']) LIKE lower(concat({query:String}, '%'))` : ""}
      GROUP BY field
      ORDER BY field ASC
      LIMIT 10000
    `,
    extractResults: extractStandardResults,
  },

  "events.metrics.key": {
    tableName: "stored_spans",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      return `
        SELECT
          arrayJoin(arrayFilter(k -> startsWith(k, 'event.metrics.'), mapKeys(SpanAttributes))) as full_key,
          replaceOne(full_key, 'event.metrics.', '') as field,
          replaceOne(full_key, 'event.metrics.', '') as label,
          count() as count
        FROM stored_spans
        WHERE ${buildStoredSpansConditions(params)}
          AND SpanAttributes['event.type'] = {key:String}
        GROUP BY full_key
        HAVING field != ''
          ${params.query ? `AND lower(field) LIKE lower(concat({query:String}, '%'))` : ""}
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "events.metrics.value": {
    tableName: "stored_spans",
    buildQuery: (params) => {
      if (!params.key || !params.subkey) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      const attrKey = `event.metrics.${params.subkey}`;
      return `
        SELECT
          min(toFloat64OrNull(SpanAttributes['${attrKey}'])) as min_value,
          max(toFloat64OrNull(SpanAttributes['${attrKey}'])) as max_value
        FROM stored_spans
        WHERE ${buildStoredSpansConditions(params)}
          AND SpanAttributes['event.type'] = {key:String}
          AND SpanAttributes['${attrKey}'] != ''
      `;
    },
    extractResults: (rows: unknown[]) => {
      const row = (rows as Array<{ min_value: number | null; max_value: number | null }>)[0];
      if (!row || row.min_value === null || row.max_value === null) {
        return [];
      }
      return [
        { field: String(Math.ceil(row.min_value)), label: "min", count: 0 },
        { field: String(Math.ceil(row.max_value)), label: "max", count: 0 },
      ];
    },
  },

  "events.event_details.key": {
    tableName: "stored_spans",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      return `
        SELECT
          arrayJoin(arrayFilter(k -> startsWith(k, 'event.details.'), mapKeys(SpanAttributes))) as full_key,
          replaceOne(full_key, 'event.details.', '') as field,
          replaceOne(full_key, 'event.details.', '') as label,
          count() as count
        FROM stored_spans
        WHERE ${buildStoredSpansConditions(params)}
          AND SpanAttributes['event.type'] = {key:String}
        GROUP BY full_key
        HAVING field != ''
          ${params.query ? `AND lower(field) LIKE lower(concat({query:String}, '%'))` : ""}
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },
};

// ============================================================================
// Filter WHERE clause builders for trace listing queries
// ============================================================================

/**
 * Type for filter condition builder functions.
 * Each builder takes filter values and returns SQL + params for parameterized queries.
 * The paramId is used to create unique parameter names when multiple filters are combined.
 */
type FilterConditionBuilder = (
  values: string[],
  paramId: string,
  key?: string,
  subkey?: string
) => FilterConditionResult;

/**
 * ClickHouse WHERE clause builders for filtering traces.
 * Returns null if the filter is not supported in ClickHouse.
 * All builders use parameterized queries for SQL injection safety.
 */
export const clickHouseFilterConditions: Record<FilterField, FilterConditionBuilder | null> = {
  // Topics
  "topics.topics": (values, paramId) => ({
    sql: `ts.TopicId IN ({${paramId}_values:Array(String)})`,
    params: { [`${paramId}_values`]: values },
  }),
  "topics.subtopics": (values, paramId) => ({
    sql: `ts.SubTopicId IN ({${paramId}_values:Array(String)})`,
    params: { [`${paramId}_values`]: values },
  }),

  // Metadata
  "metadata.user_id": (values, paramId) => ({
    sql: `ts.Attributes['user.id'] IN ({${paramId}_values:Array(String)})`,
    params: { [`${paramId}_values`]: values },
  }),
  "metadata.thread_id": (values, paramId) => ({
    sql: `ts.Attributes['thread.id'] IN ({${paramId}_values:Array(String)})`,
    params: { [`${paramId}_values`]: values },
  }),
  "metadata.customer_id": (values, paramId) => ({
    sql: `ts.Attributes['customer.id'] IN ({${paramId}_values:Array(String)})`,
    params: { [`${paramId}_values`]: values },
  }),
  "metadata.labels": (values, paramId) => ({
    sql: `hasAny(JSONExtractArrayRaw(ts.Attributes['langwatch.labels']), arrayMap(x -> concat('"', x, '"'), {${paramId}_values:Array(String)}))`,
    params: { [`${paramId}_values`]: values },
  }),
  "metadata.key": null, // Complex nested filter, not supported
  "metadata.value": null, // Complex nested filter, not supported
  "metadata.prompt_ids": (values, paramId) => ({
    sql: `hasAny(JSONExtractArrayRaw(ts.Attributes['langwatch.prompt_ids']), arrayMap(x -> concat('"', x, '"'), {${paramId}_values:Array(String)}))`,
    params: { [`${paramId}_values`]: values },
  }),

  // Traces
  "traces.error": (values, _paramId) => {
    const hasTrue = values.includes("true");
    const hasFalse = values.includes("false");
    if (hasTrue && hasFalse) return { sql: "1=1", params: {} };
    if (hasTrue) return { sql: "ts.ContainsErrorStatus = true", params: {} };
    if (hasFalse) return { sql: "ts.ContainsErrorStatus = false", params: {} };
    return { sql: "1=0", params: {} };
  },

  // Spans
  "spans.type": null, // Requires join with stored_spans, handled separately
  "spans.model": (values, paramId) => ({
    sql: `hasAny(ts.Models, {${paramId}_values:Array(String)})`,
    params: { [`${paramId}_values`]: values },
  }),

  // Annotations
  "annotations.hasAnnotation": (values, _paramId) => {
    const hasTrue = values.includes("true");
    const hasFalse = values.includes("false");
    if (hasTrue && hasFalse) return { sql: "1=1", params: {} };
    if (hasTrue) return { sql: "ts.HasAnnotation = true", params: {} };
    if (hasFalse) return { sql: "(ts.HasAnnotation = false OR ts.HasAnnotation IS NULL)", params: {} };
    return { sql: "1=0", params: {} };
  },

  // Evaluations - using evaluation_states table with EXISTS subquery
  "evaluations.evaluator_id": (values, paramId) => ({
    sql: `EXISTS (
      SELECT 1 FROM evaluation_states es FINAL
      WHERE es.TenantId = ts.TenantId
        AND es.TraceId = ts.TraceId
        AND es.EvaluatorId IN ({${paramId}_values:Array(String)})
    )`,
    params: { [`${paramId}_values`]: values },
  }),

  "evaluations.evaluator_id.guardrails_only": (values, paramId) => ({
    sql: `EXISTS (
      SELECT 1 FROM evaluation_states es FINAL
      WHERE es.TenantId = ts.TenantId
        AND es.TraceId = ts.TraceId
        AND es.EvaluatorId IN ({${paramId}_values:Array(String)})
        AND es.IsGuardrail = 1
    )`,
    params: { [`${paramId}_values`]: values },
  }),

  "evaluations.passed": (values, paramId, key) => {
    if (!key) return { sql: "1=0", params: {} };
    const passedValues = values.map((v) => (v === "true" || v === "1") ? 1 : 0);
    return {
      sql: `EXISTS (
        SELECT 1 FROM evaluation_states es FINAL
        WHERE es.TenantId = ts.TenantId
          AND es.TraceId = ts.TraceId
          AND es.EvaluatorId = {${paramId}_key:String}
          AND es.Passed IN ({${paramId}_values:Array(UInt8)})
      )`,
      params: {
        [`${paramId}_key`]: key,
        [`${paramId}_values`]: passedValues,
      },
    };
  },

  "evaluations.score": (values, paramId, key) => {
    if (!key || values.length < 2) return { sql: "1=0", params: {} };
    const minScore = parseFloat(values[0] ?? "0");
    const maxScore = parseFloat(values[1] ?? "1");
    return {
      sql: `EXISTS (
        SELECT 1 FROM evaluation_states es FINAL
        WHERE es.TenantId = ts.TenantId
          AND es.TraceId = ts.TraceId
          AND es.EvaluatorId = {${paramId}_key:String}
          AND es.Score >= {${paramId}_min:Float64}
          AND es.Score <= {${paramId}_max:Float64}
      )`,
      params: {
        [`${paramId}_key`]: key,
        [`${paramId}_min`]: minScore,
        [`${paramId}_max`]: maxScore,
      },
    };
  },

  "evaluations.state": (values, paramId, key) => {
    if (!key) return { sql: "1=0", params: {} };
    return {
      sql: `EXISTS (
        SELECT 1 FROM evaluation_states es FINAL
        WHERE es.TenantId = ts.TenantId
          AND es.TraceId = ts.TraceId
          AND es.EvaluatorId = {${paramId}_key:String}
          AND es.Status IN ({${paramId}_values:Array(String)})
      )`,
      params: {
        [`${paramId}_key`]: key,
        [`${paramId}_values`]: values,
      },
    };
  },

  "evaluations.label": (values, paramId, key) => {
    if (!key) return { sql: "1=0", params: {} };
    return {
      sql: `EXISTS (
        SELECT 1 FROM evaluation_states es FINAL
        WHERE es.TenantId = ts.TenantId
          AND es.TraceId = ts.TraceId
          AND es.EvaluatorId = {${paramId}_key:String}
          AND es.Label IN ({${paramId}_values:Array(String)})
      )`,
      params: {
        [`${paramId}_key`]: key,
        [`${paramId}_values`]: values,
      },
    };
  },

  // Events - using stored_spans table with span attributes
  "events.event_type": (values, paramId) => ({
    sql: `EXISTS (
      SELECT 1 FROM stored_spans sp FINAL
      WHERE sp.TenantId = ts.TenantId
        AND sp.TraceId = ts.TraceId
        AND sp.SpanAttributes['event.type'] IN ({${paramId}_values:Array(String)})
    )`,
    params: { [`${paramId}_values`]: values },
  }),

  "events.metrics.key": (values, paramId, key) => {
    if (!key) return { sql: "1=0", params: {} };
    // Build OR conditions for each metric key - these are attribute names, not values
    // Since attribute names are controlled internally, we use them directly
    const metricConditions = values.map(
      (v, i) => `sp.SpanAttributes[{${paramId}_attrkey_${i}:String}] != ''`
    );
    const params: Record<string, unknown> = {
      [`${paramId}_key`]: key,
    };
    values.forEach((v, i) => {
      params[`${paramId}_attrkey_${i}`] = `event.metrics.${v}`;
    });
    return {
      sql: `EXISTS (
        SELECT 1 FROM stored_spans sp FINAL
        WHERE sp.TenantId = ts.TenantId
          AND sp.TraceId = ts.TraceId
          AND sp.SpanAttributes['event.type'] = {${paramId}_key:String}
          AND (${metricConditions.join(" OR ")})
      )`,
      params,
    };
  },

  "events.metrics.value": (values, paramId, key, subkey) => {
    if (!key || !subkey || values.length < 2) return { sql: "1=0", params: {} };
    const minValue = parseFloat(values[0] ?? "0");
    const maxValue = parseFloat(values[1] ?? "0");
    return {
      sql: `EXISTS (
        SELECT 1 FROM stored_spans sp FINAL
        WHERE sp.TenantId = ts.TenantId
          AND sp.TraceId = ts.TraceId
          AND sp.SpanAttributes['event.type'] = {${paramId}_key:String}
          AND toFloat64OrNull(sp.SpanAttributes[{${paramId}_attrkey:String}]) >= {${paramId}_min:Float64}
          AND toFloat64OrNull(sp.SpanAttributes[{${paramId}_attrkey:String}]) <= {${paramId}_max:Float64}
      )`,
      params: {
        [`${paramId}_key`]: key,
        [`${paramId}_attrkey`]: `event.metrics.${subkey}`,
        [`${paramId}_min`]: minValue,
        [`${paramId}_max`]: maxValue,
      },
    };
  },

  "events.event_details.key": (values, paramId, key) => {
    if (!key) return { sql: "1=0", params: {} };
    // Build OR conditions for each detail key
    const detailConditions = values.map(
      (v, i) => `sp.SpanAttributes[{${paramId}_attrkey_${i}:String}] != ''`
    );
    const params: Record<string, unknown> = {
      [`${paramId}_key`]: key,
    };
    values.forEach((v, i) => {
      params[`${paramId}_attrkey_${i}`] = `event.details.${v}`;
    });
    return {
      sql: `EXISTS (
        SELECT 1 FROM stored_spans sp FINAL
        WHERE sp.TenantId = ts.TenantId
          AND sp.TraceId = ts.TraceId
          AND sp.SpanAttributes['event.type'] = {${paramId}_key:String}
          AND (${detailConditions.join(" OR ")})
      )`,
      params,
    };
  },
};

/**
 * Generate ClickHouse WHERE conditions from filter parameters.
 * Returns SQL condition strings and aggregated parameters for parameterized queries.
 *
 * @param filters - The filter parameters from the request
 * @returns Object with conditions array, aggregated params, and unsupported filter flag
 */
export function generateClickHouseFilterConditions(
  filters: Partial<Record<FilterField, FilterParam>>
): { conditions: string[]; params: Record<string, unknown>; hasUnsupportedFilters: boolean } {
  const conditions: string[] = [];
  const allParams: Record<string, unknown> = {};
  let hasUnsupportedFilters = false;
  let paramCounter = 0;

  for (const [field, filterParams] of Object.entries(filters)) {
    if (!filterParams || (Array.isArray(filterParams) && filterParams.length === 0)) {
      continue;
    }

    const filterField = field as FilterField;
    const conditionBuilder = clickHouseFilterConditions[filterField];

    if (conditionBuilder === null) {
      // Filter not supported in ClickHouse
      hasUnsupportedFilters = true;
      continue;
    }

    // Handle simple array filters
    if (Array.isArray(filterParams)) {
      const paramId = `f${paramCounter++}`;
      const result = conditionBuilder(filterParams, paramId);
      conditions.push(result.sql);
      Object.assign(allParams, result.params);
    }
    // Handle nested filters (key -> values)
    else if (typeof filterParams === "object") {
      // For nested filters, we need to OR together the conditions for each key
      const nestedConditions: string[] = [];
      for (const [key, values] of Object.entries(filterParams)) {
        if (Array.isArray(values) && values.length > 0) {
          const paramId = `f${paramCounter++}`;
          const result = conditionBuilder(values, paramId, key);
          nestedConditions.push(result.sql);
          Object.assign(allParams, result.params);
        }
      }
      if (nestedConditions.length > 0) {
        conditions.push(`(${nestedConditions.join(" OR ")})`);
      }
    }
  }

  return { conditions, params: allParams, hasUnsupportedFilters };
}
