import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  fn,
  type TenantScope,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type {
  TraceAttributedTrace,
  TraceAttributeUsageBucket,
  TraceAttributeValueSpend,
  TraceModelSpendWindow,
} from "@langwatch/trace-contract";

import { TraceAttributeSpendRepository } from "../trace-attribute-spend.repository.ts";
import { traceSummaries as summaries } from "./clickhouse.trace-summaries.table.ts";

/**
 * Each trace's latest version in the window, one row per (tenant, trace): the window on the
 * `OccurredAt` partition key; `values` absent means any non-empty value.
 */
const latestTraces = (input: {
  scope: TenantScope;
  attributeKey: string;
  window: TraceModelSpendWindow;
  values?: string[];
}) =>
  clickhouseRead({ scope: input.scope })
    .from(summaries)
    .where(({ and, ne, oneOf, range }) => {
      const value = fn.mapGet(summaries.Attributes, input.attributeKey);
      return and(
        range(summaries.OccurredAt, { from: input.window.startMs, until: input.window.endMs }),
        input.values ? oneOf(value, input.values) : ne(value, ""),
      );
    })
    .groupBy(summaries.TenantId, summaries.TraceId);

/**
 * A spend rollup's ceiling on threads and runtime. The runtime cap stays under the client's 30 s
 * request deadline, so a slow read ends with ClickHouse's own timeout, not a dropped request.
 */
const SPEND_ROLLUP_SETTINGS = { max_threads: 2, max_execution_time: 28 };

/** Main's gateway `GatewayVirtualKeySpendRepository` reads; the usage reads span a tenant set. */
export class ClickHouseTraceAttributeSpendRepository extends TraceAttributeSpendRepository {
  readonly #clickhouse: Pick<ClickHouseQueryClient, "read">;

  private constructor(clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read">,
  ): ClickHouseTraceAttributeSpendRepository {
    return new ClickHouseTraceAttributeSpendRepository(clickhouse);
  }

  async findSpendByAttributeValue(input: {
    tenantId: string;
    attributeKey: string;
    values: string[];
    window: TraceModelSpendWindow;
  }): Promise<TraceAttributeValueSpend[]> {
    if (input.values.length === 0) return [];
    const scope = tenantScope.single({ tenantId: input.tenantId });
    const traces = latestTraces({ ...input, scope })
      .select({
        TraceId: summaries.TraceId,
        Value: fn.argMax(fn.mapGet(summaries.Attributes, input.attributeKey), summaries.UpdatedAt),
        TraceCost: fn.argMax(fn.ifNull(summaries.TotalCost, 0), summaries.UpdatedAt),
      })
      .as("traces");
    const statement = clickhouseRead({ scope })
      .from(traces)
      .select({
        Value: traces.Value,
        SpentUsd: fn.toString(fn.sum(traces.TraceCost)),
        Requests: fn.count(),
      })
      .groupBy(traces.Value)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
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
    if (input.tenantIds.length === 0 || input.values?.length === 0) return [];
    // A read across an organization's projects is one statement over a declared tenant set
    // (ARCHITECTURE.md "Routing is folded into the `clickhouse` member").
    const scope = tenantScope.set({ tenantIds: [...input.tenantIds] });
    const latestModels = fn.argMax(summaries.Models, summaries.UpdatedAt);
    const traces = latestTraces({ ...input, scope })
      .select({
        TraceId: summaries.TraceId,
        Value: fn.argMax(fn.mapGet(summaries.Attributes, input.attributeKey), summaries.UpdatedAt),
        TraceCost: fn.argMax(fn.ifNull(summaries.TotalCost, 0), summaries.UpdatedAt),
        // The winning version's first model, `unknown` when it named none.
        Model: fn.if(fn.notEmpty(latestModels), fn.arrayElement(latestModels, 1), "unknown"),
        Day: fn.formatDateTime(
          fn.argMax(summaries.OccurredAt, summaries.UpdatedAt),
          "%Y-%m-%d",
          "UTC",
        ),
        Blocked: fn.argMax(summaries.BlockedByGuardrail, summaries.UpdatedAt),
      })
      .as("traces");
    const statement = clickhouseRead({ scope })
      .from(traces)
      .select({
        Value: traces.Value,
        Model: traces.Model,
        Day: traces.Day,
        TotalUsd: fn.toString(fn.sum(traces.TraceCost)),
        Requests: fn.count(),
        BlockedRequests: fn.countIf(traces.Blocked),
      })
      .groupBy(traces.Value, traces.Model, traces.Day)
      .settings(SPEND_ROLLUP_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
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
    if (input.tenantIds.length === 0 || input.values?.length === 0) return [];
    const scope = tenantScope.set({ tenantIds: [...input.tenantIds] });
    const traces = latestTraces({ ...input, scope })
      .select({
        TraceId: summaries.TraceId,
        Value: fn.argMax(fn.mapGet(summaries.Attributes, input.attributeKey), summaries.UpdatedAt),
        TraceCost: fn.argMax(fn.ifNull(summaries.TotalCost, 0), summaries.UpdatedAt),
        TraceModels: fn.argMax(summaries.Models, summaries.UpdatedAt),
        LatestOccurredAt: fn.argMax(summaries.OccurredAt, summaries.UpdatedAt),
        PromptTokens: fn.argMax(fn.ifNull(summaries.TotalPromptTokenCount, 0), summaries.UpdatedAt),
        CompletionTokens: fn.argMax(
          fn.ifNull(summaries.TotalCompletionTokenCount, 0),
          summaries.UpdatedAt,
        ),
        DurationMs: fn.argMax(summaries.TotalDurationMs, summaries.UpdatedAt),
        HasError: fn.argMax(summaries.ContainsErrorStatus, summaries.UpdatedAt),
        Blocked: fn.argMax(summaries.BlockedByGuardrail, summaries.UpdatedAt),
      })
      .as("traces");
    const { model } = input;
    const read = clickhouseRead({ scope })
      .from(traces)
      .select({
        TraceId: traces.TraceId,
        Value: traces.Value,
        CostUsd: fn.toString(traces.TraceCost),
        Models: traces.TraceModels,
        OccurredAtMs: fn.toUnixTimestamp64Milli(traces.LatestOccurredAt),
        PromptTokens: traces.PromptTokens,
        CompletionTokens: traces.CompletionTokens,
        DurationMs: traces.DurationMs,
        HasError: traces.HasError,
        Blocked: traces.Blocked,
      });
    // The winning version's first model, `unknown` when it named none.
    const firstModel = fn.if(
      fn.notEmpty(traces.TraceModels),
      fn.arrayElement(traces.TraceModels, 1),
      "unknown",
    );
    const statement = (model ? read.where(({ eq }) => eq(firstModel, model)) : read)
      .orderBy("OccurredAtMs", "DESC")
      .limit(Math.max(1, Math.floor(input.limit)))
      .settings(SPEND_ROLLUP_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    return result.rows.map((row) => ({
      traceId: row.TraceId,
      value: row.Value,
      costUsd: row.CostUsd,
      models: [...(row.Models ?? [])],
      occurredAtMs: Number(row.OccurredAtMs),
      promptTokens: Number(row.PromptTokens) || 0,
      completionTokens: Number(row.CompletionTokens) || 0,
      durationMs: Number(row.DurationMs) || 0,
      hasError: Boolean(Number(row.HasError)),
      blockedByGuardrail: Boolean(Number(row.Blocked)),
    }));
  }
}
