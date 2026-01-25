import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterField } from "../types";
import type {
  FilterConditionBuilder,
  FilterConditionResult,
  GenerateFilterConditionsResult,
} from "./types";

/**
 * ClickHouse WHERE clause builders for filtering traces.
 * Returns null if the filter is not supported in ClickHouse.
 * All builders use parameterized queries for SQL injection safety.
 */
export const clickHouseFilterConditions: Record<
  FilterField,
  FilterConditionBuilder | null
> = {
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
    if (hasFalse)
      return {
        sql: "(ts.HasAnnotation = false OR ts.HasAnnotation IS NULL)",
        params: {},
      };
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
    const passedValues = values.map((v) => (v === "true" || v === "1" ? 1 : 0));
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
    const parsedMin = parseFloat(values[0] ?? "");
    const parsedMax = parseFloat(values[1] ?? "");
    // Validate numeric values, use safe defaults if parsing fails
    const minScore = Number.isFinite(parsedMin) ? parsedMin : 0;
    const maxScore = Number.isFinite(parsedMax) ? parsedMax : 1;
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
      (_v, i) => `sp.SpanAttributes[{${paramId}_attrkey_${i}:String}] != ''`,
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
    const parsedMin = parseFloat(values[0] ?? "");
    const parsedMax = parseFloat(values[1] ?? "");
    // Validate numeric values, use safe defaults if parsing fails
    const minValue = Number.isFinite(parsedMin) ? parsedMin : 0;
    const maxValue = Number.isFinite(parsedMax) ? parsedMax : 0;
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
      (_v, i) => `sp.SpanAttributes[{${paramId}_attrkey_${i}:String}] != ''`,
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
  filters: Partial<Record<FilterField, FilterParam>>,
): GenerateFilterConditionsResult {
  const conditions: string[] = [];
  const allParams: Record<string, unknown> = {};
  let hasUnsupportedFilters = false;
  let paramCounter = 0;

  for (const [field, filterParams] of Object.entries(filters)) {
    if (
      !filterParams ||
      (Array.isArray(filterParams) && filterParams.length === 0)
    ) {
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
