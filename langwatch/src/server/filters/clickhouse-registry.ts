import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterField } from "./types";

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
  tableName: "trace_summaries" | "stored_spans" | null;
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

  // Evaluation filters - NOT supported in ClickHouse, fall back to Elasticsearch
  "evaluations.evaluator_id": null,
  "evaluations.evaluator_id.guardrails_only": null,
  "evaluations.passed": null,
  "evaluations.score": null,
  "evaluations.state": null,
  "evaluations.label": null,

  // Event filters - NOT supported in ClickHouse, fall back to Elasticsearch
  "events.event_type": null,
  "events.metrics.key": null,
  "events.metrics.value": null,
  "events.event_details.key": null,
};

// ============================================================================
// Filter WHERE clause builders for trace listing queries
// ============================================================================

/**
 * ClickHouse WHERE clause builders for filtering traces.
 * Returns null if the filter is not supported in ClickHouse.
 */
export const clickHouseFilterConditions: Record<
  FilterField,
  ((values: string[], key?: string, subkey?: string) => string) | null
> = {
  // Topics
  "topics.topics": (values) =>
    `ts.TopicId IN (${values.map((v) => `'${escapeString(v)}'`).join(", ")})`,
  "topics.subtopics": (values) =>
    `ts.SubTopicId IN (${values.map((v) => `'${escapeString(v)}'`).join(", ")})`,

  // Metadata
  "metadata.user_id": (values) =>
    `ts.Attributes['user.id'] IN (${values.map((v) => `'${escapeString(v)}'`).join(", ")})`,
  "metadata.thread_id": (values) =>
    `ts.Attributes['thread.id'] IN (${values.map((v) => `'${escapeString(v)}'`).join(", ")})`,
  "metadata.customer_id": (values) =>
    `ts.Attributes['customer.id'] IN (${values.map((v) => `'${escapeString(v)}'`).join(", ")})`,
  "metadata.labels": (values) =>
    `hasAny(JSONExtractArrayRaw(ts.Attributes['langwatch.labels']), [${values.map((v) => `'"${escapeString(v)}"'`).join(", ")}])`,
  "metadata.key": null, // Complex nested filter, not supported
  "metadata.value": null, // Complex nested filter, not supported
  "metadata.prompt_ids": (values) =>
    `hasAny(JSONExtractArrayRaw(ts.Attributes['langwatch.prompt_ids']), [${values.map((v) => `'"${escapeString(v)}"'`).join(", ")}])`,

  // Traces
  "traces.error": (values) => {
    const hasTrue = values.includes("true");
    const hasFalse = values.includes("false");
    if (hasTrue && hasFalse) return "1=1"; // Both selected = no filter
    if (hasTrue) return "ts.ContainsErrorStatus = true";
    if (hasFalse) return "ts.ContainsErrorStatus = false";
    return "1=0"; // Neither = no results
  },

  // Spans
  "spans.type": null, // Requires join with stored_spans, handled separately
  "spans.model": (values) =>
    `hasAny(ts.Models, [${values.map((v) => `'${escapeString(v)}'`).join(", ")}])`,

  // Annotations
  "annotations.hasAnnotation": (values) => {
    const hasTrue = values.includes("true");
    const hasFalse = values.includes("false");
    if (hasTrue && hasFalse) return "1=1";
    if (hasTrue) return "ts.HasAnnotation = true";
    if (hasFalse) return "(ts.HasAnnotation = false OR ts.HasAnnotation IS NULL)";
    return "1=0";
  },

  // Evaluations - NOT supported in ClickHouse
  "evaluations.evaluator_id": null,
  "evaluations.evaluator_id.guardrails_only": null,
  "evaluations.passed": null,
  "evaluations.score": null,
  "evaluations.state": null,
  "evaluations.label": null,

  // Events - NOT supported in ClickHouse
  "events.event_type": null,
  "events.metrics.key": null,
  "events.metrics.value": null,
  "events.event_details.key": null,
};

/**
 * Escape a string for use in ClickHouse SQL.
 */
function escapeString(value: string): string {
  return value.replace(/'/g, "\\'").replace(/\\/g, "\\\\");
}

/**
 * Generate ClickHouse WHERE conditions from filter parameters.
 * Returns an array of SQL condition strings.
 *
 * @param filters - The filter parameters from the request
 * @returns Array of SQL WHERE conditions, or null if any filter is unsupported
 */
export function generateClickHouseFilterConditions(
  filters: Partial<Record<FilterField, FilterParam>>
): { conditions: string[]; hasUnsupportedFilters: boolean } {
  const conditions: string[] = [];
  let hasUnsupportedFilters = false;

  for (const [field, params] of Object.entries(filters)) {
    if (!params || (Array.isArray(params) && params.length === 0)) {
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
    if (Array.isArray(params)) {
      conditions.push(conditionBuilder(params));
    }
    // Handle nested filters (key -> values)
    else if (typeof params === "object") {
      // For nested filters, we need to OR together the conditions for each key
      const nestedConditions: string[] = [];
      for (const [key, values] of Object.entries(params)) {
        if (Array.isArray(values) && values.length > 0) {
          nestedConditions.push(conditionBuilder(values, key));
        }
      }
      if (nestedConditions.length > 0) {
        conditions.push(`(${nestedConditions.join(" OR ")})`);
      }
    }
  }

  return { conditions, hasUnsupportedFilters };
}
