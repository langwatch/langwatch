import type { FilterField } from "../types";
import {
  ATTRIBUTE_KEYS,
  buildEvaluationRunsConditions,
  buildQueryFilter,
  buildScopeConditions,
  buildStoredSpansConditions,
  buildTraceSummariesConditions,
  extractStandardResults,
} from "./query-helpers";
import type { ClickHouseFilterDefinition } from "./types";

/**
 * ClickHouse filter definitions for each filter field.
 * Each definition specifies how to query filter options from ClickHouse.
 * Set to null for filters not supported in ClickHouse (will fall back to Elasticsearch).
 */
export const clickHouseFilters: Record<
  FilterField,
  ClickHouseFilterDefinition | null
> = {
  // Topics filters
  "topics.topics": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          TopicId as field,
          TopicId as label,
          count() as count
        FROM trace_summaries ts FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND ts.TopicId IS NOT NULL
          AND ts.TopicId != ''
          ${buildQueryFilter("ts.TopicId", params)}
          ${scopeSql}
        GROUP BY TopicId
        ORDER BY TopicId ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "topics.subtopics": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          SubTopicId as field,
          SubTopicId as label,
          count() as count
        FROM trace_summaries ts FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND ts.SubTopicId IS NOT NULL
          AND ts.SubTopicId != ''
          ${buildQueryFilter("ts.SubTopicId", params)}
          ${scopeSql}
        GROUP BY SubTopicId
        ORDER BY SubTopicId ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  // Metadata filters
  "metadata.user_id": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          ts.${ATTRIBUTE_KEYS.user_id} as field,
          ts.${ATTRIBUTE_KEYS.user_id} as label,
          count() as count
        FROM trace_summaries ts FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND ts.${ATTRIBUTE_KEYS.user_id} != ''
          ${buildQueryFilter(`ts.${ATTRIBUTE_KEYS.user_id}`, params)}
          ${scopeSql}
        GROUP BY field
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "metadata.thread_id": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          ts.${ATTRIBUTE_KEYS.thread_id} as field,
          ts.${ATTRIBUTE_KEYS.thread_id} as label,
          count() as count
        FROM trace_summaries ts FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND ts.${ATTRIBUTE_KEYS.thread_id} != ''
          ${buildQueryFilter(`ts.${ATTRIBUTE_KEYS.thread_id}`, params)}
          ${scopeSql}
        GROUP BY field
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "metadata.customer_id": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          ts.${ATTRIBUTE_KEYS.customer_id} as field,
          ts.${ATTRIBUTE_KEYS.customer_id} as label,
          count() as count
        FROM trace_summaries ts FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND ts.${ATTRIBUTE_KEYS.customer_id} != ''
          ${buildQueryFilter(`ts.${ATTRIBUTE_KEYS.customer_id}`, params)}
          ${scopeSql}
        GROUP BY field
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "metadata.labels": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          trim(BOTH '"' FROM label) as field,
          trim(BOTH '"' FROM label) as label,
          count() as count
        FROM (
          SELECT arrayJoin(JSONExtractArrayRaw(ts.Attributes['langwatch.labels'])) as label
          FROM trace_summaries ts FINAL
          WHERE ${buildTraceSummariesConditions(params)}
            AND ts.Attributes['langwatch.labels'] != ''
            AND ts.Attributes['langwatch.labels'] != '[]'
            ${scopeSql}
        )
        WHERE label != '' AND label != 'null'
          ${params.query ? `AND lower(trim(BOTH '"' FROM label)) LIKE lower(concat({query:String}, '%'))` : ""}
        GROUP BY label
        ORDER BY label ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "metadata.key": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          replaceAll(key, '.', '·') as field,
          key as label,
          count() as count
        FROM (
          SELECT arrayJoin(mapKeys(ts.Attributes)) as key
          FROM trace_summaries ts FINAL
          WHERE ${buildTraceSummariesConditions(params)}
            ${scopeSql}
        )
        WHERE NOT startsWith(key, 'langwatch.')
          AND NOT startsWith(key, 'gen_ai.')
          ${buildQueryFilter("key", params)}
        GROUP BY key
        ORDER BY key ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "metadata.value": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      const { sql: scopeSql } = buildScopeConditions(params);
      // Note: The key parameter is passed via query_params as {key:String}
      // We convert the dot-encoded key back in the service layer before passing it
      return `
        SELECT
          ts.Attributes[{key:String}] as field,
          ts.Attributes[{key:String}] as label,
          count() as count
        FROM trace_summaries ts FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          AND ts.Attributes[{key:String}] != ''
          ${params.query ? `AND lower(ts.Attributes[{key:String}]) LIKE lower(concat({query:String}, '%'))` : ""}
          ${scopeSql}
        GROUP BY field
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "metadata.prompt_ids": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          trim(BOTH '"' FROM prompt_id) as field,
          trim(BOTH '"' FROM prompt_id) as label,
          count() as count
        FROM (
          SELECT arrayJoin(JSONExtractArrayRaw(ts.Attributes['langwatch.prompt_ids'])) as prompt_id
          FROM trace_summaries ts FINAL
          WHERE ${buildTraceSummariesConditions(params)}
            AND ts.Attributes['langwatch.prompt_ids'] != ''
            AND ts.Attributes['langwatch.prompt_ids'] != '[]'
            ${scopeSql}
        )
        WHERE prompt_id != '' AND prompt_id != 'null'
          ${params.query ? `AND lower(trim(BOTH '"' FROM prompt_id)) LIKE lower(concat({query:String}, '%'))` : ""}
        GROUP BY prompt_id
        ORDER BY prompt_id ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  // Trace filters
  "traces.error": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          if(ts.ContainsErrorStatus, 'true', 'false') as field,
          if(ts.ContainsErrorStatus, 'Traces with error', 'Traces without error') as label,
          count() as count
        FROM trace_summaries ts FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          ${scopeSql}
        GROUP BY ts.ContainsErrorStatus
        ORDER BY field ASC
      `;
    },
    extractResults: extractStandardResults,
  },

  // Span filters
  "spans.type": {
    tableName: "stored_spans",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          SpanAttributes['langwatch.span.type'] as field,
          SpanAttributes['langwatch.span.type'] as label,
          count() as count
        FROM stored_spans FINAL
        WHERE ${buildStoredSpansConditions(params)}
          AND SpanAttributes['langwatch.span.type'] != ''
          ${buildQueryFilter("SpanAttributes['langwatch.span.type']", params)}
          ${scopeJoin}
        GROUP BY field
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "spans.model": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          model as field,
          model as label,
          count() as count
        FROM (
          SELECT arrayJoin(ts.Models) as model
          FROM trace_summaries ts FINAL
          WHERE ${buildTraceSummariesConditions(params)}
            ${scopeSql}
        )
        WHERE model != ''
          ${buildQueryFilter("model", params)}
        GROUP BY model
        ORDER BY model ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  // Sentiment - input satisfaction score not exposed as filterable in ClickHouse
  "sentiment.input_sentiment": null,

  // Annotation filters
  "annotations.hasAnnotation": {
    tableName: "trace_summaries",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      return `
        SELECT
          if(ts.HasAnnotation = true, 'true', 'false') as field,
          if(ts.HasAnnotation = true, 'Has Annotation', 'No Annotation') as label,
          count() as count
        FROM trace_summaries ts FINAL
        WHERE ${buildTraceSummariesConditions(params)}
          ${scopeSql}
        GROUP BY ts.HasAnnotation
        ORDER BY field DESC
      `;
    },
    extractResults: extractStandardResults,
  },

  // Evaluation filters - using evaluation_runs table
  // Note: evaluation_runs filters require a join with trace_summaries for scope conditions
  // For now, we'll add scope via a subquery when scopeFilters are present
  "evaluations.evaluator_id": {
    tableName: "evaluation_runs",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          EvaluatorId as field,
          if(EvaluatorName != '', concat('[', EvaluatorType, '] ', EvaluatorName), concat('[', EvaluatorType, '] ', EvaluatorId)) as label,
          count() as count
        FROM evaluation_runs FINAL
        WHERE ${buildEvaluationRunsConditions(params)}
          ${params.query ? `AND lower(ifNull(EvaluatorName, '')) LIKE lower(concat({query:String}, '%'))` : ""}
          ${scopeJoin}
        GROUP BY EvaluatorId, EvaluatorType, EvaluatorName
        ORDER BY label ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "evaluations.evaluator_id.guardrails_only": {
    tableName: "evaluation_runs",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          EvaluatorId as field,
          if(EvaluatorName != '', concat('[', EvaluatorType, '] ', EvaluatorName), concat('[', EvaluatorType, '] ', EvaluatorId)) as label,
          count() as count
        FROM evaluation_runs FINAL
        WHERE ${buildEvaluationRunsConditions(params)}
          AND IsGuardrail = 1
          ${params.query ? `AND lower(ifNull(EvaluatorName, '')) LIKE lower(concat({query:String}, '%'))` : ""}
          ${scopeJoin}
        GROUP BY EvaluatorId, EvaluatorType, EvaluatorName
        ORDER BY label ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "evaluations.passed": {
    tableName: "evaluation_runs",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          if(Passed = 1, 'true', 'false') as field,
          if(Passed = 1, 'Passed', 'Failed') as label,
          count() as count
        FROM evaluation_runs FINAL
        WHERE ${buildEvaluationRunsConditions(params)}
          AND EvaluatorId = {key:String}
          AND Passed IS NOT NULL
          ${scopeJoin}
        GROUP BY Passed
        ORDER BY field DESC
      `;
    },
    extractResults: extractStandardResults,
  },

  "evaluations.score": {
    tableName: "evaluation_runs",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          min(Score) as min_score,
          max(Score) as max_score
        FROM evaluation_runs FINAL
        WHERE ${buildEvaluationRunsConditions(params)}
          AND EvaluatorId = {key:String}
          AND Score IS NOT NULL
          ${scopeJoin}
      `;
    },
    extractResults: (rows: unknown[]) => {
      const row = (
        rows as Array<{ min_score: number | null; max_score: number | null }>
      )[0];
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
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          Status as field,
          Status as label,
          count() as count
        FROM evaluation_runs FINAL
        WHERE ${buildEvaluationRunsConditions(params)}
          AND EvaluatorId = {key:String}
          AND Status NOT IN ('succeeded', 'failed')
          ${scopeJoin}
        GROUP BY Status
        ORDER BY Status ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "evaluations.label": {
    tableName: "evaluation_runs",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          Label as field,
          Label as label,
          count() as count
        FROM evaluation_runs FINAL
        WHERE ${buildEvaluationRunsConditions(params)}
          AND EvaluatorId = {key:String}
          AND Label IS NOT NULL
          AND Label != ''
          AND Label NOT IN ('succeeded', 'failed')
          ${params.query ? `AND lower(Label) LIKE lower(concat({query:String}, '%'))` : ""}
          ${scopeJoin}
        GROUP BY Label
        ORDER BY Label ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  // Event filters - using stored_spans table with span attributes
  // Note: stored_spans filters require a join with trace_summaries for scope conditions
  "events.event_type": {
    tableName: "stored_spans",
    buildQuery: (params) => {
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          SpanAttributes['event.type'] as field,
          SpanAttributes['event.type'] as label,
          count() as count
        FROM stored_spans FINAL
        WHERE ${buildStoredSpansConditions(params)}
          AND SpanAttributes['event.type'] != ''
          ${params.query ? `AND lower(SpanAttributes['event.type']) LIKE lower(concat({query:String}, '%'))` : ""}
          ${scopeJoin}
        GROUP BY field
        ORDER BY field ASC
        LIMIT 10000
      `;
    },
    extractResults: extractStandardResults,
  },

  "events.metrics.key": {
    tableName: "stored_spans",
    buildQuery: (params) => {
      if (!params.key) {
        return `SELECT '' as field, '' as label, 0 as count WHERE false`;
      }
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          arrayJoin(arrayFilter(k -> startsWith(k, 'event.metrics.'), mapKeys(SpanAttributes))) as full_key,
          replaceOne(full_key, 'event.metrics.', '') as field,
          replaceOne(full_key, 'event.metrics.', '') as label,
          count() as count
        FROM stored_spans FINAL
        WHERE ${buildStoredSpansConditions(params)}
          AND SpanAttributes['event.type'] = {key:String}
          ${scopeJoin}
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
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      // Note: subkey is passed via query_params, we construct the full attribute key there
      return `
        SELECT
          min(toFloat64OrNull(SpanAttributes[concat('event.metrics.', {subkey:String})])) as min_value,
          max(toFloat64OrNull(SpanAttributes[concat('event.metrics.', {subkey:String})])) as max_value
        FROM stored_spans FINAL
        WHERE ${buildStoredSpansConditions(params)}
          AND SpanAttributes['event.type'] = {key:String}
          AND SpanAttributes[concat('event.metrics.', {subkey:String})] != ''
          ${scopeJoin}
      `;
    },
    extractResults: (rows: unknown[]) => {
      const row = (
        rows as Array<{ min_value: number | null; max_value: number | null }>
      )[0];
      if (!row || row.min_value === null || row.max_value === null) {
        return [];
      }
      return [
        { field: String(Math.floor(row.min_value)), label: "min", count: 0 },
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
      const { sql: scopeSql } = buildScopeConditions(params);
      const scopeJoin = scopeSql
        ? `AND TraceId IN (SELECT TraceId FROM trace_summaries ts FINAL WHERE ${buildTraceSummariesConditions(params)} ${scopeSql})`
        : "";
      return `
        SELECT
          arrayJoin(arrayFilter(k -> startsWith(k, 'event.details.'), mapKeys(SpanAttributes))) as full_key,
          replaceOne(full_key, 'event.details.', '') as field,
          replaceOne(full_key, 'event.details.', '') as label,
          count() as count
        FROM stored_spans FINAL
        WHERE ${buildStoredSpansConditions(params)}
          AND SpanAttributes['event.type'] = {key:String}
          ${scopeJoin}
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
