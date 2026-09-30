// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The metered lane's read side: the gateway's own per-request billing ledger,
 * `gateway_spend` (migration 00067).
 *
 * WHY THIS EXISTS RATHER THAN THE ROLLUP. The metered lane used to read the
 * same daily rollup the billed lane reads. A fold wrote the gateway's cells
 * there under the tenant of the project whose traffic it was, while the screen
 * read them under the hidden governance project's tenant — so for real traffic
 * the lane was always empty and only fixtures ever filled it. The fold is gone
 * rather than repaired: the lane reads the ledger directly, scoped to every
 * project tenant of the viewer's organization, and the rollup's leftover
 * gateway rows are read by nothing (`governanceCostRollup.clickhouse.repository`
 * filters every read to pulled).
 *
 * A REQUEST IS THE UNIT. `gateway_spend` keeps one aggregate per gateway
 * request, partitioned by the month it STARTED in. The same request can hold
 * rows in two monthly partitions — its outcome recorded before its admission,
 * the admission then moving the start time — so a sum that trusts the table to
 * have merged them counts the request twice. FINAL cannot fix it: FINAL dedups
 * a ReplacingMergeTree within a partition, and these two rows are in different
 * partitions. So every read collapses the ledger to one row per
 * `(TenantId, GatewayRequestId)` with `argMax(..., EventTimestamp)` first, and
 * aggregates only those survivors. The aliases are deliberately NOT the column
 * names they aggregate: ClickHouse resolves an alias back into the same
 * SELECT's WHERE, so `argMax(OccurredAt, EventTimestamp) AS OccurredAt` would
 * put an aggregate in the WHERE clause and the read would fail.
 *
 * THE WINDOW IS THE ONLY TIME PREDICATE, AND IT IS APPLIED TO THE REQUEST,
 * NOT TO ITS VERSIONS. For the same reason, the window cannot be a WHERE on
 * the raw rows: if an older version's start time sits inside the window and
 * the latest version moved it outside, a raw filter keeps the stale version
 * alone and counts a request that has left the window, at a cost the ledger
 * has since replaced. Nor can a raw prefilter be widened to a safe margin:
 * the fold sets the start time on admission unconditionally and outcomes keep
 * whatever is set (`gatewaySpend.foldProjection.ts`), so when the outcome
 * folds first the start later moves back by the outcome-to-admission gap, and
 * nothing bounds that gap — the brokered path admits on one emitter and
 * confirms on another. So the raw rows carry NO time predicate; the window is
 * decided in a HAVING on the collapsed `RequestOccurredAt`.
 *
 * The price is that the read scans the organization's whole ledger history
 * rather than the window's months: the partition key (`toYYYYMM(OccurredAt)`)
 * is not used by this read. What keeps it to one organization's requests is
 * the table's ORDER BY `(TenantId, GatewayRequestId)` (migration 00067): the
 * primary index prunes to the organization's own rows in every partition.
 *
 * NO PERSON COLUMN is ever selected. The ledger sits outside erasure, so a
 * `PrincipalUserId` or `EndUserId` read from it would outlive a deletion the
 * rest of the product honoured. The lane groups by model and by virtual key
 * only.
 *
 * MONEY is integer nano-USD (`CostNanoUSD`), summed in ClickHouse as Int64 and
 * read out via `toString` so the JSON step never rounds a figure past 2^53.
 * Each figure then passes through the gateway's own guarded parser, which
 * refuses anything past the safe integer range rather than rounding it.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   ("THE METERED LANE READS THE GATEWAY'S OWN LEDGER")
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { parseSummedNanoUsd } from "~/server/gateway/spendEvents.clickhouse.repository";

const TABLE = "gateway_spend" as const;

/**
 * The read's deadline, comfortably under the managed client's 30 s wire limit
 * (`CLICKHOUSE_REQUEST_TIMEOUT_MS` in `clickhouse/managedClient.ts`). A query
 * deadline at or past that limit is one nothing ever reaches — the client
 * abandons the request first and the screen hangs where it should have shown
 * its error state. This read is a single grouped scan over at most a year of
 * one organization's requests — the screen's frame is clamped to a 365-day
 * ceiling — so 20 s is generous headroom and still leaves the wire limit as
 * the real ceiling.
 */
const METERED_READ_MAX_EXECUTION_SECONDS = 20;

/** Statuses that were priced and charged: a failed request with partial usage
 *  is billed for what it consumed, so it counts as spend. */
const CHARGED_STATUSES = "('confirmed', 'failed')";

/**
 * One request collapsed to its surviving version, named apart from the columns
 * it aggregates so no alias leaks into the WHERE.
 *
 * The WHERE is the tenant fence alone. There is deliberately no `OccurredAt`
 * predicate on the raw rows, not even a widened one: a request's latest
 * version can carry a start time any distance before an older version's, so
 * every version of every request of the organization must reach the collapse
 * for the survivor to be the right one. The window is the HAVING on
 * `RequestOccurredAt`: the start time the ledger currently holds for the
 * request, not the one some older version of it carried. The tenant index
 * (the table's ORDER BY) is what bounds the scan; the month partition key is
 * not used here.
 */
const LATEST_REQUEST_SUBQUERY = `
  SELECT
    GatewayRequestId,
    argMax(Status, EventTimestamp)           AS RequestStatus,
    argMax(CostNanoUSD, EventTimestamp)      AS RequestCostNanoUSD,
    argMax(OccurredAt, EventTimestamp)       AS RequestOccurredAt,
    argMax(Model, EventTimestamp)            AS RequestModel,
    argMax(VirtualKeyId, EventTimestamp)     AS RequestVirtualKeyId,
    argMax(TokensInput, EventTimestamp)      AS RequestTokensInput,
    argMax(TokensOutput, EventTimestamp)     AS RequestTokensOutput,
    argMax(TokensCacheRead, EventTimestamp)  AS RequestTokensCacheRead,
    argMax(TokensCacheWrite, EventTimestamp) AS RequestTokensCacheWrite,
    argMax(TokensReasoning, EventTimestamp)  AS RequestTokensReasoning
  FROM ${TABLE}
  WHERE TenantId IN {tenantIds:Array(String)}
  GROUP BY TenantId, GatewayRequestId
  HAVING RequestOccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
    AND RequestOccurredAt < fromUnixTimestamp64Milli({toMs:Int64})
`;

/**
 * The metered total for a set of requests, expressed once and reused by every
 * grouping.
 *
 * `AmountNanoUsd` sums only the charged requests. `RequestCount` is the charged
 * requests. `PricedRequestCount` is the charged requests that carry a positive
 * cost — counted on its own, NOT derived as charged minus unpriced, because
 * the unpriced count also holds settled requests, which are not charged at
 * all. The service reads it to tell a day that spent nothing from a day whose
 * cost is unknown: a charged request priced at zero with tokens consumed is in
 * `RequestCount` but not here. `RequestsWithoutAmount` is counted BESIDE the
 * total, never inside it: a charged request that consumed tokens yet priced
 * at zero (free or unpriced — the ledger cannot tell which), plus a settled
 * request whose confirmation never arrived so its cost is unknown. Settled
 * rows add nothing to the money sum.
 */
const METERED_FIGURE_COLUMNS = `
          toString(sumIf(RequestCostNanoUSD, RequestStatus IN ${CHARGED_STATUSES})) AS AmountNanoUsd,
          countIf(RequestStatus IN ${CHARGED_STATUSES}) AS RequestCount,
          countIf(RequestStatus IN ${CHARGED_STATUSES} AND RequestCostNanoUSD > 0) AS PricedRequestCount,
          countIf(
            RequestStatus IN ${CHARGED_STATUSES}
            AND RequestCostNanoUSD = 0
            AND (
              RequestTokensInput + RequestTokensOutput + RequestTokensCacheRead
              + RequestTokensCacheWrite + RequestTokensReasoning
            ) > 0
          ) + countIf(RequestStatus = 'settled') AS RequestsWithoutAmount`;

/**
 * The breakdowns rank by money, largest first. `AmountNanoUsd` is the
 * `toString(...)` alias above, and ordering on it sorts as TEXT: "88986800"
 * ranks above "7619357500". Cast back to the number for the sort; the sum of
 * an Int64 column is Int64, so nothing is lost.
 */
const AMOUNT_DESC = "toInt64(AmountNanoUsd) DESC";

function int(value: unknown): number {
  return Number(value ?? 0);
}

export interface GovernanceGatewaySpendWindow {
  /** Every project tenant of the viewer's organization. Empty resolves to
   *  no query and no rows, never to an unfiltered read. */
  tenantIds: string[];
  /** Inclusive, `YYYY-MM-DD`. */
  fromDay: string;
  /** Inclusive, `YYYY-MM-DD`. */
  toDay: string;
}

/** One UTC day of metered spend. */
export interface GovernanceGatewaySpendDayRow {
  /** `YYYY-MM-DD`, the day the requests STARTED in UTC. */
  day: string;
  /** Nano-USD summed over the day's charged requests. */
  amountNanoUsd: number;
  /** Charged (confirmed + failed) requests on the day. */
  requestCount: number;
  /** Charged requests with a positive cost. Zero with `requestCount` above
   *  zero means every charged request priced at zero. */
  pricedRequestCount: number;
  /** Requests carrying no dollar amount: zero-cost-with-tokens plus settled. */
  requestsWithoutAmount: number;
}

/** One model's or one virtual key's window total. */
export interface GovernanceGatewaySpendModelRow {
  model: string;
  amountNanoUsd: number;
  requestCount: number;
  pricedRequestCount: number;
  requestsWithoutAmount: number;
}

export interface GovernanceGatewaySpendVirtualKeyRow {
  virtualKeyId: string;
  amountNanoUsd: number;
  requestCount: number;
  pricedRequestCount: number;
  requestsWithoutAmount: number;
}

/** Midnight UTC of a `YYYY-MM-DD` day. */
function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

export class GovernanceGatewaySpendClickHouseRepository {
  constructor(
    private readonly resolveClient: (
      tenantId: string,
    ) => Promise<ClickHouseClient>,
  ) {}

  /**
   * Per-day metered spend across every project tenant of the organization.
   *
   * The day is `toDate(RequestOccurredAt, 'UTC')` — admission time, the day the
   * caller asked — so a streamed answer running across midnight lands whole on
   * the day it started rather than being split by the server's own timezone.
   */
  async sumDaysForOrganizationProjects(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendDayRow[]> {
    if (input.tenantIds.length === 0) return [];
    const rows = await this.run(input, {
      dimension: "toDate(RequestOccurredAt, 'UTC') AS Day",
      grouping: "Day",
      ordering: "Day",
    });
    return rows.map((row) => ({
      day: String(row.Day ?? ""),
      amountNanoUsd: parseSummedNanoUsd(row.AmountNanoUsd),
      requestCount: int(row.RequestCount),
      pricedRequestCount: int(row.PricedRequestCount),
      requestsWithoutAmount: int(row.RequestsWithoutAmount),
    }));
  }

  /**
   * The window's metered spend per model, exactly as the ledger named it.
   *
   * A breakdown reader today, not wired into the screen: ADR-128 reserves the
   * metered breakdowns and this is the read they will use. Grouped on the model
   * string verbatim — nothing is re-cut here.
   */
  async sumWindowByModel(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendModelRow[]> {
    if (input.tenantIds.length === 0) return [];
    const rows = await this.run(input, {
      dimension: "RequestModel AS Model",
      grouping: "RequestModel",
      ordering: `${AMOUNT_DESC}, Model`,
    });
    return rows.map((row) => ({
      model: String(row.Model ?? ""),
      amountNanoUsd: parseSummedNanoUsd(row.AmountNanoUsd),
      requestCount: int(row.RequestCount),
      pricedRequestCount: int(row.PricedRequestCount),
      requestsWithoutAmount: int(row.RequestsWithoutAmount),
    }));
  }

  /** The window's metered spend per virtual key. Never by person. */
  async sumWindowByVirtualKey(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendVirtualKeyRow[]> {
    if (input.tenantIds.length === 0) return [];
    const rows = await this.run(input, {
      dimension: "RequestVirtualKeyId AS VirtualKeyId",
      grouping: "RequestVirtualKeyId",
      ordering: `${AMOUNT_DESC}, VirtualKeyId`,
    });
    return rows.map((row) => ({
      virtualKeyId: String(row.VirtualKeyId ?? ""),
      amountNanoUsd: parseSummedNanoUsd(row.AmountNanoUsd),
      requestCount: int(row.RequestCount),
      pricedRequestCount: int(row.PricedRequestCount),
      requestsWithoutAmount: int(row.RequestsWithoutAmount),
    }));
  }

  /**
   * One grouped read over the deduped requests. The three public methods differ
   * only in the dimension they group on; the dedup, the window fence, the
   * figures and the deadline are one shape shared here so no two of them can
   * disagree about what a metered figure is.
   *
   * The client is resolved by the FIRST tenant, matching every other multi-
   * tenant read on this schema. The caller hands the ids in the order
   * `ProjectRepository.findAllIdsByOrganization` returns them — ascending by
   * id — so the first is the same project on every read: one organization's
   * projects route to the same ClickHouse.
   */
  private async run(
    input: GovernanceGatewaySpendWindow,
    {
      dimension,
      grouping,
      ordering,
    }: {
      dimension: string;
      grouping: string;
      ordering: string;
    },
  ): Promise<Record<string, unknown>[]> {
    const client = await this.resolveClient(input.tenantIds[0]!);
    const result = await client.query({
      query: `
        SELECT
          ${dimension},
          ${METERED_FIGURE_COLUMNS}
        FROM (${LATEST_REQUEST_SUBQUERY})
        GROUP BY ${grouping}
        ORDER BY ${ordering}
      `,
      query_params: {
        tenantIds: input.tenantIds,
        // Both bounds apply to the collapsed request's start time, in the
        // HAVING — never to the raw rows.
        fromMs: dayStartMs(input.fromDay),
        // Inclusive of the last day: midnight AFTER it, exclusive.
        toMs: dayStartMs(input.toDay) + 86_400_000,
      },
      format: "JSONEachRow",
      clickhouse_settings: {
        max_execution_time: METERED_READ_MAX_EXECUTION_SECONDS,
      },
    });
    return (await result.json()) as Record<string, unknown>[];
  }
}
