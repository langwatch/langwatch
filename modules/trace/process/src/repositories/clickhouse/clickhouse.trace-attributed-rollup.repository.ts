import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type ConditionOps,
  fn,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type {
  TraceAttributedRecency,
  TraceAttributedSpendComparison,
  TraceAttributedSpendSort,
  TraceAttributedTraceDetail,
  TraceAttributedValueComparison,
  TraceAttributedValueSpend,
  TraceAttributeMatch,
  TraceDailyGroupSpend,
  TraceDailySpendGroup,
  TraceModelSpendWindow,
  TraceProjectValueSpend,
} from "@langwatch/trace-contract";

import { TraceAttributedRollupRepository } from "../trace-attributed-rollup.repository.ts";
import { traceSummaries as summaries } from "./clickhouse.trace-summaries.table.ts";

/** A spend rollup's ceiling on threads and runtime (#8072 step 3, as on main). */
const SPEND_ROLLUP_SETTINGS = { max_threads: 2, max_execution_time: 45 };

type Ops = ConditionOps<typeof summaries.$table.name, unknown>;

/** `Attributes[key] = value` per match, each bound as a parameter. */
const matching = (matches: readonly TraceAttributeMatch[]) => (ops: Pick<Ops, "and" | "eq">) =>
  ops.and(
    ...matches.map((match) => ops.eq(fn.mapGet(summaries.Attributes, match.key), match.value)),
  );

/** One tenant's reads; a derived read and the read over it share one scope. */
const readsOf = ({ tenantId }: { tenantId: string }) => {
  const scope = tenantScope.single({ tenantId });
  return () => clickhouseRead({ scope });
};

const costOf = () => fn.ifNull(summaries.TotalCost, 0);

/** The row's `attribute<index>` value; the selection's keys are known only at run time. */
const attributeOf = ({ row, index }: { row: Record<string, unknown>; index: number }) => {
  const value = row[`attribute${index}`];
  return typeof value === "string" ? value : "";
};

/**
 * Main's governance activity-monitor reads, answered by trace over trace_summaries. Each read keeps
 * its `OccurredAt` window in its own `where`, so `latestVersion()` repeats it in the election.
 */
export class ClickHouseTraceAttributedRollupRepository extends TraceAttributedRollupRepository {
  readonly #clickhouse: Pick<ClickHouseQueryClient, "read">;

  private constructor(clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read">,
  ): ClickHouseTraceAttributedRollupRepository {
    return new ClickHouseTraceAttributedRollupRepository(clickhouse);
  }

  async getAttributedSpendComparison(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    actorKey: string;
    previousStartMs: number;
    currentStartMs: number;
    endMs: number;
  }): Promise<TraceAttributedSpendComparison> {
    const actor = fn.mapGet(summaries.Attributes, input.actorKey);
    const statement = readsOf(input)()
      .from(summaries)
      .select(({ and, gte, lt, ne }) => ({
        thisSpend: fn.sumIf(costOf(), gte(summaries.OccurredAt, input.currentStartMs)),
        prevSpend: fn.sumIf(costOf(), lt(summaries.OccurredAt, input.currentStartMs)),
        thisUsers: fn.uniqExactIf(
          actor,
          and(gte(summaries.OccurredAt, input.currentStartMs), ne(actor, "")),
        ),
      }))
      .where(({ range }) =>
        range(summaries.OccurredAt, { from: input.previousStartMs, until: input.endMs }),
      )
      .where(matching(input.matches))
      .latestVersion()
      .settings(SPEND_ROLLUP_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    const row = result.rows[0];
    return {
      currentSpendUsd: Number(row?.thisSpend ?? 0),
      previousSpendUsd: Number(row?.prevSpend ?? 0),
      currentActors: Number(row?.thisUsers ?? 0),
    };
  }

  async findAttributedSpendByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    window: TraceModelSpendWindow;
    sortBy: TraceAttributedSpendSort;
    sortDirection: "asc" | "desc";
    limit: number;
    offset: number;
  }): Promise<TraceAttributedValueSpend[]> {
    const read = readsOf(input);
    const value = fn.mapGet(summaries.Attributes, input.valueKey);
    const traces = read()
      .from(summaries)
      .select({
        actor: value,
        spendUsd: costOf(),
        occurredAt: summaries.OccurredAt,
        model: fn.arrayElement(summaries.Models, 1),
      })
      .where(({ range }) =>
        range(summaries.OccurredAt, { from: input.window.startMs, until: input.window.endMs }),
      )
      .where((ops) => ops.and(matching(input.matches)(ops), ops.ne(value, "")))
      .latestVersion()
      .as("traces");
    // Sort keys to the aggregate they order by; the outer string sum stays out of the order.
    const order = {
      spend: fn.sum(traces.spendUsd),
      requests: fn.count(),
      lastActivity: fn.max(traces.occurredAt),
    }[input.sortBy];
    const statement = read()
      .from(traces)
      .select({
        actor: traces.actor,
        spendUsdStr: fn.toString(fn.sum(traces.spendUsd)),
        requests: fn.toString(fn.count()),
        lastActivityMs: fn.toString(fn.toUnixTimestamp64Milli(fn.max(traces.occurredAt))),
        mostUsedTarget: fn.any(traces.model),
      })
      .groupBy(traces.actor)
      .orderBy(order, input.sortDirection === "asc" ? "ASC" : "DESC")
      .limit(input.limit)
      .offset(Math.max(0, input.offset))
      .settings(SPEND_ROLLUP_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    return result.rows.map((row) => ({
      value: row.actor,
      spentUsd: row.spendUsdStr,
      requests: Number(row.requests),
      lastOccurredAtMs: Number(row.lastActivityMs),
      firstModel: row.mostUsedTarget ?? "",
    }));
  }

  async findAttributedSpendComparisonByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    previousStartMs: number;
    currentStartMs: number;
    endMs: number;
  }): Promise<TraceAttributedValueComparison[]> {
    const read = readsOf(input);
    const value = fn.mapGet(summaries.Attributes, input.valueKey);
    const traces = read()
      .from(summaries)
      .select({ sourceId: value, spendUsd: costOf(), occurredAt: summaries.OccurredAt })
      .where(({ range }) =>
        range(summaries.OccurredAt, { from: input.previousStartMs, until: input.endMs }),
      )
      .where((ops) => ops.and(matching(input.matches)(ops), ops.ne(value, "")))
      .latestVersion()
      .as("traces");
    const statement = read()
      .from(traces)
      .select(({ gte, lt }) => {
        const current = gte(traces.occurredAt, input.currentStartMs);
        return {
          sourceId: traces.sourceId,
          thisSpendStr: fn.toString(fn.sumIf(traces.spendUsd, current)),
          prevSpendStr: fn.toString(
            fn.sumIf(traces.spendUsd, lt(traces.occurredAt, input.currentStartMs)),
          ),
          thisRequests: fn.toString(fn.countIf(current)),
          lastActivityMs: fn.toString(
            fn.toUnixTimestamp64Milli(fn.maxIf(traces.occurredAt, current)),
          ),
        };
      })
      .groupBy(traces.sourceId)
      .settings(SPEND_ROLLUP_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    return result.rows.map((row) => ({
      value: row.sourceId,
      currentSpendUsd: row.thisSpendStr,
      previousSpendUsd: row.prevSpendStr,
      currentRequests: Number(row.thisRequests),
      lastCurrentOccurredAtMs: Number(row.lastActivityMs),
    }));
  }

  async findSpendByProjectAndValue(input: {
    tenantIds: readonly string[];
    valueKey: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceProjectValueSpend[]> {
    if (input.tenantIds.length === 0) return [];
    // A declared tenant set (ARCHITECTURE.md "Routing is folded into the `clickhouse` member").
    const scope = tenantScope.set({ tenantIds: input.tenantIds });
    const actor = fn.mapGet(summaries.Attributes, input.valueKey);
    const statement = clickhouseRead({ scope })
      .from(summaries)
      .select({
        projectId: summaries.TenantId,
        actor,
        spendUsdStr: fn.toString(fn.sum(costOf())),
        requests: fn.toString(fn.count()),
        lastActivityMs: fn.toString(fn.toUnixTimestamp64Milli(fn.max(summaries.OccurredAt))),
      })
      .where(({ range }) =>
        range(summaries.OccurredAt, { from: input.window.startMs, until: input.window.endMs }),
      )
      .latestVersion()
      .groupBy(summaries.TenantId, actor)
      .settings(SPEND_ROLLUP_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    return result.rows.map((row) => ({
      projectId: row.projectId,
      value: row.actor,
      spentUsd: row.spendUsdStr,
      requests: Number(row.requests),
      lastOccurredAtMs: Number(row.lastActivityMs),
    }));
  }

  async findDailyAttributedSpend(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    groupBy: TraceDailySpendGroup;
    window: TraceModelSpendWindow;
  }): Promise<TraceDailyGroupSpend[]> {
    const group =
      input.groupBy.kind === "attribute"
        ? fn.mapGet(summaries.Attributes, input.groupBy.key)
        : fn.arrayElement(summaries.Models, 1);
    // toStartOfDay gives a DateTime, which toUnixTimestamp64Milli refuses: seconds times 1000.
    const bucket = fn.multiply(fn.toUnixTimestamp(fn.toStartOfDay(summaries.OccurredAt)), 1000);
    const statement = readsOf(input)()
      .from(summaries)
      .select({
        bucketMs: fn.toString(bucket),
        groupKey: group,
        spendUsdStr: fn.toString(fn.sum(costOf())),
      })
      .where(({ range }) =>
        range(summaries.OccurredAt, { from: input.window.startMs, until: input.window.endMs }),
      )
      .where(matching(input.matches))
      .latestVersion()
      .groupBy(bucket, group)
      .orderBy(bucket, "ASC")
      .settings(SPEND_ROLLUP_SETTINGS)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    return result.rows.map((row) => ({
      dayStartMs: Number(row.bucketMs),
      value: row.groupKey,
      spentUsd: row.spendUsdStr,
    }));
  }

  async countAttributedTracesByValue(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    valueKey: string;
    values: readonly string[];
    sinceMs: number;
  }): Promise<{ value: string; count: number }[]> {
    if (input.values.length === 0) return [];
    const value = fn.mapGet(summaries.Attributes, input.valueKey);
    const statement = readsOf(input)()
      .from(summaries)
      .select({ sourceId: value, c: fn.toString(fn.count()) })
      .where(({ range }) => range(summaries.OccurredAt, { from: input.sinceMs }))
      .where((ops) => ops.and(matching(input.matches)(ops), ops.oneOf(value, [...input.values])))
      .latestVersion()
      .groupBy(value)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    return result.rows.map((row) => ({ value: row.sourceId, count: Number(row.c) }));
  }

  async findAttributedTracesBefore(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    attributeKeys: readonly string[];
    beforeMs: number;
    limit: number;
  }): Promise<TraceAttributedTraceDetail[]> {
    const attributes = Object.fromEntries(
      input.attributeKeys.map((key, index) => [
        `attribute${index}`,
        fn.mapGet(summaries.Attributes, key),
      ]),
    );
    const statement = readsOf(input)()
      .from(summaries)
      .select({
        ...attributes,
        eventId: summaries.TraceId,
        target: fn.arrayElement(summaries.Models, 1),
        costUsd: costOf(),
        tokensInput: fn.ifNull(summaries.TotalPromptTokenCount, 0),
        tokensOutput: fn.ifNull(summaries.TotalCompletionTokenCount, 0),
        occurredMs: fn.toString(fn.toUnixTimestamp64Milli(summaries.OccurredAt)),
        createdMs: fn.toString(fn.toUnixTimestamp64Milli(summaries.CreatedAt)),
      })
      .where(({ range }) => range(summaries.OccurredAt, { until: input.beforeMs }))
      .where(matching(input.matches))
      .latestVersion()
      .orderBy(summaries.OccurredAt, "DESC")
      .orderBy(summaries.TraceId, "DESC")
      .limit(input.limit)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    return result.rows.map((row) => ({
      traceId: row.eventId,
      attributes: Object.fromEntries(
        input.attributeKeys.map((key, index) => [key, attributeOf({ row, index })]),
      ),
      firstModel: row.target ?? "",
      costUsd: Number(row.costUsd ?? 0),
      promptTokens: Number(row.tokensInput ?? 0),
      completionTokens: Number(row.tokensOutput ?? 0),
      occurredAtMs: Number(row.occurredMs),
      createdAtMs: Number(row.createdMs),
    }));
  }

  async getAttributedTraceRecency(input: {
    tenantId: string;
    matches: readonly TraceAttributeMatch[];
    countSinceMs: readonly number[];
  }): Promise<TraceAttributedRecency> {
    if (input.countSinceMs.length === 0) return { counts: [], lastOccurredAtMs: 0 };
    const statement = readsOf(input)()
      .from(summaries)
      .select(({ gte, scalar }) => ({
        ...Object.fromEntries(
          input.countSinceMs.map((sinceMs, index) => [
            `c${index}`,
            fn.toString(fn.countIf(gte(summaries.OccurredAt, sinceMs))),
          ]),
        ),
        // The last match over every version, as main read it: a scalar subquery.
        lastMs: scalar((sub) =>
          sub
            .from(summaries)
            .select({ v: fn.toString(fn.toUnixTimestamp64Milli(fn.max(summaries.OccurredAt))) })
            .where(matching(input.matches)),
        ),
      }))
      .where(({ range }) => range(summaries.OccurredAt, { from: Math.min(...input.countSinceMs) }))
      .where(matching(input.matches))
      .latestVersion()
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    const row: Record<string, unknown> | undefined = result.rows[0];
    const lastMs = row?.lastMs;
    return {
      counts: input.countSinceMs.map((_, index) => Number(row?.[`c${index}`] ?? 0)),
      lastOccurredAtMs: lastMs ? Number(lastMs) : 0,
    };
  }
}
