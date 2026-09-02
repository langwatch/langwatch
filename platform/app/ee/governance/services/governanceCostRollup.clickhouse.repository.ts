// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClient } from "@clickhouse/client";

import { createLogger } from "@langwatch/observability";
import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_ROLLUP_TABLE,
} from "../projections/governanceCostRollup.constants";
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
  /**
   * Unix SECONDS, not milliseconds — both of these are `DateTime` columns.
   * Null until a provider restates the cell to a different figure.
   */
  RevisedAt: number | null;
  /** Unix SECONDS. The epoch on any row written before migration 00088. */
  LastObservedAt: number;
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

/**
 * Every payload column collapsed to the version that won, shared by the two
 * reads that return whole rows. One list rather than two identical ones: a
 * dedup rule fixed in one copy and missed in the other is a table that answers
 * differently depending on which method asked it.
 *
 * The two Nullable columns go through `tuple(...)` and come back out with
 * `.1`, and they are the only ones that need it. `argMax` SKIPS rows whose
 * first argument is NULL, so a cell restated from priced to unpriced would
 * otherwise read back at its OLD price — the winning version passed over for
 * being NULL, the superseded one returned in its place, and a figure the
 * provider withdrew put back on the screen. A tuple is never NULL, so no
 * version is ever skipped and the NULL the winner actually held survives.
 */
const LATEST_PAYLOAD_COLUMNS = [
  "argMax(OrganizationId, EventTimestamp) AS OrganizationId",
  "argMax(ExactOrEstimate, EventTimestamp) AS ExactOrEstimate",
  "argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS AmountNanoUsd",
  "argMax(AmountNanoMinor, EventTimestamp) AS AmountNanoMinor",
  "argMax(TokensInput, EventTimestamp) AS TokensInput",
  "argMax(TokensOutput, EventTimestamp) AS TokensOutput",
  "argMax(TokensCacheRead, EventTimestamp) AS TokensCacheRead",
  "argMax(TokensCacheWrite, EventTimestamp) AS TokensCacheWrite",
  "argMax(RequestCount, EventTimestamp) AS RequestCount",
  "argMax(RevisionCount, EventTimestamp) AS RevisionCount",
  "argMax(tuple(PreviousAmountNanoUsd), EventTimestamp).1 AS PreviousAmountNanoUsd",
  // The two DateTime markers come back as integer seconds rather than as
  // formatted timestamps: a `DateTime` renders in the SERVER's timezone with
  // no offset on it, so a client parsing that string reads the instant the
  // client's own timezone makes of it. An integer has no timezone to get
  // wrong. `RevisedAt` takes the same tuple form as the two Nullable money
  // columns above — whether argMax skips a NULL first argument has varied
  // between ClickHouse versions, and a cell restated back to unrevised must
  // read as unrevised on every one of them rather than resurrecting an older
  // version's revision date.
  "argMax(tuple(toUnixTimestamp(RevisedAt)), EventTimestamp).1 AS RevisedAt",
  "toUnixTimestamp(argMax(LastObservedAt, EventTimestamp)) AS LastObservedAt",
  "argMax(PulledItemsJson, EventTimestamp) AS PulledItemsJson",
  "argMax(Version, EventTimestamp) AS Version",
  "argMax(AppliedEventIds, EventTimestamp) AS AppliedEventIds",
  "argMax(CreatedAt, EventTimestamp) AS CreatedAt",
  "argMax(LastEventOccurredAt, EventTimestamp) AS LastEventOccurredAt",
  // Aliased away from the column name: an alias shadowing the EventTimestamp
  // column is resolved inside every argMax above it, which ClickHouse rejects
  // as an aggregate within an aggregate.
  "max(EventTimestamp) AS LatestEventTimestamp",
] as const;

/** ClickHouse renders Int64/UInt64 as strings in JSONEachRow. */
function int(value: unknown): number {
  return Number(value ?? 0);
}

/** …and a Nullable(Int64) as a string or null. Null must survive as null. */
function nullableInt(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** A missing string column reads as empty, never as the text "undefined". */
function str(value: unknown): string {
  return String(value ?? "");
}

/**
 * At most this many distinct currency codes are collected per (day, lane).
 *
 * The screen names them in a sentence, so a list long enough to need
 * truncation is already longer than anybody reads. The cap is what keeps the
 * aggregate's memory bounded no matter how many currencies a tenant's
 * providers bill in.
 */
const UNPRICED_CURRENCY_SAMPLE_LIMIT = 8;

/** An Array(String) column, defensive about a shape the driver did not give. */
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
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
          ${LATEST_PAYLOAD_COLUMNS.join(",\n          ")}
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
          ${LATEST_PAYLOAD_COLUMNS.join(",\n          ")}
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
   * Every (day, lane) total across a closed day range, deduped — the cost
   * screen's whole read in one query.
   *
   * The dedup CANNOT be done in the same pass as the aggregation: picking the
   * newest version of a cell is a `GROUP BY` over the sort key, and totalling
   * a lane's day is a `GROUP BY` over two of its columns. So the inner query
   * collapses each cell to its surviving version and the outer one sums only
   * those survivors. A single-pass `sum(AmountNanoUsd)` here would add a
   * restated figure to the figure it restates, which is the exact defect the
   * permanent counterexample test on this repository exists to catch.
   *
   * `sumOrNull` rather than `sum`: a lane whose every cell holds no USD figure
   * must come back NULL, because 0 is a claim that nothing was spent. Cells
   * without an amount are counted separately so a caller can say which.
   *
   * The inner `argMax` wraps the amount in a tuple for the reason spelled out
   * on `LATEST_PAYLOAD_COLUMNS`: without it a cell restated to unpriced is
   * totalled at the price it used to carry.
   *
   * The `Day` range prunes partitions (`PARTITION BY toYYYYMM(Day)`), and
   * TenantId leads the predicate because nothing else here is unique across
   * tenants.
   *
   * `Version` is filtered to the shape this build writes, which is the same
   * rule the store's read-back applies (`governanceCostRollup.store.ts`): a
   * row written by an older shape is not trusted. The filter sits INSIDE the
   * dedup so an older row can never win a cell, and a cell that has only older
   * rows drops out entirely rather than contributing a figure nothing on this
   * build can vouch for. Nothing ever removes such a row on its own — a row
   * under an older stamp is a different version of the same key, not a
   * replacement for it — so without this it would be summed forever.
   *
   * The distinct currencies of the cells holding no USD figure ride along
   * because `CurrencyCode` is already a key column in the inner `GROUP BY`:
   * the screen can then say WHICH currency it could not state a total in,
   * rather than only that it could not.
   *
   * The §15 markers ride along too, aggregated the only ways that are honest
   * for a whole day. `RevisedAt` is the LATEST revision anywhere in the day,
   * because the marker says the day changed and one changed cell changed it.
   * `LastObservedAt` is the NEWEST touch anywhere in the day, because a pull
   * that reached any cell of the day looked at that day. And the prior total
   * reconstructs what the day added up to before those revisions: each revised
   * cell contributes what it used to hold, each untouched cell contributes
   * what it still holds. Cells that cannot state a prior figure are counted
   * rather than skipped, so the caller can withhold a partial "was" the same
   * way it withholds a partial total.
   */
  async sumDaysByLane(input: {
    tenantId: string;
    /** Inclusive, `YYYY-MM-DD`. */
    fromDay: string;
    /** Inclusive, `YYYY-MM-DD`. */
    toDay: string;
  }): Promise<
    Array<{
      day: string;
      costSource: string;
      amountNanoUsd: number | null;
      cellsWithoutAmount: number;
      /**
       * Currency codes of the cells holding no USD figure, excluding USD
       * itself — a USD cell without a USD figure names no currency the screen
       * could report, so it is counted and not named.
       */
      currenciesWithoutUsdAmount: string[];
      /**
       * Unix SECONDS of the day's most recent revision, or null when no cell
       * of it has ever been restated.
       */
      revisedAt: number | null;
      /** What the day totalled before those revisions, nano-USD. */
      previousAmountNanoUsd: number | null;
      /** Cells that can state no prior figure. Above zero, withhold the "was". */
      cellsWithoutPreviousAmount: number;
      /** Unix SECONDS a pull last touched any cell of the day. */
      lastObservedAt: number;
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Day                              AS Day,
          CostSource                       AS CostSource,
          sumOrNull(LatestAmountNanoUsd)   AS AmountNanoUsd,
          countIf(LatestAmountNanoUsd IS NULL) AS CellsWithoutAmount,
          arraySort(
            groupUniqArrayIf(${UNPRICED_CURRENCY_SAMPLE_LIMIT})(
              CurrencyCode,
              LatestAmountNanoUsd IS NULL AND CurrencyCode != {usd:String}
            )
          ) AS CurrenciesWithoutUsdAmount,
          max(LatestRevisedAt)             AS RevisedAt,
          -- A cell nobody revised still contributed its figure to the older
          -- total, so it carries that figure over. Only the revised ones swap
          -- in what they used to hold.
          sumOrNull(LatestPriorAmountNanoUsd)  AS PreviousAmountNanoUsd,
          countIf(LatestPriorAmountNanoUsd IS NULL) AS CellsWithoutPreviousAmount,
          max(LatestLastObservedAt)        AS LastObservedAt
        FROM (
          SELECT
            ${KEY_COLUMNS.join(",\n            ")},
            argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd,
            argMax(tuple(toUnixTimestamp(RevisedAt)), EventTimestamp).1 AS LatestRevisedAt,
            toUnixTimestamp(argMax(LastObservedAt, EventTimestamp)) AS LatestLastObservedAt,
            if(
              argMax(tuple(RevisedAt), EventTimestamp).1 IS NULL,
              argMax(tuple(AmountNanoUsd), EventTimestamp).1,
              argMax(tuple(PreviousAmountNanoUsd), EventTimestamp).1
            ) AS LatestPriorAmountNanoUsd
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantid:String}
            AND Day >= {fromday:Date}
            AND Day <= {today:Date}
            AND Version = {version:String}
          GROUP BY ${KEY_COLUMNS.join(", ")}
        )
        GROUP BY Day, CostSource
        ORDER BY Day, CostSource
      `,
      query_params: {
        tenantid: input.tenantId,
        fromday: input.fromDay,
        today: input.toDay,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
        usd: GOVERNANCE_COST_CURRENCY_USD,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      day: String(row.Day ?? ""),
      costSource: String(row.CostSource ?? ""),
      amountNanoUsd: nullableInt(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
      currenciesWithoutUsdAmount: strArray(row.CurrenciesWithoutUsdAmount),
      revisedAt: nullableInt(row.RevisedAt),
      previousAmountNanoUsd: nullableInt(row.PreviousAmountNanoUsd),
      cellsWithoutPreviousAmount: int(row.CellsWithoutPreviousAmount),
      lastObservedAt: int(row.LastObservedAt),
    }));
  }

  /**
   * Whether ONE source put any cell at all into a lane over a day range —
   * priced or not.
   *
   * This exists for the Azure billing note: the pulled lane is fed by every
   * pulled provider, so "does the lane hold rows" answers a different question
   * from "did THIS source's bill produce rows", and the note is only honest
   * about the second. `IngestionSourceId` is a key column, so the read stays
   * on the sort key.
   *
   * Existence needs no dedup pass: versions of a cell only ever add rows for
   * a key that already exists, so any row under the current `Version` stamp
   * proves the cell does. The stamp filter is the same trust rule
   * `sumDaysByLane` applies — a row written by an older shape must not be the
   * only evidence the bill was read.
   */
  async hasRowsForSource(input: {
    tenantId: string;
    /** Inclusive, `YYYY-MM-DD`. */
    fromDay: string;
    /** Inclusive, `YYYY-MM-DD`. */
    toDay: string;
    costSource: string;
    ingestionSourceId: string;
  }): Promise<boolean> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT 1 AS RowExists
        FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
        WHERE TenantId = {tenantid:String}
          AND Day >= {fromday:Date}
          AND Day <= {today:Date}
          AND CostSource = {costsource:String}
          AND IngestionSourceId = {ingestionsourceid:String}
          AND Version = {version:String}
        LIMIT 1
      `,
      query_params: {
        tenantid: input.tenantId,
        fromday: input.fromDay,
        today: input.toDay,
        costsource: input.costSource,
        ingestionsourceid: input.ingestionSourceId,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as unknown[];
    return rows.length > 0;
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

  /**
   * One driver row into the typed row. Every field goes through one of the
   * four coercions above rather than coercing inline, so this stays a flat
   * mapping with no branching of its own — which is also what keeps its
   * complexity inside the lint budget as columns are added.
   */
  private decode(row: Record<string, unknown>): GovernanceCostRollupRow {
    return {
      TenantId: str(row.TenantId),
      Day: str(row.Day),
      CostSource: str(row.CostSource),
      IngestionSourceId: str(row.IngestionSourceId),
      Provider: str(row.Provider),
      Model: str(row.Model),
      AgentId: str(row.AgentId),
      CurrencyCode: str(row.CurrencyCode),
      RawActorId: str(row.RawActorId),
      OrganizationId: str(row.OrganizationId),
      ExactOrEstimate: str(row.ExactOrEstimate),
      AmountNanoUsd: nullableInt(row.AmountNanoUsd),
      AmountNanoMinor: int(row.AmountNanoMinor),
      TokensInput: int(row.TokensInput),
      TokensOutput: int(row.TokensOutput),
      TokensCacheRead: int(row.TokensCacheRead),
      TokensCacheWrite: int(row.TokensCacheWrite),
      RequestCount: int(row.RequestCount),
      RevisionCount: int(row.RevisionCount),
      PreviousAmountNanoUsd: nullableInt(row.PreviousAmountNanoUsd),
      RevisedAt: nullableInt(row.RevisedAt),
      LastObservedAt: int(row.LastObservedAt),
      PulledItemsJson: str(row.PulledItemsJson),
      Version: str(row.Version),
      AppliedEventIds: strArray(row.AppliedEventIds),
      CreatedAt: int(row.CreatedAt),
      LastEventOccurredAt: int(row.LastEventOccurredAt),
      EventTimestamp: int(row.LatestEventTimestamp),
    };
  }
}
