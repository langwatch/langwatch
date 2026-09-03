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
import { nanoUsdToDecimalString, usdToNanoUsd } from "@langwatch/gateway-contract";

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

type WarehouseCostWindow = {
  fromMs: number;
  toMs: number;
};

type WarehouseCostChunkInput = WarehouseCostWindow & {
  /** Overridden only to re-ask a refused chunk in smaller pieces. */
  chunkMs?: number;
};

type WarehouseCostReadFloorInput = {
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
const WAREHOUSE_COST_PIECE_MS = 24 * ONE_HOUR_MS;

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

/** Whole milliseconds, or null when the workspace sent something else. */
/** A statement's running totals while its lines are being folded in. */
type PricedTotals = {
  costNanoUsd: bigint;
  hourNanoUsd: bigint;
  /**
   * Each hour this statement drew from, and that hour's whole-warehouse total —
   * keyed, not accumulated, because an hour billed under three SKUs sends the
   * same total three times and adding them would treble the denominator the
   * record reports. Summed once at the end, over the KEYS.
   */
  hourTotalMsByHour: Map<string, bigint>;
};

/** Fold one priced line into its statement's running totals. */
export class DatabricksWarehouseCostService {
  private constructor() {}

  static create(): DatabricksWarehouseCostService {
    return new DatabricksWarehouseCostService();
  }

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
  chunks({
    fromMs,
    toMs,
    chunkMs = WAREHOUSE_COST_CHUNK_MS,
  }: WarehouseCostChunkInput): WarehouseCostWindow[] {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return [];

    const start = Math.floor(fromMs / ONE_HOUR_MS) * ONE_HOUR_MS;
    const end = Math.ceil(toMs / ONE_HOUR_MS) * ONE_HOUR_MS;
    if (end <= start) return [];

    const chunks: WarehouseCostWindow[] = [];
    for (let at = start; at < end; at += chunkMs) {
      chunks.push({
        fromMs: at,
        toMs: Math.min(at + chunkMs, end),
      });
    }
    return chunks;
  }

  /**
   * One refused chunk, as the smaller pieces to ask about instead.
   *
   * The caller refuses a reply whole, so a chunk with more statements than one
   * reply can carry costs every question inside it its cost figure — including
   * the days that would have answered on their own. Asking again in pieces buys
   * those days back, and it is only ever paid for after a chunk was actually
   * refused, so a workspace whose chunks answer never spends a request on it.
   *
   * Oldest first, hour-aligned, and half-open exactly like `chunks`,
   * for the same reason: the caller stops at the first piece it cannot price and
   * holds the watermark there, which only describes the truth if the unpriced
   * remainder is a suffix.
   *
   * One level deep and no further. A piece that is still refused holds the
   * watermark, and `WAREHOUSE_COST_MAX_HOLD_MS` decides how long that may go on —
   * splitting further would spend the run's whole budget chasing an answer that a
   * day-sized question already failed to get.
   */
  pieces(chunk: WarehouseCostWindow): WarehouseCostWindow[] {
    const pieces = this.chunks({
      fromMs: chunk.fromMs,
      toMs: chunk.toMs,
      chunkMs: WAREHOUSE_COST_PIECE_MS,
    });
    // A chunk already at or below the piece size has nothing smaller to be asked
    // as. Reporting no pieces is what tells the caller re-asking is pointless.
    return pieces.length > 1 ? pieces : [];
  }

  /**
   * The per-statement share of each hour's warehouse bill.
   *
   * A statement may appear more than once, for two unrelated reasons, and both
   * are PARTS of one cost rather than competing answers: serverless SQL bills
   * several lines for the same hour, and a statement that ran through an hour
   * boundary is cut into one line per hour it was awake in. Both are summed.
   */
  allocate({ rows }: { rows: WarehouseCostRow[] }): WarehouseCostAllocation {
    const nanoByStatementId = new Map<string, PricedTotals>();
    const skipped: WarehouseCostSkip[] = [];
    // Both sides of the hold are tracked per HOUR, not per statement. A statement
    // that ran through two hours can be settled for one of them and still be
    // waiting on the other, and it is the unsettled hour that has to hold the
    // watermark — pricing the hour that happens to be billed already is not
    // evidence about the hour that is not.
    const owedHours = new Map<string, Set<string>>();
    const pricedHours = new Map<string, Set<string>>();

    // Named on purpose: the two maps this writes to are the same type and mean
    // opposite things, and a swapped first argument would hold every settled
    // statement and settle every held one without failing to compile.
    const noteHour = ({
      into,
      statementId,
      usageHour,
    }: {
      into: Map<string, Set<string>>;
      statementId: string;
      usageHour: string;
    }): void => {
      const hours = into.get(statementId);
      if (hours) hours.add(usageHour);
      else into.set(statementId, new Set([usageHour]));
    };

    for (const row of rows) {
      const share = this.shareOf(row);
      if (share === "free" || share === "idle") continue;
      if (share === "owed") {
        noteHour({
          into: owedHours,
          statementId: row.statementId,
          usageHour: row.usageHour,
        });
        continue;
      }

      if ("reason" in share) {
        skipped.push({
          statementId: row.statementId,
          // A skipped row always has a real SKU — the null-SKU case returns
          // "owed" above and never reaches here. The fallback only satisfies the
          // narrower type.
          skuName: row.skuName ?? "",
          currencyCode: row.currencyCode,
          reason: share.reason,
        });
        continue;
      }

      noteHour({
        into: pricedHours,
        statementId: row.statementId,
        usageHour: row.usageHour,
      });
      this.foldPricedLine({ into: nanoByStatementId, row, share });
    }

    return {
      costByStatementId: this.settleTotals(nanoByStatementId),
      skipped,
      owed: this.heldStatements({ owedHours, pricedHours }),
    };
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
  costReadFloor({ sinceMs, nowMs, costEnabled }: WarehouseCostReadFloorInput): number {
    if (!costEnabled) return sinceMs;
    return Math.min(sinceMs, nowMs - WAREHOUSE_COST_SETTLING_LAG_MS);
  }

  /**
   * Fold one chunk's priced statements into the sweep's running total.
   *
   * Added, not replaced, and that is the half of the chunk-boundary fix that
   * lives outside the SQL. Each chunk emits the hours it owns, so a statement
   * that ran across a boundary arrives twice with a different part of itself.
   * The sweep emits its question exactly once, with whatever this map holds by
   * the end — so replacing would ship the last chunk's slice as the whole cost,
   * which is the same under-count the start-time ownership rule used to produce.
   *
   * All three fields add for the same reason: each is already a sum over the
   * hours the statement ran through, and the chunks partition those hours. The
   * money adds in nanoUSD and leaves as an exact decimal string, so no float ever
   * touches it.
   *
   * Chunks never overlap and a refused chunk is merged only as its pieces, so no
   * hour is ever read twice inside one sweep. Adding therefore cannot double a
   * cost that was already counted.
   */
  merge({
    into,
    from,
  }: {
    into: Map<string, WarehousePricedStatement>;
    from: Map<string, WarehousePricedStatement>;
  }): void {
    for (const [statementId, priced] of from) {
      const already = into.get(statementId);
      if (already === undefined) {
        into.set(statementId, priced);
        continue;
      }
      into.set(statementId, {
        costUsd: nanoUsdToDecimalString(
          usdToNanoUsd(already.costUsd) + usdToNanoUsd(priced.costUsd),
        ),
        hourTotalExecutionMs: (
          BigInt(already.hourTotalExecutionMs) + BigInt(priced.hourTotalExecutionMs)
        ).toString(),
        hourBillableUsd: nanoUsdToDecimalString(
          usdToNanoUsd(already.hourBillableUsd) + usdToNanoUsd(priced.hourBillableUsd),
        ),
      });
    }
  }

  private wholeMs(value: string): bigint | null {
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
  private shareOf(
    row: WarehouseCostRow,
  ):
    | { nanoUsd: bigint; hourNanoUsd: bigint; hourTotalMs: bigint }
    | { reason: WarehouseCostSkipReason }
    | "free"
    | "idle"
    | "owed" {
    // An hour the statement did no work in reveals nothing and can cost nothing,
    // whatever its SKU says. Checked before the null-SKU branch on purpose: that
    // branch holds the watermark, and holding the whole source for an hour this
    // statement was not awake in is a stall bought for a share of exactly zero.
    // It does not disturb the distinction below, because every row that turns on
    // it has execution time by definition.
    if (this.wholeMs(row.executionMsInHour) === 0n) return "idle";

    // No billing row for this statement's hour yet. Checked first, before every
    // other branch: a null SKU is not a free line and not an unreadable one, it
    // is a bill that has not landed. Reading it as anything else — or letting
    // `.includes` run on a null — is the zero-cost stall this branch exists to
    // stop.
    if (row.skuName === null) return "owed";

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

    const executionMs = this.wholeMs(row.executionMsInHour);
    const totalMs = this.wholeMs(row.hourTotalMs);
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
    // what the customer was charged. The hour's own bill rides along so the
    // record can carry the share's ingredients, not just its result.
    return {
      nanoUsd: (hourNanoUsd * executionMs) / totalMs,
      hourNanoUsd,
      hourTotalMs: totalMs,
    };
  }

  private foldPricedLine({
    into,
    row,
    share,
  }: {
    into: Map<string, PricedTotals>;
    row: WarehouseCostRow;
    share: { nanoUsd: bigint; hourNanoUsd: bigint; hourTotalMs: bigint };
  }): void {
    const entry = into.get(row.statementId);
    if (entry) {
      entry.costNanoUsd += share.nanoUsd;
      // Several lines are several PARTS of a bill, so the billable figure sums
      // the same way the cost does — whether they are one hour's SKUs or the
      // several hours a long statement ran through.
      entry.hourNanoUsd += share.hourNanoUsd;
      entry.hourTotalMsByHour.set(row.usageHour, share.hourTotalMs);
      return;
    }
    into.set(row.statementId, {
      costNanoUsd: share.nanoUsd,
      hourNanoUsd: share.hourNanoUsd,
      hourTotalMsByHour: new Map([[row.usageHour, share.hourTotalMs]]),
    });
  }

  /**
   * The per-hour running totals turned into the record's money fields.
   *
   * The denominator is summed over the KEYS of `hourTotalMsByHour`, so an hour
   * billed under several SKUs contributes its total once while a statement that
   * ran through two hours contributes both — which is what keeps
   * `hourTotalExecutionMs` spanning exactly the hours `hourBillableUsd` came
   * from.
   */
  private settleTotals(
    nanoByStatementId: Map<string, PricedTotals>,
  ): Map<string, WarehousePricedStatement> {
    const costByStatementId = new Map<string, WarehousePricedStatement>();
    for (const [statementId, entry] of nanoByStatementId) {
      let hourTotalMs = 0n;
      for (const total of entry.hourTotalMsByHour.values()) hourTotalMs += total;
      costByStatementId.set(statementId, {
        costUsd: nanoUsdToDecimalString(entry.costNanoUsd),
        hourTotalExecutionMs: hourTotalMs.toString(),
        hourBillableUsd: nanoUsdToDecimalString(entry.hourNanoUsd),
      });
    }
    return costByStatementId;
  }

  /**
   * The statements whose cost is not settled yet, and so must hold the watermark.
   *
   * An hour that priced is settled; an hour that only ever showed up unbilled is
   * not, and one such hour is enough to hold the whole statement. Within a single
   * hour this is exactly the old rule — a line that priced settles the hour its
   * unbilled sibling SKU left open.
   */
  private heldStatements({
    owedHours,
    pricedHours,
  }: {
    owedHours: Map<string, Set<string>>;
    pricedHours: Map<string, Set<string>>;
  }): Set<string> {
    const owed = new Set<string>();
    for (const [statementId, hours] of owedHours) {
      const priced = pricedHours.get(statementId);
      for (const hour of hours) {
        if (priced?.has(hour)) continue;
        owed.add(statementId);
        break;
      }
    }
    return owed;
  }
}
