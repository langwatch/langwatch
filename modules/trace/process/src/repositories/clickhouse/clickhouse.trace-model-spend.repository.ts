import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type ConditionOps,
  fn,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type {
  TraceDailySpend,
  TraceModelRequests,
  TraceModelSpend,
  TraceModelSpendWindow,
  TraceSpendSummary,
} from "@langwatch/trace-contract";

import { TraceModelSpendRepository } from "../trace-model-spend.repository.ts";
import { traceSummaries as summaries } from "./clickhouse.trace-summaries.table.ts";

const SPEND_SETTINGS = { max_bytes_before_external_group_by: 500_000_000 };

type Eq = ConditionOps<typeof summaries.$table.name, unknown>["eq"];

/** A trace's latest non-billed spend: its own figure, else its cost when marked non-billable. */
const nonBilledUsd = (eq: Eq) =>
  fn.argMax(
    fn.ifNull(
      summaries.NonBilledCost,
      fn.ifNull(
        fn.if(
          eq(fn.mapGet(summaries.Attributes, "langwatch.cost.non_billable"), "true"),
          summaries.TotalCost,
          0,
        ),
        0,
      ),
    ),
    summaries.UpdatedAt,
  );

/** One tenant's reads: the per-trace fold and the read over it share one scope. */
const readsOf = ({ tenantId }: { tenantId: string }) => {
  const scope = tenantScope.single({ tenantId });
  return () => clickhouseRead({ scope });
};

const inWindow = (window: TraceModelSpendWindow) => (ops: { range: Range }) =>
  ops.range(summaries.OccurredAt, { from: window.startMs, until: window.endMs });

type Range = ConditionOps<typeof summaries.$table.name, unknown>["range"];

/** Main's `PersonalUsageClickHouseRepository` trace reads, deduped by `argMax(..., UpdatedAt)`. */
export class ClickHouseTraceModelSpendRepository extends TraceModelSpendRepository {
  readonly #clickhouse: Pick<ClickHouseQueryClient, "read">;

  private constructor(clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read">,
  ): ClickHouseTraceModelSpendRepository {
    return new ClickHouseTraceModelSpendRepository(clickhouse);
  }

  async findModelSpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelSpend[]> {
    const read = readsOf(input);
    const traces = read()
      .from(summaries)
      .select(({ eq }) => ({
        TraceId: summaries.TraceId,
        Model: fn.arrayJoin(fn.argMax(summaries.Models, summaries.UpdatedAt)),
        TraceSpentUsd: fn.argMax(summaries.TotalCost, summaries.UpdatedAt),
        NonBilledUsd: nonBilledUsd(eq),
      }))
      .where(({ and, range }) =>
        and(inWindow(input.window)({ range }), fn.notEmpty(summaries.Models)),
      )
      .groupBy(summaries.TraceId)
      .as("traces");
    const statement = read()
      .from(traces)
      .select({
        Model: traces.Model,
        SpentUsd: fn.sum(traces.TraceSpentUsd),
        BilledUsd: fn.sum(fn.minus(fn.ifNull(traces.TraceSpentUsd, 0), traces.NonBilledUsd)),
        Requests: fn.count(),
      })
      .groupBy(traces.Model)
      .orderBy("SpentUsd", "DESC")
      .limit(input.limit)
      .settings(SPEND_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

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
    const read = readsOf(input);
    const traces = read()
      .from(summaries)
      .select(({ eq }) => ({
        TraceId: summaries.TraceId,
        SpentUsd: fn.argMax(summaries.TotalCost, summaries.UpdatedAt),
        NonBilledUsd: nonBilledUsd(eq),
        PromptTokens: fn.argMax(summaries.TotalPromptTokenCount, summaries.UpdatedAt),
        CompletionTokens: fn.argMax(summaries.TotalCompletionTokenCount, summaries.UpdatedAt),
      }))
      .where(inWindow(input.window))
      .groupBy(summaries.TraceId)
      .as("traces");
    const statement = read()
      .from(traces)
      .select({
        TotalSpentUsd: fn.sum(traces.SpentUsd),
        BilledUsd: fn.sum(fn.minus(fn.ifNull(traces.SpentUsd, 0), traces.NonBilledUsd)),
        RequestCount: fn.countDistinct(traces.TraceId),
        PromptTokenSum: fn.sum(traces.PromptTokens),
        CompletionTokenSum: fn.sum(traces.CompletionTokens),
      })
      .settings(SPEND_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

    const row = result.rows[0];
    return {
      totalCost: Number(row?.TotalSpentUsd) || 0,
      billedCost: Number(row?.BilledUsd) || 0,
      requestCount: Number(row?.RequestCount) || 0,
      promptTokens: Number(row?.PromptTokenSum) || 0,
      completionTokens: Number(row?.CompletionTokenSum) || 0,
    };
  }

  async findTopModelsByRequests(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelRequests[]> {
    const read = readsOf(input);
    const traces = read()
      .from(summaries)
      .select({
        TraceId: summaries.TraceId,
        Model: fn.arrayJoin(fn.argMax(summaries.Models, summaries.UpdatedAt)),
      })
      .where(({ and, range }) =>
        and(inWindow(input.window)({ range }), fn.notEmpty(summaries.Models)),
      )
      .groupBy(summaries.TraceId)
      .as("traces");
    const statement = read()
      .from(traces)
      .select({ Model: traces.Model, Requests: fn.count() })
      .groupBy(traces.Model)
      .orderBy("Requests", "DESC")
      .limit(input.limit)
      .settings(SPEND_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

    return result.rows.map((row) => ({ model: row.Model, requests: Number(row.Requests) || 0 }));
  }

  async findDailySpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceDailySpend[]> {
    const read = readsOf(input);
    const traces = read()
      .from(summaries)
      .select(({ eq }) => ({
        TraceId: summaries.TraceId,
        LatestOccurredAt: fn.argMax(summaries.OccurredAt, summaries.UpdatedAt),
        TraceSpentUsd: fn.argMax(summaries.TotalCost, summaries.UpdatedAt),
        NonBilledUsd: nonBilledUsd(eq),
      }))
      .where(inWindow(input.window))
      .groupBy(summaries.TraceId)
      .as("traces");
    const day = fn.toDate(traces.LatestOccurredAt);
    const statement = read()
      .from(traces)
      .select({
        Day: day,
        SpentUsd: fn.sum(traces.TraceSpentUsd),
        BilledUsd: fn.sum(fn.minus(fn.ifNull(traces.TraceSpentUsd, 0), traces.NonBilledUsd)),
        Requests: fn.count(),
      })
      .groupBy(day)
      .orderBy("Day")
      .settings(SPEND_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

    return result.rows.map((row) => ({
      day: row.Day,
      spentUsd: Number(row.SpentUsd) || 0,
      billedUsd: Number(row.BilledUsd) || 0,
      requests: Number(row.Requests) || 0,
    }));
  }
}
