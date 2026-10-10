import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type {
  TraceDailySpend,
  TraceModelRequests,
  TraceModelSpend,
  TraceModelSpendWindow,
  TraceSpendSummary,
} from "@langwatch/trace-contract";

import { TraceModelSpendRepository } from "../trace-model-spend.repository.ts";

type ModelSpendRow = {
  Model: string;
  SpentUsd: number | string;
  BilledUsd: number | string;
  Requests: number | string;
};

type SummaryRow = {
  TotalCost: number | string | null;
  BilledCost: number | string | null;
  RequestCount: number | string | null;
  PromptTokens: number | string | null;
  CompletionTokens: number | string | null;
};
type TopModelRow = { Model: string; Requests: number | string };
type DailySpendRow = {
  Day: string;
  SpentUsd: number | string;
  BilledUsd: number | string;
  Requests: number | string;
};

const SPEND_SETTINGS = { max_bytes_before_external_group_by: 500_000_000 };
const NON_BILLED_USD = `argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt)`;

/** Main's `PersonalUsageClickHouseRepository` trace reads, deduped by `argMax(..., UpdatedAt)`. */
export class ClickHouseTraceModelSpendRepository extends TraceModelSpendRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseTraceModelSpendRepository {
    return new ClickHouseTraceModelSpendRepository(clickhouse);
  }

  async findModelSpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelSpend[]> {
    const result = await this.#clickhouse.query<ModelSpendRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT
          Model,
          sum(TraceSpentUsd) AS SpentUsd,
          sum(coalesce(TraceSpentUsd, 0) - NonBilledUsd) AS BilledUsd,
          count() AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model,
            argMax(TotalCost, UpdatedAt) AS TraceSpentUsd,
            argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt) AS NonBilledUsd
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
            AND notEmpty(Models)
          GROUP BY TraceId
        )
        GROUP BY Model
        ORDER BY SpentUsd DESC
        LIMIT {lim:UInt32}
      `,
      params: {
        tenantId: input.tenantId,
        fromMs: input.window.startMs,
        toMs: input.window.endMs,
        lim: input.limit,
      },
      settings: SPEND_SETTINGS,
    });

    return result.rows.map((row) => ({
      label: row.Model,
      spentUsd: Number(row.SpentUsd) || 0,
      billedUsd: Number(row.BilledUsd) || 0,
      requests: Number(row.Requests) || 0,
    }));
  }

  async getSpendSummary(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceSpendSummary> {
    const result = await this.#clickhouse.query<SummaryRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT
          sum(SpentUsd) AS TotalCost,
          sum(coalesce(SpentUsd, 0) - NonBilledUsd) AS BilledCost,
          countDistinct(TraceId) AS RequestCount,
          sum(PromptTokens) AS PromptTokens,
          sum(CompletionTokens) AS CompletionTokens
        FROM (
          SELECT
            TraceId,
            argMax(TotalCost, UpdatedAt) AS SpentUsd,
            ${NON_BILLED_USD} AS NonBilledUsd,
            argMax(TotalPromptTokenCount, UpdatedAt) AS PromptTokens,
            argMax(TotalCompletionTokenCount, UpdatedAt) AS CompletionTokens
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY TraceId
        )
      `,
      params: { tenantId: input.tenantId, fromMs: input.window.startMs, toMs: input.window.endMs },
      settings: SPEND_SETTINGS,
    });

    const row = result.rows[0];
    return {
      totalCost: Number(row?.TotalCost) || 0,
      billedCost: Number(row?.BilledCost) || 0,
      requestCount: Number(row?.RequestCount) || 0,
      promptTokens: Number(row?.PromptTokens) || 0,
      completionTokens: Number(row?.CompletionTokens) || 0,
    };
  }

  async findTopModelsByRequests(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelRequests[]> {
    const result = await this.#clickhouse.query<TopModelRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT
          Model,
          count() AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
            AND notEmpty(Models)
          GROUP BY TraceId
        )
        GROUP BY Model
        ORDER BY Requests DESC
        LIMIT {limit:UInt32}
      `,
      params: {
        tenantId: input.tenantId,
        fromMs: input.window.startMs,
        toMs: input.window.endMs,
        limit: input.limit,
      },
      settings: SPEND_SETTINGS,
    });

    return result.rows.map((row) => ({ model: row.Model, requests: Number(row.Requests) || 0 }));
  }

  async findDailySpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceDailySpend[]> {
    const result = await this.#clickhouse.query<DailySpendRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT
          toDate(LatestOccurredAt) AS Day,
          sum(TraceSpentUsd) AS SpentUsd,
          sum(coalesce(TraceSpentUsd, 0) - NonBilledUsd) AS BilledUsd,
          count() AS Requests
        FROM (
          SELECT
            TraceId,
            argMax(OccurredAt, UpdatedAt) AS LatestOccurredAt,
            argMax(TotalCost, UpdatedAt) AS TraceSpentUsd,
            ${NON_BILLED_USD} AS NonBilledUsd
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY TraceId
        )
        GROUP BY Day
        ORDER BY Day
      `,
      params: { tenantId: input.tenantId, fromMs: input.window.startMs, toMs: input.window.endMs },
      settings: SPEND_SETTINGS,
    });

    return result.rows.map((row) => ({
      day: row.Day,
      spentUsd: Number(row.SpentUsd) || 0,
      billedUsd: Number(row.BilledUsd) || 0,
      requests: Number(row.Requests) || 0,
    }));
  }
}
