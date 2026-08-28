// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClient } from "@clickhouse/client";

import { createLogger } from "@langwatch/observability";
import { GOVERNANCE_COST_ROLLUP_TABLE } from "../projections/governanceCostRollup.constants";
import type { GovernanceCostRollupCell } from "../projections/governanceCostRollup.foldProjection";

const logger = createLogger("langwatch:governance:cost-rollup:repository");

/** One row of `governance_cost_rollup_1d`, exactly as the table holds it. */
export interface GovernanceCostRollupRow {
  TenantId: string;
  /** `YYYY-MM-DD`, the provider's business day in UTC. */
  Day: string;
  CostSource: string;
  IngestionSourceId: string;
  Provider: string;
  Model: string;
  AgentId: string;
  CurrencyCode: string;
  RawActorId: string;
  OrganizationId: string;
  ExactOrEstimate: string;
  AmountNanoUsd: number | null;
  AmountNanoMinor: number;
  TokensInput: number;
  TokensOutput: number;
  TokensCacheRead: number;
  TokensCacheWrite: number;
  RequestCount: number;
  RevisionCount: number;
  PreviousAmountNanoUsd: number | null;
  PulledItemsJson: string;
  Version: string;
  AppliedEventIds: string[];
  CreatedAt: number;
  LastEventOccurredAt: number;
  EventTimestamp: number;
}

/** The columns that make a row's identity, in sort-key order. */
const KEY_COLUMNS = [
  "TenantId",
  "Day",
  "CostSource",
  "IngestionSourceId",
  "Provider",
  "Model",
  "AgentId",
  "CurrencyCode",
  "RawActorId",
] as const;

/**
 * The predicate addressing exactly one cell. Every dimension is bound, so the
 * read is a point lookup along the sort key rather than a scan, and TenantId
 * comes first because nothing else here is unique across tenants.
 */
const CELL_PREDICATE = KEY_COLUMNS.map(
  (column) => `${column} = {${column.toLowerCase()}:String}`,
).join("\n          AND ");

function cellParams(cell: GovernanceCostRollupCell): Record<string, unknown> {
  return {
    tenantid: cell.tenantId,
    day: cell.day,
    costsource: cell.costSource,
    ingestionsourceid: cell.ingestionSourceId,
    provider: cell.provider,
    model: cell.model,
    agentid: cell.agentId,
    currencycode: cell.currencyCode,
    rawactorid: cell.rawActorId,
  };
}

/** ClickHouse renders Int64/UInt64 as strings in JSONEachRow. */
function int(value: unknown): number {
  return Number(value ?? 0);
}

/** …and a Nullable(Int64) as a string or null. Null must survive as null. */
function nullableInt(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Read and write side of `governance_cost_rollup_1d`.
 *
 * Every read here is REPLACEMENT-AWARE, and that is the whole point of the
 * class. The fold writes one ReplacingMergeTree version per fold cycle, so
 * between a restatement and the background merge that collapses it both
 * versions are in the table and a plain `sum(AmountNanoUsd)` returns their
 * TOTAL — the old figure plus the new one — which is not a number anybody
 * spent. The dedup runs in an inner `GROUP BY` over the sort key that picks
 * `argMax(..., EventTimestamp)`, and the outer query sums only the survivors
 * (ADR-015). Every column named in that inner query is a small integer, so the
 * heavy-column hazard the IN-tuple form exists for does not arise here.
 */
export class GovernanceCostRollupClickHouseRepository {
  constructor(
    private readonly resolveClient: (
      tenantId: string,
    ) => Promise<ClickHouseClient>,
  ) {}

  /**
   * Appends one version of a cell. The fold's monotonic `updatedAt` rides in
   * as `EventTimestamp`, which is the ReplacingMergeTree's version parameter,
   * so the newest write is the one every read resolves to.
   */
  async upsert(row: GovernanceCostRollupRow): Promise<void> {
    const client = await this.resolveClient(row.TenantId);
    try {
      await client.insert({
        table: GOVERNANCE_COST_ROLLUP_TABLE,
        values: [row],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        {
          error,
          tenantId: row.TenantId,
          day: row.Day,
          cost_source: row.CostSource,
        },
        "Failed to insert governance_cost_rollup_1d row",
      );
      throw error;
    }
  }

  /**
   * The one cell's latest committed version, with the applied-event-id
   * watermark that rides next to it.
   *
   * `argMax` over the whole row rather than `ORDER BY EventTimestamp DESC
   * LIMIT 1`: the sort is the anti-pattern that reads every unmerged version
   * before it can pick one.
   */
  async findCellWithApplied(
    cell: GovernanceCostRollupCell,
  ): Promise<GovernanceCostRollupRow | null> {
    const client = await this.resolveClient(cell.tenantId);
    const result = await client.query({
      query: `
        SELECT
          ${KEY_COLUMNS.join(",\n          ")},
          argMax(OrganizationId, EventTimestamp)        AS OrganizationId,
          argMax(ExactOrEstimate, EventTimestamp)       AS ExactOrEstimate,
          argMax(AmountNanoUsd, EventTimestamp)         AS AmountNanoUsd,
          argMax(AmountNanoMinor, EventTimestamp)       AS AmountNanoMinor,
          argMax(TokensInput, EventTimestamp)           AS TokensInput,
          argMax(TokensOutput, EventTimestamp)          AS TokensOutput,
          argMax(TokensCacheRead, EventTimestamp)       AS TokensCacheRead,
          argMax(TokensCacheWrite, EventTimestamp)      AS TokensCacheWrite,
          argMax(RequestCount, EventTimestamp)          AS RequestCount,
          argMax(RevisionCount, EventTimestamp)         AS RevisionCount,
          argMax(PreviousAmountNanoUsd, EventTimestamp) AS PreviousAmountNanoUsd,
          argMax(PulledItemsJson, EventTimestamp)       AS PulledItemsJson,
          argMax(Version, EventTimestamp)               AS Version,
          argMax(AppliedEventIds, EventTimestamp)       AS AppliedEventIds,
          argMax(CreatedAt, EventTimestamp)             AS CreatedAt,
          argMax(LastEventOccurredAt, EventTimestamp)   AS LastEventOccurredAt,
          -- Aliased away from the column name: an alias shadowing the
          -- EventTimestamp column is resolved inside every argMax above it,
          -- which ClickHouse rejects as an aggregate within an aggregate.
          max(EventTimestamp)                           AS LatestEventTimestamp
        FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
        WHERE ${CELL_PREDICATE}
        GROUP BY ${KEY_COLUMNS.join(", ")}
      `,
      query_params: cellParams(cell),
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    const row = rows[0];
    return row ? this.decode(row) : null;
  }

  /**
   * Every cell of one day, deduped. This is the read a screen and the
   * comparator share, so neither can be right while the other is wrong.
   */
  async findCellsForDay(input: {
    tenantId: string;
    day: string;
    costSource?: string;
  }): Promise<GovernanceCostRollupRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          ${KEY_COLUMNS.join(",\n          ")},
          argMax(OrganizationId, EventTimestamp)        AS OrganizationId,
          argMax(ExactOrEstimate, EventTimestamp)       AS ExactOrEstimate,
          argMax(AmountNanoUsd, EventTimestamp)         AS AmountNanoUsd,
          argMax(AmountNanoMinor, EventTimestamp)       AS AmountNanoMinor,
          argMax(TokensInput, EventTimestamp)           AS TokensInput,
          argMax(TokensOutput, EventTimestamp)          AS TokensOutput,
          argMax(TokensCacheRead, EventTimestamp)       AS TokensCacheRead,
          argMax(TokensCacheWrite, EventTimestamp)      AS TokensCacheWrite,
          argMax(RequestCount, EventTimestamp)          AS RequestCount,
          argMax(RevisionCount, EventTimestamp)         AS RevisionCount,
          argMax(PreviousAmountNanoUsd, EventTimestamp) AS PreviousAmountNanoUsd,
          argMax(PulledItemsJson, EventTimestamp)       AS PulledItemsJson,
          argMax(Version, EventTimestamp)               AS Version,
          argMax(AppliedEventIds, EventTimestamp)       AS AppliedEventIds,
          argMax(CreatedAt, EventTimestamp)             AS CreatedAt,
          argMax(LastEventOccurredAt, EventTimestamp)   AS LastEventOccurredAt,
          -- Aliased away from the column name: an alias shadowing the
          -- EventTimestamp column is resolved inside every argMax above it,
          -- which ClickHouse rejects as an aggregate within an aggregate.
          max(EventTimestamp)                           AS LatestEventTimestamp
        FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
        WHERE TenantId = {tenantid:String}
          AND Day = {day:String}
          ${input.costSource ? "AND CostSource = {costsource:String}" : ""}
        GROUP BY ${KEY_COLUMNS.join(", ")}
        ORDER BY CostSource, Provider, Model, RawActorId, CurrencyCode
      `,
      query_params: {
        tenantid: input.tenantId,
        day: input.day,
        ...(input.costSource ? { costsource: input.costSource } : {}),
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows.map((row) => this.decode(row));
  }

  /**
   * The day's total, deduped. Cells whose amount is NULL contribute nothing
   * and are counted separately, so a caller can tell "nothing was spent" from
   * "we hold no figure for some of this".
   */
  async sumDay(input: {
    tenantId: string;
    day: string;
    costSource?: string;
  }): Promise<{ amountNanoUsd: number | null; cellsWithoutAmount: number }> {
    const cells = await this.findCellsForDay(input);
    const priced = cells.filter((cell) => cell.AmountNanoUsd !== null);
    return {
      amountNanoUsd: priced.length
        ? priced.reduce((sum, cell) => sum + (cell.AmountNanoUsd ?? 0), 0)
        : null,
      cellsWithoutAmount: cells.length - priced.length,
    };
  }

  /**
   * The newest business time any cell of a lane has summarized, for the lag
   * gauge. Null when the lane has summarized nothing yet.
   */
  async findLatestSummarizedOccurredAt(input: {
    tenantId: string;
    costSource: string;
  }): Promise<number | null> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT max(LastEventOccurredAt) AS LatestOccurredAt
        FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
        WHERE TenantId = {tenantid:String}
          AND CostSource = {costsource:String}
      `,
      query_params: {
        tenantid: input.tenantId,
        costsource: input.costSource,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ LatestOccurredAt: unknown }>;
    const latest = int(rows[0]?.LatestOccurredAt);
    return latest > 0 ? latest : null;
  }

  /**
   * The day's cost events straight off the log, for the comparator to
   * re-derive from.
   *
   * It lives on this repository rather than a separate one because the
   * comparator's whole job is holding these two reads against each other; a
   * summary read that could drift from the source read it is compared with
   * would make the watchdog itself the thing that lies.
   *
   * `event_log` is a ReplacingMergeTree too, so the same rule applies: the
   * inner `GROUP BY` over its sort key takes the newest version of each event
   * and nothing else. Without it a redelivered append would be counted twice
   * and the comparator would report drift against a rollup that is correct.
   */
  async findCostEventsForDay(input: {
    tenantId: string;
    day: string;
    eventTypes: readonly string[];
  }): Promise<
    Array<{
      id: string;
      type: string;
      tenantId: string;
      occurredAt: number;
      data: Record<string, unknown>;
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          -- Aliased away from the column names for the same reason the rollup
          -- read is: an alias shadowing a column the WHERE and the argMax
          -- order-by both name resolves to the aggregate, which ClickHouse
          -- refuses.
          argMax(EventId, EventTimestamp)         AS LatestEventId,
          argMax(EventType, EventTimestamp)       AS LatestEventType,
          argMax(EventPayload, EventTimestamp)    AS LatestEventPayload,
          argMax(EventOccurredAt, EventTimestamp) AS LatestEventOccurredAt
        FROM event_log
        WHERE TenantId = {tenantid:String}
          AND EventType IN {eventtypes:Array(String)}
          AND EventOccurredAt >= {fromms:UInt64}
          AND EventOccurredAt < {toms:UInt64}
        GROUP BY TenantId, AggregateType, AggregateId, IdempotencyKey
      `,
      query_params: {
        tenantid: input.tenantId,
        eventtypes: [...input.eventTypes],
        fromms: Date.parse(`${input.day}T00:00:00.000Z`),
        toms: Date.parse(`${input.day}T00:00:00.000Z`) + 86_400_000,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.LatestEventId ?? ""),
      type: String(row.LatestEventType ?? ""),
      tenantId: input.tenantId,
      occurredAt: int(row.LatestEventOccurredAt),
      data: JSON.parse(String(row.LatestEventPayload ?? "{}")) as Record<
        string,
        unknown
      >,
    }));
  }

  /** The newest business time any cost event of a lane carries. */
  async findLatestEventOccurredAt(input: {
    tenantId: string;
    eventTypes: readonly string[];
  }): Promise<number | null> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT max(EventOccurredAt) AS LatestOccurredAt
        FROM event_log
        WHERE TenantId = {tenantid:String}
          AND EventType IN {eventtypes:Array(String)}
      `,
      query_params: {
        tenantid: input.tenantId,
        eventtypes: [...input.eventTypes],
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ LatestOccurredAt: unknown }>;
    const latest = int(rows[0]?.LatestOccurredAt);
    return latest > 0 ? latest : null;
  }

  private decode(row: Record<string, unknown>): GovernanceCostRollupRow {
    return {
      TenantId: String(row.TenantId ?? ""),
      Day: String(row.Day ?? ""),
      CostSource: String(row.CostSource ?? ""),
      IngestionSourceId: String(row.IngestionSourceId ?? ""),
      Provider: String(row.Provider ?? ""),
      Model: String(row.Model ?? ""),
      AgentId: String(row.AgentId ?? ""),
      CurrencyCode: String(row.CurrencyCode ?? ""),
      RawActorId: String(row.RawActorId ?? ""),
      OrganizationId: String(row.OrganizationId ?? ""),
      ExactOrEstimate: String(row.ExactOrEstimate ?? ""),
      AmountNanoUsd: nullableInt(row.AmountNanoUsd),
      AmountNanoMinor: int(row.AmountNanoMinor),
      TokensInput: int(row.TokensInput),
      TokensOutput: int(row.TokensOutput),
      TokensCacheRead: int(row.TokensCacheRead),
      TokensCacheWrite: int(row.TokensCacheWrite),
      RequestCount: int(row.RequestCount),
      RevisionCount: int(row.RevisionCount),
      PreviousAmountNanoUsd: nullableInt(row.PreviousAmountNanoUsd),
      PulledItemsJson: String(row.PulledItemsJson ?? ""),
      Version: String(row.Version ?? ""),
      AppliedEventIds: Array.isArray(row.AppliedEventIds)
        ? (row.AppliedEventIds as string[])
        : [],
      CreatedAt: int(row.CreatedAt),
      LastEventOccurredAt: int(row.LastEventOccurredAt),
      EventTimestamp: int(row.LatestEventTimestamp),
    };
  }
}
