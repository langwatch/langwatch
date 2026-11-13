import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type {
  TraceAttributedTrace,
  TraceAttributeUsageBucket,
  TraceAttributeValueSpend,
  TraceModelSpendWindow,
} from "@langwatch/trace-contract";

import { TraceAttributeSpendRepository } from "../trace-attribute-spend.repository.ts";

type ValueSpendRow = { Value: string; SpentUsd: string; Requests: number | string };
type BucketRow = {
  Value: string;
  Model: string;
  Day: string;
  TotalUsd: string;
  Requests: number | string;
  BlockedRequests: number | string;
};
type TraceRow = {
  TraceId: string;
  Value: string;
  CostUsd: string;
  Models: string[] | null;
  OccurredAtMs: number | string;
  PromptTokens: number | string;
  CompletionTokens: number | string;
  DurationMs: number | string | null;
  HasError: boolean | number;
  Blocked: boolean | number;
};

const FIRST_MODEL = `if(length(argMax(Models, UpdatedAt)) = 0, 'unknown', arrayElement(argMax(Models, UpdatedAt), 1))`;

/** The window on the `OccurredAt` partition key; `values` absent means any non-empty value. */
function attributeFilter(input: {
  tenantId: string;
  attributeKey: string;
  window: TraceModelSpendWindow;
  values?: string[];
}) {
  return windowedAttributeFilter({
    tenantPredicate: "TenantId = {tenantId:String}",
    tenantParams: { tenantId: input.tenantId },
    ...input,
  });
}

/**
 * The same filter over a declared tenant set, so a read across an organization's projects is one
 * statement (ARCHITECTURE.md "Routing is folded into the `clickhouse` member"): one statement per
 * project fills the ClickHouse statement queue in an organization with many projects.
 */
function tenantSetAttributeFilter(input: {
  tenantIds: readonly string[];
  attributeKey: string;
  window: TraceModelSpendWindow;
  values?: string[];
}) {
  return windowedAttributeFilter({
    tenantPredicate: "TenantId IN ({tenantIds:Array(String)})",
    tenantParams: { tenantIds: [...input.tenantIds] },
    ...input,
  });
}

function windowedAttributeFilter(input: {
  tenantPredicate: string;
  tenantParams: Record<string, string | string[]>;
  attributeKey: string;
  window: TraceModelSpendWindow;
  values?: string[];
}) {
  return {
    where: `WHERE ${input.tenantPredicate}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
            AND ${input.values ? "Attributes[{attributeKey:String}] IN {values:Array(String)}" : "Attributes[{attributeKey:String}] != ''"}`,
    params: {
      ...input.tenantParams,
      attributeKey: input.attributeKey,
      fromMs: input.window.startMs,
      toMs: input.window.endMs,
      ...(input.values ? { values: input.values } : {}),
    },
  };
}

/**
 * A spend rollup's ceiling on threads and runtime. The runtime cap stays under the client's 30 s
 * request deadline, so a slow read ends with ClickHouse's own timeout, not a dropped request.
 */
const SPEND_ROLLUP_SETTINGS = { max_threads: 2, max_execution_time: 28 };

/** Main's gateway `GatewayVirtualKeySpendRepository` reads; the usage reads span a tenant set. */
export class ClickHouseTraceAttributeSpendRepository extends TraceAttributeSpendRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseTraceAttributeSpendRepository {
    return new ClickHouseTraceAttributeSpendRepository(clickhouse);
  }

  async findSpendByAttributeValue(input: {
    tenantId: string;
    attributeKey: string;
    values: string[];
    window: TraceModelSpendWindow;
  }): Promise<TraceAttributeValueSpend[]> {
    if (input.values.length === 0) return [];
    const { where, params } = attributeFilter(input);
    const result = await this.#clickhouse.query<ValueSpendRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT Value, toString(sum(TraceCost)) AS SpentUsd, count() AS Requests
        FROM (
          SELECT
            TraceId,
            argMax(Attributes[{attributeKey:String}], UpdatedAt) AS Value,
            argMax(coalesce(TotalCost, 0), UpdatedAt) AS TraceCost
          FROM trace_summaries
          ${where}
          GROUP BY TraceId
        )
        GROUP BY Value
      `,
      params,
    });
    return result.rows.map((row) => ({
      value: row.Value,
      spentUsd: row.SpentUsd,
      requests: Number(row.Requests) || 0,
    }));
  }

  async findAttributeUsageBuckets(input: {
    tenantIds: readonly string[];
    attributeKey: string;
    window: TraceModelSpendWindow;
    values?: string[];
  }): Promise<TraceAttributeUsageBucket[]> {
    const [firstTenantId] = input.tenantIds;
    if (firstTenantId === undefined || input.values?.length === 0) return [];
    const { where, params } = tenantSetAttributeFilter(input);
    const result = await this.#clickhouse.query<BucketRow>({
      tenantId: firstTenantId,
      tenantIds: input.tenantIds,
      table: "trace_summaries",
      settings: SPEND_ROLLUP_SETTINGS,
      sql: `
        SELECT
          Value,
          Model,
          Day,
          toString(sum(TraceCost)) AS TotalUsd,
          count() AS Requests,
          countIf(Blocked) AS BlockedRequests
        FROM (
          SELECT
            TraceId,
            argMax(Attributes[{attributeKey:String}], UpdatedAt) AS Value,
            argMax(coalesce(TotalCost, 0), UpdatedAt) AS TraceCost,
            ${FIRST_MODEL} AS Model,
            formatDateTime(argMax(OccurredAt, UpdatedAt), '%Y-%m-%d', 'UTC') AS Day,
            argMax(BlockedByGuardrail, UpdatedAt) AS Blocked
          FROM trace_summaries
          ${where}
          GROUP BY TenantId, TraceId
        )
        GROUP BY Value, Model, Day
      `,
      params,
    });
    return result.rows.map((row) => ({
      value: row.Value,
      model: row.Model,
      day: row.Day,
      totalUsd: row.TotalUsd,
      requests: Number(row.Requests) || 0,
      blockedRequests: Number(row.BlockedRequests) || 0,
    }));
  }

  async findAttributedTraces(input: {
    tenantIds: readonly string[];
    attributeKey: string;
    window: TraceModelSpendWindow;
    values?: string[];
    model?: string;
    limit: number;
  }): Promise<TraceAttributedTrace[]> {
    const [firstTenantId] = input.tenantIds;
    if (firstTenantId === undefined || input.values?.length === 0) return [];
    const { where, params } = tenantSetAttributeFilter(input);
    const modelFilter = input.model
      ? `WHERE if(length(TraceModels) = 0, 'unknown', arrayElement(TraceModels, 1)) = {model:String}`
      : "";
    const result = await this.#clickhouse.query<TraceRow>({
      tenantId: firstTenantId,
      tenantIds: input.tenantIds,
      table: "trace_summaries",
      settings: SPEND_ROLLUP_SETTINGS,
      sql: `
        SELECT
          TraceId,
          Value,
          toString(TraceCost) AS CostUsd,
          TraceModels AS Models,
          toUnixTimestamp64Milli(LatestOccurredAt) AS OccurredAtMs,
          PromptTokens,
          CompletionTokens,
          DurationMs,
          HasError,
          Blocked
        FROM (
          SELECT
            TraceId,
            argMax(Attributes[{attributeKey:String}], UpdatedAt) AS Value,
            argMax(coalesce(TotalCost, 0), UpdatedAt) AS TraceCost,
            argMax(Models, UpdatedAt) AS TraceModels,
            argMax(OccurredAt, UpdatedAt) AS LatestOccurredAt,
            argMax(coalesce(TotalPromptTokenCount, 0), UpdatedAt) AS PromptTokens,
            argMax(coalesce(TotalCompletionTokenCount, 0), UpdatedAt) AS CompletionTokens,
            argMax(TotalDurationMs, UpdatedAt) AS DurationMs,
            argMax(ContainsErrorStatus, UpdatedAt) AS HasError,
            argMax(BlockedByGuardrail, UpdatedAt) AS Blocked
          FROM trace_summaries
          ${where}
          GROUP BY TenantId, TraceId
        )
        ${modelFilter}
        ORDER BY OccurredAtMs DESC
        LIMIT {limit:UInt32}
      `,
      params: {
        ...params,
        ...(input.model ? { model: input.model } : {}),
        limit: Math.max(1, Math.floor(input.limit)),
      },
    });
    return result.rows.map((row) => ({
      traceId: row.TraceId,
      value: row.Value,
      costUsd: row.CostUsd,
      models: row.Models ?? [],
      occurredAtMs: Number(row.OccurredAtMs),
      promptTokens: Number(row.PromptTokens) || 0,
      completionTokens: Number(row.CompletionTokens) || 0,
      durationMs: Number(row.DurationMs) || 0,
      hasError: Boolean(Number(row.HasError)),
      blockedByGuardrail: Boolean(Number(row.Blocked)),
    }));
  }
}
