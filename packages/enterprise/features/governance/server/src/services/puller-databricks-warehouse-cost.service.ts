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
import { nanoUsdToDecimalString, usdToNanoUsd } from "@langwatch/gateway-contract";
import {
  GENIE_FREE_USAGE_SKU_MARKER,
  WAREHOUSE_COST_CHUNK_MS,
  WAREHOUSE_COST_PIECE_MS,
  WAREHOUSE_COST_SETTLING_LAG_MS,
  WAREHOUSE_COST_STRADDLE_LOOKBACK_MS,
  type WarehouseCostAllocation,
  type WarehouseCostChunkInput,
  type WarehouseCostReadFloorInput,
  type WarehouseCostRow,
  type WarehouseCostSkip,
  type WarehouseCostWindow,
  type WarehousePricedStatement,
} from "../rules/warehouse-cost.rules.ts";

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
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return [];
    }

    const start = Math.floor(fromMs / ONE_HOUR_MS) * ONE_HOUR_MS;
    const end = Math.ceil(toMs / ONE_HOUR_MS) * ONE_HOUR_MS;
    if (end <= start) {
      return [];
    }

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
      if (hours) {
        hours.add(usageHour);
      } else {
        into.set(statementId, new Set([usageHour]));
      }
    };

    for (const row of rows) {
      const share = this.shareOf(row);
      if (share === "free" || share === "idle") {
        continue;
      }

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
    if (!costEnabled) {
      return sinceMs;
    }

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

  /** Whole milliseconds, or null when the workspace sent something else. */
  private wholeMs(value: string): bigint | null {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }

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
    if (this.wholeMs(row.executionMsInHour) === 0n) {
      return "idle";
    }

    // No billing row for this statement's hour yet. Checked first, before every
    // other branch: a null SKU is not a free line and not an unreadable one, it
    // is a bill that has not landed. Reading it as anything else — or letting
    // `.includes` run on a null — is the zero-cost stall this branch exists to
    // stop.
    if (row.skuName === null) {
      return "owed";
    }

    // Genie's own line is free today. Pricing it would invent spend for the one
    // thing Databricks is explicit about not charging for.
    if (row.skuName.includes(GENIE_FREE_USAGE_SKU_MARKER)) {
      return "free";
    }

    if (row.hourBillableUsd === null) {
      return { reason: "no_published_price" };
    }

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

    if (totalMs === 0n) {
      return { reason: "hour_has_no_execution_time" };
    }

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

  /** Fold one priced line into its statement's running totals. */
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
      for (const total of entry.hourTotalMsByHour.values()) {
        hourTotalMs += total;
      }

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
        if (priced?.has(hour)) {
          continue;
        }

        owed.add(statementId);
        break;
      }
    }

    return owed;
  }
}
