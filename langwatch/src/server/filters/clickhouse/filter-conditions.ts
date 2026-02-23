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

  // Sentiment - input satisfaction score not exposed as filterable column in ClickHouse
  "sentiment.input_sentiment": null,

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

  // Evaluations - using evaluation_runs table with EXISTS subquery
  "evaluations.evaluator_id": (values, paramId) => ({
    sql: `EXISTS (
      SELECT 1 FROM evaluation_runs es
      WHERE es.TenantId = ts.TenantId
        AND es.TraceId = ts.TraceId
        AND es.EvaluatorId IN ({${paramId}_values:Array(String)})
    )`,
    params: { [`${paramId}_values`]: values },
  }),

  "evaluations.evaluator_id.guardrails_only": (values, paramId) => ({
    sql: `EXISTS (
      SELECT 1 FROM evaluation_runs es
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
        SELECT 1 FROM evaluation_runs es
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
    const minScore = parseFloat(values[0] ?? "");
    const maxScore = parseFloat(values[1] ?? "");
    // Reject invalid ranges: NaN values or min > max
    if (!Number.isFinite(minScore) || !Number.isFinite(maxScore)) {
      return { sql: "1=0", params: {} };
    }
    if (minScore > maxScore) {
      return { sql: "1=0", params: {} };
    }
    return {
      sql: `EXISTS (
        SELECT 1 FROM evaluation_runs es
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
        SELECT 1 FROM evaluation_runs es
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
        SELECT 1 FROM evaluation_runs es
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
      SELECT 1 FROM stored_spans sp
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
        SELECT 1 FROM stored_spans sp
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
    const minValue = parseFloat(values[0] ?? "");
    const maxValue = parseFloat(values[1] ?? "");
    // Reject invalid ranges: NaN values or min > max
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      return { sql: "1=0", params: {} };
    }
    if (minValue > maxValue) {
      return { sql: "1=0", params: {} };
    }
    return {
      sql: `EXISTS (
        SELECT 1 FROM stored_spans sp
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
        SELECT 1 FROM stored_spans sp
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
 * Recursively collects ClickHouse WHERE conditions from nested filter parameters.
 * Mirrors the Elasticsearch collectConditions pattern in common.ts.
 *
 * @param field - The filter field being processed
 * @param params - Filter params: string[] | Record<string, ...> | Record<string, Record<string, ...>>
 * @param keys - Accumulated keys from parent levels [key, subkey, ...]
 * @param paramCounter - Mutable counter for unique parameter IDs
 * @param allParams - Accumulated query parameters
 * @returns Object with conditions array and unsupported filter flag
 */
function collectClickHouseConditions(
  field: FilterField,
  params: string[] | Record<string, unknown>,
  keys: string[],
  paramCounter: { value: number },
  allParams: Record<string, unknown>,
): { conditions: string[]; hasUnsupported: boolean } {
  const key = keys[0];
  const subkey = keys[1];
  const conditionBuilder = clickHouseFilterConditions[field];

  // BASE CASE: params is an array of values (leaf node)
  if (Array.isArray(params)) {
    if (params.length === 0) {
      return { conditions: [], hasUnsupported: false };
    }

    if (!conditionBuilder) {
      return { conditions: [], hasUnsupported: true };
    }

    const paramId = `f${paramCounter.value++}`;
    const result = conditionBuilder(params, paramId, key, subkey);
    Object.assign(allParams, result.params);

    return { conditions: [result.sql], hasUnsupported: false };
  }

  // RECURSIVE CASE: params is a nested object
  if (typeof params === "object" && params !== null) {
    const nestedConditions: string[] = [];
    let hasUnsupported = false;

    for (const [nextKey, nextValue] of Object.entries(params)) {
      const result = collectClickHouseConditions(
        field,
        nextValue as string[] | Record<string, unknown>,
        [...keys, nextKey], // Accumulate keys as we recurse
        paramCounter,
        allParams,
      );

      if (result.hasUnsupported) hasUnsupported = true;
      nestedConditions.push(...result.conditions);
    }

    if (nestedConditions.length === 0) {
      return { conditions: [], hasUnsupported };
    }

    // OR together conditions at this level
    if (nestedConditions.length === 1) {
      return { conditions: nestedConditions, hasUnsupported };
    }

    return {
      conditions: [`(${nestedConditions.join(" OR ")})`],
      hasUnsupported,
    };
  }

  return { conditions: [], hasUnsupported: false };
}

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
  const paramCounter = { value: 0 };
  let hasUnsupportedFilters = false;

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

    // Use recursive helper to handle any nesting depth
    const result = collectClickHouseConditions(
      filterField,
      filterParams,
      [], // Start with empty keys array
      paramCounter,
      allParams,
    );

    if (result.hasUnsupported) hasUnsupportedFilters = true;
    conditions.push(...result.conditions);
  }

  return { conditions, params: allParams, hasUnsupportedFilters };
}
