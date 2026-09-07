// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The shape and the constants a Genie question's warehouse cost is worked out from: the
 * settling lag, the chunk and piece widths, the billing row the workspace sends, and the
 * priced statement the puller records. See the service for how the share is computed.
 */

import { z } from "zod";

export const WAREHOUSE_COST_SETTLING_LAG_MS = 2 * 60 * 60 * 1000;

const ONE_HOUR_MS = 60 * 60 * 1000;

export type WarehouseCostWindow = {
  fromMs: number;
  toMs: number;
};

export type WarehouseCostChunkInput = WarehouseCostWindow & {
  /** Overridden only to re-ask a refused chunk in smaller pieces. */
  chunkMs?: number;
};

export type WarehouseCostReadFloorInput = {
  sinceMs: number;
  nowMs: number;
  costEnabled: boolean;
};

/**
 * How much of the window one cost request asks about.
 *
 * Bounded from both ends, and the two bounds were in conflict until this was
 * measured.
 *
 * From above: the reply is capped, and a cut-short reply is refused whole, so a
 * first sweep asked as ONE question has a single cap to trip and tripping it
 * leaves the whole month unpriced. Smaller pieces mean a piece busy enough to
 * trip the cap on its own, with the pieces before it keeping their cost.
 *
 * From below: every piece is a request, and a request is not cheap in the only
 * currency that binds here. The run gets five minutes (`PER_JOB_DEADLINE_MS`)
 * and a run that overruns is killed holding the questions its sweep had already
 * read — it discards them and keeps its cursor, so the next run stalls in the
 * same place. A day at a time made a thirty-day sweep thirty sequential
 * requests, and it could never finish one.
 *
 * A week is what the measurement supports. Against a real workspace on
 * 2026-08-19 the reply time barely moved with the size of the question — five
 * weekly reads of a thirty-day window took 10.8s, 23.4s, 26.9s, 37.7s and 22.0s
 * for 120.8s in total, against 648s for the same window read daily and 22.6s
 * for it read whole. Latency is nearly all fixed cost per question, so asking
 * fewer, larger questions is very close to free, and the cap is the only reason
 * not to ask exactly one.
 *
 * A week that still cannot be answered whole is not surrendered: the caller
 * re-asks it in days (`warehouseCostPieces`). So this size is a bet on the
 * common case, not a limit on what can be priced — which is what lets it be
 * this large.
 *
 * Whole hours either way. The bill is published per hour and the statements are
 * bucketed per hour, so a boundary inside an hour would separate that hour's
 * queries from that hour's bill and price every one of them at nothing.
 */
export const WAREHOUSE_COST_CHUNK_MS = 7 * 24 * ONE_HOUR_MS;

/**
 * How far BEFORE a window the cost read scans for statements still running in
 * it.
 *
 * A statement that began at 09:58 and ran forty minutes is billed to hour 10
 * for thirty-eight of them, so hour 10's denominator has to count it — but the
 * statement's own row lives in hour 09, outside a window that starts at 10:00.
 * Without a look-back that hour under-counts its execution time and hands every
 * question inside it a larger share of the bill than it earned.
 *
 * A day, and the bound is the point. It is not free: it widens the scan of
 * `system.query.history`, which on the normal seven-day chunk is +14% and on a
 * refused chunk's one-day pieces is double. Unbounded it would be a full-table
 * scan on every read. What a day buys is every plausible warehouse statement —
 * a query still running after twenty-four hours is a runaway, and its
 * under-counted first hours err in the same direction as the bug this bound
 * exists to fix, but bounded to that one statement rather than to all of them.
 */
export const WAREHOUSE_COST_STRADDLE_LOOKBACK_MS = 24 * ONE_HOUR_MS;

/**
 * How much of one refused chunk a follow-up request asks about.
 *
 * A day, because that is the size the whole window used to be read at: it is
 * known to be answerable on workspaces busy enough to refuse a week, and it is
 * the smallest piece worth asking for given the bill is published per hour.
 */
export const WAREHOUSE_COST_PIECE_MS = 24 * ONE_HOUR_MS;

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
  /**
   * The hour this row is about, as the warehouse rendered it. An opaque key,
   * only ever compared against other rows of the same reply.
   *
   * It is load-bearing because one statement can now produce several rows for
   * two entirely different reasons, and they fold in opposite ways. Several
   * rows for ONE hour are several SKUs the warehouse billed that hour under:
   * they share a denominator, and summing it would halve every share. Several
   * rows for DIFFERENT hours are the hours a statement ran through: their
   * denominators are different totals and must be summed, or the record claims
   * a share of two hours' bills against one hour's execution time.
   */
  usageHour: z.string(),
  /**
   * The part of the statement's execution that fell inside THIS row's hour —
   * not its whole runtime. The warehouse is billed per hour for the work that
   * actually ran in that hour, so the share's numerator has to be cut the same
   * way or it is answering a different question than the denominator.
   */
  executionMsInHour: z.string(),
  /** Executed milliseconds across the whole warehouse in this row's hour. */
  hourTotalMs: z.string(),
  /** Null when the workspace publishes no USD price for the hour's SKU. */
  hourBillableUsd: z.string().nullable(),
  currencyCode: z.string().nullable(),
  /**
   * Null when the statement's hour has no billing row yet — the LEFT JOIN in
   * the cost query kept the statement but found nothing in `system.billing.usage`
   * to price it against. A present SKU means the hour was billed; a null one
   * means "seen but unbilled", which is a hold, not a zero.
   */
  skuName: z.string().nullable(),
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

/**
 * One priced statement: its share of the bill, and the two numbers the share
 * was worked out from.
 *
 * The ingredients travel with the cost because the share alone reads as
 * nonsense on an idle warehouse — "$4 for a five-second question" is correct
 * and looks broken. They are deliberately RAW: an earlier design shipped
 * `hourTotalExecutionMs / 3_600_000` as a "busy fraction", and it was refuted
 * on both ends — the sum is unclamped over concurrent statements (two parallel
 * full-hour queries read as 200%), and on a serverless warehouse that
 * auto-stops mid-hour the clock-hour denominator inverts the story (two
 * minutes of flat-out work reads as 97% idle when the billed idle was zero).
 * A true utilization needs billed uptime, which no table this token reads
 * carries. So the record says what was measured and claims nothing more.
 */
export type WarehousePricedStatement = {
  /**
   * The statement's share of the bill, as an exact decimal USD string. A
   * statement that ran through an hour boundary is priced once per hour and
   * this is the sum of those shares.
   */
  costUsd: string;
  /**
   * Executed milliseconds across ALL statements on the warehouse, summed over
   * the hours this statement itself ran through — the share's denominator. A
   * sum, not a utilization: concurrency can carry a single hour past one hour
   * of wall clock, and a statement spanning three hours adds three of them.
   */
  hourTotalExecutionMs: string;
  /**
   * The bill across the lines this statement priced on, as an exact decimal USD
   * string — the share's other ingredient. Both this and the denominator span
   * the same hours, so the pair says which bill the cost was drawn from.
   *
   * `costUsd` is NOT recoverable from them. Each hour's share is taken at that
   * hour's own price and the three fields are then summed independently, so a
   * one-line reconstruction only holds when every hour cost the same per
   * millisecond. It does not for a straddler: the forty-minute statement in the
   * unit suite costs 11.997369574, while bill x runtime / total reads
   * 11.995001..., because its two minutes in an otherwise idle hour 09 were
   * billed at nineteen times the per-millisecond price of hour 10. Reconciling
   * a straddler needs the per-hour lines, which this record does not carry.
   */
  hourBillableUsd: string;
};

export type WarehouseCostAllocation = {
  /** Statement id → its share of the bill and the numbers behind it. */
  costByStatementId: Map<string, WarehousePricedStatement>;
  /**
   * Rows that were deliberately not priced. Reported rather than dropped: a
   * question with no cost and a question whose cost could not be worked out
   * look identical on the record, and only one of them is a problem.
   */
  skipped: WarehouseCostSkip[];
  /**
   * Statements seen in the window whose hour has no billing row yet, and which
   * did not also price on another line. Not a skip and not a zero: their cost
   * has not settled, so the caller holds the watermark for them rather than
   * moving past and recording them at zero. Distinct from `no_published_price`,
   * which is a billing row that names no USD rate — a genuine, permanent gap.
   */
  owed: Set<string>;
};

