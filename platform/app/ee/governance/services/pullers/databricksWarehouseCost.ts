// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a Genie question cost, worked out from the warehouse's bill.
 *
 * Databricks does not price a Genie question. It prices the SQL warehouse for
 * the hours it was awake, in DBU, and separately publishes what a DBU of that
 * SKU lists for. A question's cost is therefore always a SHARE, never a
 * reading: the fraction of the hour's warehouse time that the question's SQL
 * spent, applied to that hour's bill.
 *
 * Three things about that share are worth stating, because getting any of them
 * wrong produces a number that looks entirely plausible:
 *
 *  1. The denominator is the WHOLE warehouse, not the Genie queries on it. A
 *     warehouse shared with dashboards and jobs that divides only across Genie
 *     hands Genie the entire bill. Validated against a live workspace at 13.3%
 *     of warehouse compute — the other 86.7% belongs to traffic nobody asked
 *     Genie for, and it stays unattributed rather than being redistributed.
 *
 *  2. It is a LIST price. The account's negotiated discount is on no table this
 *     token can read, so the figure is an estimate by construction and is
 *     recorded as one. Presenting it as the invoice is the failure mode; being
 *     approximately right is the whole point.
 *
 *  3. It arrives late. A query's compute reaches the billing tables well after
 *     the query, so the question is recorded first at zero and corrected once
 *     the bill lands — which only works if the puller is still looking. See
 *     `costReadFloorMs`.
 *
 * The arithmetic is bigint nanoUSD throughout. A share of an hourly bill is
 * routinely a fraction of a cent, and float division on money is how a busy
 * workspace comes to report nothing at all.
 */

import { z } from "zod";

import {
  nanoUsdToDecimalString,
  usdToNanoUsd,
} from "~/server/gateway/wireMoney";

/**
 * How far back a cost-bearing source keeps reading questions it has already
 * recorded.
 *
 * Databricks documents the billing and query-history system tables as lagging
 * the activity they describe; the observed lag is well under an hour but the
 * published ceiling is around one. The puller's own watermark sits five minutes
 * behind the sweep, so without this a question is unreadable long before its
 * cost exists and would sit at zero forever, with nothing reporting a problem.
 *
 * Two hours buys the whole documented lag plus room for a workspace whose
 * tables are behind. It is paid for in requests: at the default fifteen-minute
 * schedule a question is re-read roughly eight times before it settles, bounded
 * by the adapter's per-run request budget.
 */
export const WAREHOUSE_COST_SETTLING_LAG_MS = 2 * 60 * 60 * 1000;

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * How much of the window one cost request asks about.
 *
 * The reply is capped, and a cut-short reply is refused whole, so the SIZE of
 * the question decides whether a busy warehouse can be priced at all. A first
 * sweep reads thirty days: asked as one question there is a single cap to trip,
 * and tripping it leaves every question in the whole month unpriced. Asked a
 * day at a time it takes a day busy enough to trip the cap on its own, and the
 * days answered before it keep their cost.
 *
 * A day rather than an hour because every chunk spends a request from the run's
 * budget. Thirty days is thirty requests of the four hundred a run may spend;
 * hourly would be seven hundred and twenty and could not finish in one run.
 *
 * Whole hours either way. The bill is published per hour and the statements are
 * bucketed per hour, so a boundary inside an hour would separate that hour's
 * queries from that hour's bill and price every one of them at nothing.
 */
export const WAREHOUSE_COST_CHUNK_MS = 24 * ONE_HOUR_MS;

/**
 * How long the watermark may be held waiting for a bill before it gives up.
 *
 * Elapsed time, not distance. A first sweep is thirty days behind on its first
 * run and that is healthy; the same instant refused for a week running is not,
 * and only a clock can tell the two apart.
 *
 * Holding is worth it when the bill is merely late — the tables settle in hours
 * (`WAREHOUSE_COST_SETTLING_LAG_MS`), so a week of retries is far more than
 * lateness ever needs. Past that the problem is not lateness but volume: a day
 * with more Genie statements than one reply can carry is refused identically on
 * every future run, and volume does not resolve itself.
 *
 * Without this bound that case pins the source to a fixed instant forever. It
 * never prices the day it is waiting on, and it re-sweeps an ever-widening
 * window to do it — paying more every run for an answer that cannot arrive.
 * Giving up costs those days their cost figure, which is what they had before
 * any of this existed; not giving up costs the source its ability to move at
 * all. The comment on `warehouseCost` states the priority this follows: a
 * workspace whose billing cannot be read should still get its activity.
 */
export const WAREHOUSE_COST_MAX_HOLD_MS = 7 * 24 * ONE_HOUR_MS;

/**
 * The window as oldest-first pieces, each small enough to stand a chance of
 * being answered whole.
 *
 * Oldest first is the load-bearing part. The caller stops at the first piece it
 * cannot price and holds the watermark there, so the answered pieces are always
 * the OLDEST ones and the unpriced remainder is always a suffix — which is
 * exactly the shape a watermark can describe. Newest-first would answer pieces
 * scattered through the window and leave holes no single instant could mark.
 *
 * Both ends are rounded OUT to whole hours, so no hour is ever split across two
 * pieces and every hour's statements are weighed against that same hour's bill.
 */
export function warehouseCostChunks({
  fromMs,
  toMs,
}: {
  fromMs: number;
  toMs: number;
}): Array<{ fromMs: number; toMs: number }> {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return [];

  const start = Math.floor(fromMs / ONE_HOUR_MS) * ONE_HOUR_MS;
  const end = Math.ceil(toMs / ONE_HOUR_MS) * ONE_HOUR_MS;
  if (end <= start) return [];

  const chunks: Array<{ fromMs: number; toMs: number }> = [];
  for (let at = start; at < end; at += WAREHOUSE_COST_CHUNK_MS) {
    chunks.push({
      fromMs: at,
      toMs: Math.min(at + WAREHOUSE_COST_CHUNK_MS, end),
    });
  }
  return chunks;
}

/**
 * How Genie's own queries identify themselves in `system.query.history`.
 *
 * This is also what keeps the puller's own billing query off the bill: that
 * query reports a different client application, so it is never one of the
 * statements cost is allocated to. It still counts toward the hour's total
 * execution time, which dilutes Genie's share very slightly — the safe
 * direction, and preferable to carving an exception into the denominator.
 */
export const GENIE_CLIENT_APPLICATION = "Databricks SQL Genie Space";

/**
 * Genie's free line in `system.billing.usage`.
 *
 * A distinct SKU billed at zero DBU-price today, tracked because Databricks may
 * start charging for it. Matched on a marker rather than the full SKU name
 * because the name is regionalised.
 */
export const GENIE_FREE_USAGE_SKU_MARKER = "GENIE_FREE_USAGE";

/**
 * One row of the allocation query: a Genie statement, its execution time, and
 * the hour it ran in, priced.
 *
 * Every numeric arrives as a string. That is not a defensive choice — the SQL
 * Statement Execution API returns every value as a string, which is exactly
 * what money wants, so the value reaches `usdToNanoUsd` without a float ever
 * existing. The type is derived from the schema rather than written beside it.
 */
export const warehouseCostRowSchema = z.object({
  statementId: z.string().min(1),
  executionDurationMs: z.string(),
  hourTotalMs: z.string(),
  /** Null when the workspace publishes no USD price for the hour's SKU. */
  hourBillableUsd: z.string().nullable(),
  currencyCode: z.string().nullable(),
  skuName: z.string(),
});

export type WarehouseCostRow = z.infer<typeof warehouseCostRowSchema>;

export type WarehouseCostSkipReason =
  | "currency_not_usd"
  | "no_published_price"
  | "hour_has_no_execution_time"
  | "unreadable_row";

export type WarehouseCostSkip = {
  statementId: string;
  skuName: string;
  currencyCode: string | null;
  reason: WarehouseCostSkipReason;
};

export type WarehouseCostAllocation = {
  /** Statement id → cost as an exact decimal USD string. */
  costByStatementId: Map<string, string>;
  /**
   * Rows that were deliberately not priced. Reported rather than dropped: a
   * question with no cost and a question whose cost could not be worked out
   * look identical on the record, and only one of them is a problem.
   */
  skipped: WarehouseCostSkip[];
};

/** Whole milliseconds, or null when the workspace sent something else. */
function wholeMs(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

/**
 * One row's share of its hour, or why it has none.
 *
 * `"free"` is not a skip: Genie's own line being unpriced is the correct answer
 * for it, not a gap in what we could read, and reporting it would train whoever
 * reads the logs to ignore them.
 */
function shareOf(
  row: WarehouseCostRow,
): { nanoUsd: bigint } | { reason: WarehouseCostSkipReason } | "free" {
  // Genie's own line is free today. Pricing it would invent spend for the one
  // thing Databricks is explicit about not charging for.
  if (row.skuName.includes(GENIE_FREE_USAGE_SKU_MARKER)) return "free";

  if (row.hourBillableUsd === null) return { reason: "no_published_price" };

  // A rate in another currency is not a rate. Converting it would need a number
  // from outside Databricks, and the result would be indistinguishable from a
  // figure someone could reconcile.
  if (row.currencyCode !== null && row.currencyCode !== "USD") {
    return { reason: "currency_not_usd" };
  }

  const executionMs = wholeMs(row.executionDurationMs);
  const totalMs = wholeMs(row.hourTotalMs);
  if (executionMs === null || totalMs === null) {
    return { reason: "unreadable_row" };
  }
  if (totalMs === 0n) return { reason: "hour_has_no_execution_time" };

  let hourNanoUsd: bigint;
  try {
    hourNanoUsd = usdToNanoUsd(row.hourBillableUsd);
  } catch {
    return { reason: "unreadable_row" };
  }

  // Integer division truncates, so the shares of an hour sum to at most that
  // hour's bill. Erring downward is the only direction that cannot overstate
  // what the customer was charged.
  return { nanoUsd: (hourNanoUsd * executionMs) / totalMs };
}

/**
 * The per-statement share of each hour's warehouse bill.
 *
 * A statement may appear more than once: serverless SQL bills several lines for
 * the same hour, and each is a PART of the statement's cost. They are summed,
 * not treated as competing answers for the same thing.
 */
export function allocateWarehouseCost({
  rows,
}: {
  rows: WarehouseCostRow[];
}): WarehouseCostAllocation {
  const nanoByStatementId = new Map<string, bigint>();
  const skipped: WarehouseCostSkip[] = [];

  for (const row of rows) {
    const share = shareOf(row);
    if (share === "free") continue;

    if ("reason" in share) {
      skipped.push({
        statementId: row.statementId,
        skuName: row.skuName,
        currencyCode: row.currencyCode,
        reason: share.reason,
      });
      continue;
    }

    nanoByStatementId.set(
      row.statementId,
      (nanoByStatementId.get(row.statementId) ?? 0n) + share.nanoUsd,
    );
  }

  const costByStatementId = new Map<string, string>();
  for (const [statementId, nano] of nanoByStatementId) {
    costByStatementId.set(statementId, nanoUsdToDecimalString(nano));
  }

  return { costByStatementId, skipped };
}

/**
 * The oldest question a run reads.
 *
 * A source that prices its questions has to keep reading them after the
 * watermark would otherwise have moved on, because the cost shows up later than
 * the question does. `Math.min` is deliberate and load-bearing: the look-back
 * may only ever WIDEN the window. A source whose watermark has fallen further
 * behind than the settling window — paused, or working through a backfill —
 * must not be dragged forward to it, which would skip everything in between and
 * then report a complete sweep.
 */
export function costReadFloorMs({
  sinceMs,
  nowMs,
  costEnabled,
}: {
  sinceMs: number;
  nowMs: number;
  costEnabled: boolean;
}): number {
  if (!costEnabled) return sinceMs;
  return Math.min(sinceMs, nowMs - WAREHOUSE_COST_SETTLING_LAG_MS);
}
