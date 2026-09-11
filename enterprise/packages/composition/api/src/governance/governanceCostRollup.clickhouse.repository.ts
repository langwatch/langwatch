// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClient } from "@clickhouse/client";

import { createLogger } from "@langwatch/observability";
import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_ROLLUP_RESTATEMENT_INDEX_TABLE,
  GOVERNANCE_COST_ROLLUP_TABLE,
  GOVERNANCE_COST_SOURCE,
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
  /** Unix SECONDS. The epoch on any row written before migration 00093. */
  LastObservedAt: number;
  PulledItemsJson: string;
  Version: string;
  AppliedEventIds: string[];
  CreatedAt: number;
  LastEventOccurredAt: number;
  EventTimestamp: number;
}

/**
 * One row of `governance_cost_rollup_restatement_index`: which cell a
 * restatement key sits in.
 */
export interface GovernanceCostRollupRestatementIndexRow {
  TenantId: string;
  RestatementKey: string;
  Day: string;
  CostSource: string;
  IngestionSourceId: string;
  Provider: string;
  Model: string;
  AgentId: string;
  CurrencyCode: string;
  RawActorId: string;
  EventTimestamp: number;
}

/**
 * The columns that make a row's identity, in sort-key order. Exported so a
 * test can hold it against the table's own `ORDER BY` in migration 00092 and
 * against the fold's key field order — three copies of one contract that
 * nothing else forces to agree.
 */
export const KEY_COLUMNS = [
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

/**
 * Whether a cell holds no amount in ANY currency — the one rule every read
 * that counts unpriced cells applies, kept in one place because the screen
 * puts two of those counts next to each other and a reader adding the bars up
 * would find them short of a total that was never withheld.
 *
 * A bill stated in euros is money we have; what it is not is money in dollars.
 * The older rule counted every cell without a DOLLAR figure, so a single
 * foreign invoice withheld the dollar total of the whole day.
 *
 * The currency test is load-bearing rather than defensive. For a cell billed
 * in dollars the minor unit IS the dollar figure, so when a provider withdraws
 * the amount the column keeps holding a number that stands for nothing;
 * reading it back would resurrect precisely the figure that was taken back.
 * Only a cell billed in some other currency carries an amount there that the
 * dollar column never held, so only that cell can be rescued from the count by
 * it. A cell that names no currency at all is in the same position as a dollar
 * one: there is no other unit for its money to be in.
 *
 * Expects `LatestAmountNanoUsd`, `LatestAmountNanoMinor` and `CurrencyCode`
 * in scope, plus the `usd` query parameter.
 *
 * Applied by every read whose row can SAY it is short a currency —
 * `sumDaysByLane`, `sumWindowByCurrency`, `sumDaysByProvider`,
 * `sumPeriodRecordsByProvider` and `sumWindowByProvider`, each of which carries
 * a per-currency line or a `CurrenciesWithoutUsdAmount` list beside the
 * dollar figure. `sumWindowBySpender` deliberately keeps the stricter
 * USD-only rule instead: its row has no currency channel at all, so narrowing
 * the count there would turn a figure correctly WITHHELD into one silently
 * short of the euro spend behind it, with nothing on the row to say so.
 * Withholding is the safe direction when there is nowhere to state the
 * caveat; give that row a currency line and it should move here.
 */
const HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL = `
            LatestAmountNanoUsd IS NULL
            AND (
              CurrencyCode = {usd:String}
              OR CurrencyCode = ''
              OR LatestAmountNanoMinor = 0
            )`;

/**
 * The restatement keys one cell holds, read back out of its item map.
 *
 * Defensive about the parse even though the row was just projected from state:
 * the cell itself is already written by the time this is asked, and refusing
 * to index it is a far smaller fault than throwing away a write that landed.
 */
function restatementKeysOf(pulledItemsJson: string): string[] {
  if (!pulledItemsJson) return [];
  try {
    const parsed: unknown = JSON.parse(pulledItemsJson);
    return parsed && typeof parsed === "object" ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
}

/** An Array(String) column, defensive about a shape the driver did not give. */
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

/**
 * The `byCurrency` tuples of one (day, lane) row, as the driver hands them
 * back: an array of positional arrays, integers rendered as strings.
 *
 * Positional because that is what `groupArray(tuple(...))` produces, so the
 * order here is the order in the SELECT and the two must be read together.
 * Defensive about the shape for the same reason `strArray` is — a driver that
 * hands back something else should cost the screen a currency line, not the
 * whole read.
 */
function currencyLines(value: unknown): Array<{
  currencyCode: string;
  amountNanoMinor: number;
  previousAmountNanoMinor: number | null;
  cellsWithoutAmount: number;
  cellsWithoutPreviousAmount: number;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((line) => {
    if (!Array.isArray(line)) return [];
    const [code, amount, previous, withoutAmount, withoutPrevious] =
      line as unknown[];
    return [
      {
        currencyCode: str(code),
        amountNanoMinor: int(amount),
        previousAmountNanoMinor: nullableInt(previous),
        cellsWithoutAmount: int(withoutAmount),
        cellsWithoutPreviousAmount: int(withoutPrevious),
      },
    ];
  });
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
    await this.recordRestatementKeys({ client, row });
  }

  /**
   * Files every restatement key this cell holds under the cell it landed in,
   * for the keys not already on record.
   *
   * WHERE A KEY FIRST LANDED, not where it sits now, and that is the contract
   * rather than an accident of the implementation. The reissue this index
   * exists to catch is recognised by the key turning up somewhere OTHER than
   * the cell recorded here, so a record that followed the key to each new cell
   * would agree with every reissue and catch none of them.
   *
   * The consequence is stated rather than hidden: a charge reissued a SECOND
   * time is compared against its original cell, which the first correction
   * already retracted, so the second-to-last version is left live. This batch
   * ships the single key move; the repair primitive for a day already recorded
   * wrong is the retraction event itself, and driving one by hand is the next
   * item rather than part of this.
   *
   * Written after the cell rather than before it: an index row naming a cell
   * that failed to write would send the next correction at a cell holding
   * nothing.
   */
  private async recordRestatementKeys({
    client,
    row,
  }: {
    client: ClickHouseClient;
    row: GovernanceCostRollupRow;
  }): Promise<void> {
    const keys = restatementKeysOf(row.PulledItemsJson);
    // The gateway lane has none, so its write costs nothing extra at all.
    if (keys.length === 0) return;

    const recorded = await this.findRecordedRestatementKeys({
      client,
      tenantId: row.TenantId,
      keys,
    });
    const unrecorded = keys.filter((key) => !recorded.has(key));
    if (unrecorded.length === 0) return;

    const values: GovernanceCostRollupRestatementIndexRow[] = unrecorded.map(
      (key) => ({
        TenantId: row.TenantId,
        RestatementKey: key,
        Day: row.Day,
        CostSource: row.CostSource,
        IngestionSourceId: row.IngestionSourceId,
        Provider: row.Provider,
        Model: row.Model,
        AgentId: row.AgentId,
        CurrencyCode: row.CurrencyCode,
        RawActorId: row.RawActorId,
        EventTimestamp: row.EventTimestamp,
      }),
    );

    try {
      await client.insert({
        table: GOVERNANCE_COST_ROLLUP_RESTATEMENT_INDEX_TABLE,
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        { error, tenantId: row.TenantId, day: row.Day },
        "Failed to insert governance_cost_rollup_restatement_index rows",
      );
      // Rethrown, where `restatementKeysOf` swallows its own failure, and the
      // difference is which failures are worth another attempt. An
      // unparseable item map is unparseable every time, so retrying costs a
      // fold and recovers nothing. A failed insert is the ordinary transient
      // one, and both writes here are idempotent — the cell is a
      // ReplacingMergeTree row at the same version, the index write skips
      // keys already filed — so a retry costs one extra fold and gets the key
      // recorded. Swallowing it would drop the row permanently and silently,
      // and a key missing from the index is a reissue nothing can recognise.
      throw error;
    }
  }

  /** Which of these keys this tenant has already filed somewhere. */
  private async findRecordedRestatementKeys({
    client,
    tenantId,
    keys,
  }: {
    client: ClickHouseClient;
    tenantId: string;
    keys: string[];
  }): Promise<Set<string>> {
    const result = await client.query({
      query: `
        SELECT DISTINCT RestatementKey
        FROM ${GOVERNANCE_COST_ROLLUP_RESTATEMENT_INDEX_TABLE}
        WHERE TenantId = {tenantid:String}
          AND RestatementKey IN {keys:Array(String)}
      `,
      query_params: { tenantid: tenantId, keys },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ RestatementKey?: unknown }>;
    return new Set(rows.map((r) => str(r.RestatementKey)));
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
   * a lane's day is a `GROUP BY` over two of its columns. So the innermost
   * query collapses each cell to its surviving version and the layers above it
   * sum only those survivors. A single-pass `sum(AmountNanoUsd)` here would add
   * a restated figure to the figure it restates, which is the exact defect the
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
   * ## What counts as a cell we hold no amount for
   *
   * A cell holding no amount in ANY currency, and nothing else. A cell the
   * provider priced in euros holds a perfectly good amount — what it does not
   * hold is a DOLLAR amount, and the per-currency lines are where that amount
   * is shown. Counting it as unpriced withheld the dollar figure of every day
   * that touched a foreign bill, which is the whole defect
   * `specs/governance/governance-cost-rollup.feature` now names.
   *
   * `AmountNanoMinor` is a non-nullable `Int64`, so "billed zero in euros" and
   * "nothing stored" are written identically and a stated zero in a foreign
   * currency reads as unpriced. That is a limit of the column rather than a
   * choice here; a retraction, which is the case that actually matters, states
   * its zero in `AmountNanoUsd` and stays priced.
   *
   * The distinct currencies of the cells holding no USD figure ride along
   * because `CurrencyCode` is already a key column: the screen can then say
   * WHICH currency it could not state a total in, rather than only that it
   * could not. That list is deliberately WIDER than the unpriced count — a
   * priced euro cell names its currency there while counting as priced, which
   * is how a stated dollar figure can still say what it leaves out.
   *
   * ## The §15 markers
   *
   * `RevisedAt` is the LATEST revision anywhere in the day, because the marker
   * says the day changed and one changed cell changed it. `LastObservedAt` is
   * the NEWEST touch anywhere in the day, because a pull that reached any cell
   * of the day looked at that day.
   *
   * The prior total is pinned to that same latest revision — it is what the
   * day added up to in the moment BEFORE it, not before every revision the day
   * has ever seen. Summing every revised cell's prior regardless of date
   * reports a move that spans revisions weeks apart under the latest one's
   * date, and §15 is explicit that the marker holds only the latest revision.
   * That needs a layer of its own: the day's latest revision is a window over
   * the deduped cells, and it has to be known before the sum that uses it.
   *
   * ## Three buckets, not two
   *
   * Each cell contributes to the prior total as it stood IMMEDIATELY BEFORE
   * that revision, and there are three ways for that to go:
   *
   * - revised AT that moment — contributes what it held before;
   * - CREATED at or after that moment — contributes zero, because it did not
   *   exist yet;
   * - otherwise untouched — contributes what it holds now, because by then it
   *   already did.
   *
   * The created bucket cannot be recognised from the revision markers. A cell
   * a reissue created carries NO revision timestamp and NO earlier amount,
   * because nothing has ever restated it — it IS the restatement. Asked "were
   * you revised?" it answers no and lands in the untouched bucket, where it
   * adds its new amount on top of the retracted cell's prior one and the day
   * claims to have previously held about twice what it did. The one column
   * that separates it from a cell that was simply never revised is WHEN IT
   * CAME INTO EXISTENCE, so that is what the bucket is decided on.
   *
   * `min(CreatedAt)` rather than the surviving row's own value: the engine
   * keeps the row with the newest event timestamp, so a later write that
   * restamped the creation instant would quietly move a cell out of the
   * created bucket. The earliest instant any version of the cell claims is the
   * one that answers "when did this key first exist", whatever the writer
   * does.
   *
   * `CellsWithoutPreviousAmount` counts the cells whose CONTRIBUTION to that
   * prior total cannot be stated in dollars — a max-revised cell whose earlier
   * figure was unpriced, or an untouched cell holding no amount at all. Above
   * zero the caller withholds the whole "was", the same way it withholds a
   * partial total. A created cell is NOT among them: it provably held nothing,
   * which is a statement rather than a gap.
   *
   * ## Per currency, always
   *
   * A reissue from one currency to another is precisely a day holding two of
   * them, so there is no single prior figure for such a day: it reads as
   * having held dollars and now holding euros, never as having held their sum.
   * `byCurrency` carries one line per currency the day was billed in, each
   * with what that currency holds now and what it held before the revision,
   * in the currency's own minor unit.
   *
   * A currency the revision CREATED names no earlier amount at all — null
   * rather than zero, because "this currency was not on this day yesterday" is
   * not the same statement as "it held nothing". A revised cell in a currency
   * other than USD also names none: only `PreviousAmountNanoUsd` is stored, so
   * its earlier figure in its own unit was never recorded, and it is counted
   * rather than guessed.
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
      /** Cells holding no amount in any currency at all. */
      cellsWithoutAmount: number;
      /**
       * Currency codes of the cells holding no USD figure, excluding USD
       * itself — a USD cell without a USD figure names no currency the screen
       * could report, so it is counted and not named. WIDER than
       * `cellsWithoutAmount`: a cell priced in euros is named here and is not
       * counted there.
       */
      currenciesWithoutUsdAmount: string[];
      /**
       * Unix SECONDS of the day's most recent revision, or null when no cell
       * of it has ever been restated.
       */
      revisedAt: number | null;
      /**
       * What the day totalled in the moment before `revisedAt`, nano-USD —
       * not before every revision it has ever had. See the method doc.
       */
      previousAmountNanoUsd: number | null;
      /**
       * Cells whose contribution to that prior total cannot be stated in
       * dollars. Above zero, withhold the "was".
       */
      cellsWithoutPreviousAmount: number;
      /** Unix SECONDS a pull last touched any cell of the day. */
      lastObservedAt: number;
      /**
       * One line per currency the day was billed in, in that currency's own
       * minor unit. `previousAmountNanoMinor` is null when the currency names
       * no earlier amount — either it did not exist on this day before the
       * revision, or its earlier figure was never stored in its own unit.
       */
      byCurrency: Array<{
        currencyCode: string;
        amountNanoMinor: number;
        previousAmountNanoMinor: number | null;
        cellsWithoutAmount: number;
        cellsWithoutPreviousAmount: number;
      }>;
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Day                                   AS Day,
          CostSource                            AS CostSource,
          sumOrNull(CurrencyAmountNanoUsd)      AS AmountNanoUsd,
          sum(CurrencyCellsWithoutAmount)       AS CellsWithoutAmount,
          arraySort(
            groupUniqArrayIf(${UNPRICED_CURRENCY_SAMPLE_LIMIT})(
              CurrencyCode,
              CurrencyCellsWithoutUsdFigure > 0 AND CurrencyCode != {usd:String}
            )
          ) AS CurrenciesWithoutUsdAmount,
          max(RevisedAt)                        AS RevisedAt,
          sumOrNull(CurrencyPriorAmountNanoUsd) AS PreviousAmountNanoUsd,
          sum(CellsWithoutPreviousAmount)       AS CellsWithoutPreviousAmount,
          max(LastObservedAt)                   AS LastObservedAt,
          groupArray(
            tuple(
              CurrencyCode,
              CurrencyAmountNanoMinor,
              CurrencyPriorAmountNanoMinor,
              CurrencyCellsWithoutAmount,
              CurrencyCellsWithoutPreviousMinor
            )
          ) AS ByCurrency
        FROM (
          -- Fourth layer: one line per currency the day was billed in. The day
          -- totals above are folded up from these rather than computed twice,
          -- so a line and the headline over it can never disagree.
          SELECT
            Day,
            CostSource,
            CurrencyCode,
            sumOrNull(LatestAmountNanoUsd)        AS CurrencyAmountNanoUsd,
            sum(LatestAmountNanoMinor)            AS CurrencyAmountNanoMinor,
            countIf(HoldsNoAmountAtAll)           AS CurrencyCellsWithoutAmount,
            countIf(LatestAmountNanoUsd IS NULL)  AS CurrencyCellsWithoutUsdFigure,
            max(LatestRevisedAt)                  AS RevisedAt,
            sumOrNull(PriorAmountNanoUsd)         AS CurrencyPriorAmountNanoUsd,
            countIf(PriorAmountNanoUsd IS NULL) AS CellsWithoutPreviousAmount,
            sumOrNull(PriorAmountNanoMinor)       AS CurrencyPriorAmountNanoMinor,
            countIf(PriorAmountNanoMinor IS NULL AND NOT CreatedByRevision)
              AS CurrencyCellsWithoutPreviousMinor,
            max(LatestLastObservedAt)             AS LastObservedAt
          FROM (
            -- Third layer: which bucket each cell falls in, and so what it
            -- contributed to the day as it stood before the latest revision.
            --
            -- A cell revised EARLIER than that moment was already carrying its
            -- current figure by then, so swapping in its prior would rewind a
            -- change that had finished happening and inflate the reported
            -- move. Two cells restated a fortnight apart is the case that
            -- exposes it: the day would be labelled with the later date and a
            -- delta spanning both.
            --
            -- The ifNull is load-bearing: a never-revised cell compares NULL
            -- against the day's max, and a NULL condition is not a branch
            -- anyone should have to reason about. Those cells belong in the
            -- current-amount arm, not out of the sum.
            SELECT
              Day,
              CostSource,
              CurrencyCode,
              LatestAmountNanoUsd,
              LatestAmountNanoMinor,
              LatestRevisedAt,
              LatestLastObservedAt,
              (${HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL}
              ) AS HoldsNoAmountAtAll,
              -- Only a creation stamp that lands inside the day it belongs to
              -- is a business instant this comparison can read. \`CreatedAt\` is
              -- written by the fold at wall-clock time, so for a cell built
              -- from real events it is the moment the row was WRITTEN — days
              -- or months after the business day, and therefore later than
              -- every revision of it. Comparing that against the revision
              -- would put every cell ever folded in the created bucket and
              -- report each restated day as having previously held nothing.
              -- Outside the day the stamp says nothing about business order,
              -- so the cell falls through to the untouched arm.
              (CellCreatedAt >= toUnixTimestamp(Day) * 1000)
                AND (CellCreatedAt < (toUnixTimestamp(Day) + 86400) * 1000)
                AND ifNull(CellCreatedAt >= DayLatestRevisedAt * 1000, 0)
                AS CreatedByRevision,
              if(
                CreatedByRevision,
                -- It did not exist before the revision, so it held nothing.
                -- Stated, not unknown: it is excluded from the withheld count
                -- below precisely because we can say what it was.
                toNullable(toInt64(0)),
                if(
                  ifNull(LatestRevisedAt = DayLatestRevisedAt, 0),
                  LatestPreviousAmountNanoUsd,
                  -- Untouched. A cell holding real money in another currency
                  -- contributed a known zero DOLLARS; only a cell holding no
                  -- amount at all leaves the prior total unstateable.
                  if(
                    HoldsNoAmountAtAll,
                    CAST(NULL AS Nullable(Int64)),
                    ifNull(LatestAmountNanoUsd, toInt64(0))
                  )
                )
              ) AS PriorAmountNanoUsd,
              if(
                CreatedByRevision,
                -- Null, not zero: a currency that was not on this day before
                -- the revision names no earlier amount rather than naming an
                -- amount of nothing.
                CAST(NULL AS Nullable(Int64)),
                if(
                  ifNull(LatestRevisedAt = DayLatestRevisedAt, 0),
                  -- Only the USD prior is stored, so a revised cell in any
                  -- other currency has no earlier figure in its own unit.
                  if(
                    CurrencyCode = {usd:String},
                    LatestPreviousAmountNanoUsd,
                    CAST(NULL AS Nullable(Int64))
                  ),
                  toNullable(LatestAmountNanoMinor)
                )
              ) AS PriorAmountNanoMinor
            FROM (
              -- Second layer: the day's latest revision, carried beside every
              -- cell of that day so the bucket above can compare against it.
              SELECT
                *,
                max(LatestRevisedAt) OVER (PARTITION BY Day, CostSource)
                  AS DayLatestRevisedAt
              FROM (
                -- First layer: each cell collapsed to its surviving version.
                SELECT
                  ${KEY_COLUMNS.join(",\n                  ")},
                  argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd,
                  argMax(AmountNanoMinor, EventTimestamp) AS LatestAmountNanoMinor,
                  argMax(tuple(PreviousAmountNanoUsd), EventTimestamp).1 AS LatestPreviousAmountNanoUsd,
                  argMax(tuple(toUnixTimestamp(RevisedAt)), EventTimestamp).1 AS LatestRevisedAt,
                  toUnixTimestamp(argMax(LastObservedAt, EventTimestamp)) AS LatestLastObservedAt,
                  -- EARLIEST, not the surviving row's own value: a later write
                  -- that restamped this would move the cell out of the created
                  -- bucket and quietly rot the rule.
                  min(CreatedAt) AS CellCreatedAt
                FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
                WHERE TenantId = {tenantid:String}
                  AND Day >= {fromday:Date}
                  AND Day <= {today:Date}
                  AND Version = {version:String}
                GROUP BY ${KEY_COLUMNS.join(", ")}
              )
            )
          )
          GROUP BY Day, CostSource, CurrencyCode
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
      byCurrency: currencyLines(row.ByCurrency),
    }));
  }

  /**
   * One window total per currency the lane was BILLED in, from the figure the
   * provider actually stated.
   *
   * `AmountNanoMinor` has been on every row since the table was created and no
   * aggregate read has ever asked for it: every total the screen showed was
   * the USD column, so a subscription invoiced in euros read as money we hold
   * no amount for. It is money we hold an exact amount for, in a currency
   * nobody converted, and this is the read that says so.
   *
   * NO RATE IS APPLIED and no two currencies are ever added (ADR-128 §3).
   * Cells naming no currency come back as the `""` row, which is the separate
   * count of spend we can price in nothing at all.
   *
   * Same two-pass dedup as every other aggregate here, for the same reason.
   */
  async sumWindowByCurrency(input: {
    tenantId: string;
    /** Inclusive, `YYYY-MM-DD`. */
    fromDay: string;
    /** Inclusive, `YYYY-MM-DD`. */
    toDay: string;
    /** Which lane. The lanes are never totalled together. */
    costSource: string;
  }): Promise<
    Array<{
      currencyCode: string;
      /** Nano of this currency's own major unit. Null when it holds nothing. */
      amountNanoMinor: number | null;
      /** Cells of this currency holding no amount in any currency at all. */
      cellsWithoutAmount: number;
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          CurrencyCode                     AS CurrencyCode,
          sumOrNull(LatestAmountNanoMinor) AS AmountNanoMinor,
          countIf(${HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL}
          ) AS CellsWithoutAmount
        FROM (
          SELECT
            ${KEY_COLUMNS.join(",\n            ")},
            argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd,
            argMax(AmountNanoMinor, EventTimestamp) AS LatestAmountNanoMinor
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantid:String}
            AND Day >= {fromday:Date}
            AND Day <= {today:Date}
            AND CostSource = {costsource:String}
            AND Version = {version:String}
          GROUP BY ${KEY_COLUMNS.join(", ")}
        )
        GROUP BY CurrencyCode
        ORDER BY CurrencyCode
      `,
      query_params: {
        tenantid: input.tenantId,
        fromday: input.fromDay,
        today: input.toDay,
        costsource: input.costSource,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
        usd: GOVERNANCE_COST_CURRENCY_USD,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      currencyCode: str(row.CurrencyCode),
      amountNanoMinor: nullableInt(row.AmountNanoMinor),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
    }));
  }

  /**
   * The pulled lane's total per (day, provider) over the window.
   *
   * The one question the screen could never answer: it could say what a
   * provider cost over a quarter, and what the organization spent on a given
   * day, and had no way to say which provider caused a day that stood out.
   * Grouping on both is the whole read.
   *
   * PULLED ONLY, by predicate, for the same reason `sumWindowByProvider` is:
   * the gateway lane writes a different provider vocabulary into this table
   * and an unfiltered read would both mislabel those rows and sum two lanes.
   */
  async sumDaysByProvider(input: {
    tenantId: string;
    /** Inclusive, `YYYY-MM-DD`. */
    fromDay: string;
    /** Inclusive, `YYYY-MM-DD`. */
    toDay: string;
  }): Promise<
    Array<{
      day: string;
      provider: string;
      amountNanoUsd: number | null;
      cellsWithoutAmount: number;
      currenciesWithoutUsdAmount: string[];
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Day                            AS Day,
          Provider                       AS Provider,
          sumOrNull(LatestAmountNanoUsd) AS AmountNanoUsd,
          countIf(${HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL}
          ) AS CellsWithoutAmount,
          -- Which currency the figure beside it leaves out. A cell billed in
          -- euros with no dollar conversion holds an amount, so it is NOT
          -- counted above and never will be — the count answers "how much did
          -- we fail to price at all", and this answers the other question a
          -- short figure raises. Same expression as \`sumWindowByProvider\`: the
          -- headline and the bars under it must name the same currencies.
          arraySort(groupUniqArrayIf(${UNPRICED_CURRENCY_SAMPLE_LIMIT})(
            CurrencyCode,
            LatestAmountNanoUsd IS NULL AND CurrencyCode != {usd:String}
          )) AS CurrenciesWithoutUsdAmount
        FROM (
          SELECT
            ${KEY_COLUMNS.join(",\n            ")},
            argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd,
            argMax(AmountNanoMinor, EventTimestamp) AS LatestAmountNanoMinor
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantid:String}
            AND Day >= {fromday:Date}
            AND Day <= {today:Date}
            AND CostSource = {costsource:String}
            AND Version = {version:String}
          GROUP BY ${KEY_COLUMNS.join(", ")}
        )
        GROUP BY Day, Provider
        ORDER BY Day, Provider
      `,
      query_params: {
        tenantid: input.tenantId,
        fromday: input.fromDay,
        today: input.toDay,
        costsource: GOVERNANCE_COST_SOURCE.PULLED,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
        usd: GOVERNANCE_COST_CURRENCY_USD,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      day: str(row.Day),
      provider: str(row.Provider),
      amountNanoUsd: nullableInt(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
      currenciesWithoutUsdAmount: strArray(row.CurrenciesWithoutUsdAmount),
    }));
  }

  /**
   * The records behind ONE PERIOD at ONE provider: what each was for, and what
   * it cost.
   *
   * A cell is the record here. The dimensions that make a cell — the model and
   * the agent the provider named — are exactly "what it was for", so the read
   * is the same dedup pass grouped one level finer than the figure it explains
   * and the parts always add up to the whole a reader clicked.
   *
   * THE PERIOD IS A RANGE, not a day, because the screen above it has no day
   * to offer: its Time Interval chip carries month, quarter and year and
   * nothing narrower, so the figure a reader clicks always covers many days.
   * Reading a single day here would answer a question the screen never asked
   * and would disagree with the bar it sits under. The range is inclusive at
   * both ends, matching `sumDaysByProvider` directly above.
   */
  async sumPeriodRecordsByProvider(input: {
    tenantId: string;
    /** `YYYY-MM-DD`, the period's first day, included. */
    fromDay: string;
    /** `YYYY-MM-DD`, the period's last day, included. */
    toDay: string;
    provider: string;
  }): Promise<
    Array<{
      model: string;
      agentId: string;
      amountNanoUsd: number | null;
      cellsWithoutAmount: number;
      currenciesWithoutUsdAmount: string[];
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Model                          AS Model,
          AgentId                        AS AgentId,
          sumOrNull(LatestAmountNanoUsd) AS AmountNanoUsd,
          countIf(${HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL}
          ) AS CellsWithoutAmount,
          -- The same mark as the bar above this list carries. A reader who
          -- opens a period to find out why its figure looked short must not
          -- lose the answer by going one level deeper.
          arraySort(groupUniqArrayIf(${UNPRICED_CURRENCY_SAMPLE_LIMIT})(
            CurrencyCode,
            LatestAmountNanoUsd IS NULL AND CurrencyCode != {usd:String}
          )) AS CurrenciesWithoutUsdAmount
        FROM (
          SELECT
            ${KEY_COLUMNS.join(",\n            ")},
            argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd,
            argMax(AmountNanoMinor, EventTimestamp) AS LatestAmountNanoMinor
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantid:String}
            AND Day >= {fromday:Date}
            AND Day <= {today:Date}
            AND Provider = {provider:String}
            AND CostSource = {costsource:String}
            AND Version = {version:String}
          GROUP BY ${KEY_COLUMNS.join(", ")}
        )
        GROUP BY Model, AgentId
        ORDER BY Model, AgentId
      `,
      query_params: {
        tenantid: input.tenantId,
        fromday: input.fromDay,
        today: input.toDay,
        provider: input.provider,
        costsource: GOVERNANCE_COST_SOURCE.PULLED,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
        usd: GOVERNANCE_COST_CURRENCY_USD,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      model: str(row.Model),
      agentId: str(row.AgentId),
      amountNanoUsd: nullableInt(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
      currenciesWithoutUsdAmount: strArray(row.CurrenciesWithoutUsdAmount),
    }));
  }

  /**
   * The pulled lane's window total per (provider, spender, agent) — who the
   * provider said spent the money, over the whole window at once.
   *
   * PULLED ONLY, by predicate and not by caller convention. The gateway lane
   * writes its own actor ids into this table under a different provider
   * vocabulary (`model_provider_id`, not the source type discovery keys on),
   * so an unfiltered read would both mislabel those rows and sum the two
   * lanes — the cross-lane sum the whole screen exists to refuse.
   *
   * The spender is (Provider, RawActorId), never the id alone: that pair is
   * the discovered person's unique key, and one id string at two providers is
   * two people. AgentId completes the group because it is a key column and
   * one spender spends through several agents; the caller shows the pairing.
   *
   * Same two-pass shape as `sumDaysByLane` and for the same reason: the inner
   * query collapses each cell to its surviving version (current `Version`
   * stamp, `argMax` on the replacement timestamp, amount tupled so a cell
   * restated to unpriced is not totalled at its old price), and the outer one
   * sums only survivors. `sumOrNull` because a group of wholly unpriced cells
   * holds nothing, and 0 would be a claim.
   */
  async sumWindowBySpender(input: {
    tenantId: string;
    /** Inclusive, `YYYY-MM-DD`. */
    fromDay: string;
    /** Inclusive, `YYYY-MM-DD`. */
    toDay: string;
  }): Promise<
    Array<{
      provider: string;
      /** Empty when the provider named nobody for the row's day. */
      rawActorId: string;
      /** Empty when the provider named no agent. */
      agentId: string;
      amountNanoUsd: number | null;
      /** Cells of this group holding no USD figure. Above zero, withhold. */
      cellsWithoutAmount: number;
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Provider                             AS Provider,
          RawActorId                           AS RawActorId,
          AgentId                              AS AgentId,
          sumOrNull(LatestAmountNanoUsd)       AS AmountNanoUsd,
          countIf(LatestAmountNanoUsd IS NULL) AS CellsWithoutAmount
        FROM (
          SELECT
            ${KEY_COLUMNS.join(",\n            ")},
            argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantid:String}
            AND Day >= {fromday:Date}
            AND Day <= {today:Date}
            AND CostSource = {costsource:String}
            AND Version = {version:String}
          GROUP BY ${KEY_COLUMNS.join(", ")}
        )
        GROUP BY Provider, RawActorId, AgentId
        ORDER BY Provider, RawActorId, AgentId
      `,
      query_params: {
        tenantid: input.tenantId,
        fromday: input.fromDay,
        today: input.toDay,
        costsource: GOVERNANCE_COST_SOURCE.PULLED,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      provider: str(row.Provider),
      rawActorId: str(row.RawActorId),
      agentId: str(row.AgentId),
      amountNanoUsd: nullableInt(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
    }));
  }

  /** Current pulled costs by provider, including cells without a named actor.
   * Collapse replacements before summing so retries and corrections do not
   * double the bill. Tuple-wrapping preserves corrections to a null amount.
   */
  async sumWindowByProvider(input: {
    tenantId: string;
    /** Inclusive, YYYY-MM-DD. */
    fromDay: string;
    /** Inclusive, YYYY-MM-DD. */
    toDay: string;
  }): Promise<
    Array<{
      provider: string;
      amountNanoUsd: number | null;
      cellsWithoutAmount: number;
      currenciesWithoutUsdAmount: string[];
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Provider,
          sumOrNull(LatestAmountNanoUsd) AS AmountNanoUsd,
          -- Unpriced means no amount in ANY currency, the same rule
          -- sumDaysByLane applies. The two reads count the same cells and
          -- must not disagree: the headline is built from this one and the
          -- bars from that one, and a reader adding the bars up would find
          -- them short of a total that was never withheld.
          countIf(${HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL}
          ) AS CellsWithoutAmount,
          arraySort(groupUniqArrayIf(${UNPRICED_CURRENCY_SAMPLE_LIMIT})(
            CurrencyCode,
            LatestAmountNanoUsd IS NULL AND CurrencyCode != {usd:String}
          )) AS CurrenciesWithoutUsdAmount
        FROM (
          SELECT
            ${KEY_COLUMNS.join(", ")},
            argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd,
            argMax(AmountNanoMinor, EventTimestamp) AS LatestAmountNanoMinor
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantid:String}
            AND Day >= {fromday:Date}
            AND Day <= {today:Date}
            AND CostSource = {costsource:String}
            AND Version = {version:String}
          GROUP BY ${KEY_COLUMNS.join(", ")}
        )
        GROUP BY Provider
        ORDER BY Provider
      `,
      query_params: {
        usd: GOVERNANCE_COST_CURRENCY_USD,
        tenantid: input.tenantId,
        fromday: input.fromDay,
        today: input.toDay,
        costsource: GOVERNANCE_COST_SOURCE.PULLED,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      provider: str(row.Provider),
      amountNanoUsd: nullableInt(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
      currenciesWithoutUsdAmount: strArray(row.CurrenciesWithoutUsdAmount),
    }));
  }

  /**
   * Current pulled costs by MODEL over the window.
   *
   * ADR-128 §1 files the model under wave 1 because every pulled provider
   * already fills it: the dimension arrives on the bill and needs no identity
   * work to become readable. It is the only one of wave 1's four "where"
   * dimensions actually populated today — the agent and actor columns are
   * still blank on every pulled cell — so this is the read that makes the
   * ranked model panel a measurement instead of a placeholder.
   *
   * Grouped on `Model` exactly as the provider reported it. A provider that
   * bills per token kind writes a line item ("<model>, input"); splitting that
   * here would invent a grouping the bill does not make.
   *
   * PULLED ONLY, by predicate, for the reason `sumWindowBySpender` gives: the
   * gateway lane writes a different provider vocabulary into the same table
   * and an unfiltered read would cross-sum two lanes the screen keeps apart.
   *
   * Same two-pass shape as its neighbours — the inner query collapses each
   * cell to its surviving version and the outer one sums only survivors, so
   * retries and corrections do not double the bill. `sumOrNull` because a
   * wholly unpriced group holds nothing, and 0 would be a claim.
   *
   * The STRICT unpriced rule (`LatestAmountNanoUsd IS NULL`), the one
   * `sumWindowBySpender` keeps rather than the looser
   * `HOLDS_NO_AMOUNT_IN_ANY_CURRENCY_SQL`: a model row is a name and a number
   * with no currency channel beside it, so narrowing the count would turn a
   * correctly withheld figure into one silently short of the non-USD spend
   * behind it, with nowhere on the row to say so.
   */
  async sumWindowByModel(input: {
    tenantId: string;
    /** Inclusive, `YYYY-MM-DD`. */
    fromDay: string;
    /** Inclusive, `YYYY-MM-DD`. */
    toDay: string;
  }): Promise<
    Array<{
      /** Empty when the provider's row named no model. */
      model: string;
      amountNanoUsd: number | null;
      /** Cells of this model holding no USD figure. Above zero, withhold. */
      cellsWithoutAmount: number;
    }>
  > {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Model                                AS Model,
          sumOrNull(LatestAmountNanoUsd)       AS AmountNanoUsd,
          countIf(LatestAmountNanoUsd IS NULL) AS CellsWithoutAmount
        FROM (
          SELECT
            ${KEY_COLUMNS.join(", ")},
            argMax(tuple(AmountNanoUsd), EventTimestamp).1 AS LatestAmountNanoUsd
          FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
          WHERE TenantId = {tenantid:String}
            AND Day >= {fromday:Date}
            AND Day <= {today:Date}
            AND CostSource = {costsource:String}
            AND Version = {version:String}
          GROUP BY ${KEY_COLUMNS.join(", ")}
        )
        GROUP BY Model
        ORDER BY Model
      `,
      query_params: {
        tenantid: input.tenantId,
        fromday: input.fromDay,
        today: input.toDay,
        costsource: GOVERNANCE_COST_SOURCE.PULLED,
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      model: str(row.Model),
      amountNanoUsd: nullableInt(row.AmountNanoUsd),
      cellsWithoutAmount: int(row.CellsWithoutAmount),
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
