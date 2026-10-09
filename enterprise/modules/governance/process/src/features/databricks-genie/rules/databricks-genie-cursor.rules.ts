// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The Genie puller's durable cursor: its shape and how one run's outcome becomes the next run's start. */

import type { DatabricksGeniePullConfig } from "@langwatch/enterprise-governance-contract";
import { toEpochMs } from "@langwatch/time";
import { z } from "zod";

import type { PaidGenieBillOutcome } from "./databricks-genie-paid-bill.rules.ts";
import type { SweepResult } from "./databricks-genie-sweep.rules.ts";
import { WAREHOUSE_COST_MAX_HOLD_MS } from "./warehouse-cost.rules.ts";

/**
 * How far back a completed sweep sets its watermark from the instant it began.
 *
 * The window is re-read on the next run, and that is the point. Genie's list
 * endpoints take no server-side time filter, so "new" is decided here against
 * `created_timestamp` — a value Databricks stamps on its own clock, not ours.
 * A watermark placed exactly at our sweep's start would drop any message whose
 * server timestamp landed a few seconds behind our clock. Re-reading five
 * minutes costs a handful of requests and dedups on the message id at both
 * sinks; the alternative silently loses messages at the boundary.
 */
const WATERMARK_LAG_MS = 5 * 60 * 1000;

/**
 * The durable cursor.
 *
 * `sinceMs` is the watermark: a message is new when it was created after it.
 * `spaceId` is where a budget-truncated sweep resumes, so a large workspace
 * makes forward progress across runs instead of re-crawling from the top and
 * running out at the same place every time.
 */
export const cursorSchema = z.object({
  sinceMs: z.number().int().nonnegative(),
  spaceId: z.string().nullable().default(null),
  /**
   * Where inside `spaceId` to resume, or null to start that space from the top.
   *
   * Space granularity alone is not enough. A space whose walk costs more than
   * one run's entire request budget could never be finished: every run would
   * restart it from the first conversation, run out at roughly the same place,
   * and the sweep would never advance past it — so no space ordered after it
   * would be swept either. Nothing was lost (the watermark is held), but
   * nothing arrived. This carries the position inside the space so each run
   * picks up where the last one stopped.
   */
  conversationId: z.string().nullable().default(null),
  /**
   * Whether anything was SKIPPED OVER earlier in the sweep now in flight.
   *
   * This is what separates "where do I carry on from" from "was this sweep
   * whole", and the two must not be the same answer. A space that 403s is
   * deliberately walked past so one unreadable space cannot cost the workspace
   * the others — but the resume point then moves beyond it, and once the sweep
   * finishes, nothing in the position alone remembers that a hole was left. The
   * watermark would advance over it.
   *
   * Making the resume point itself hang back at the hole fixes the loss and
   * buys starvation: a permanently unreadable space would pin the sweep there
   * forever and every space behind it would stop being read at all. So the
   * position keeps moving, and this flag — carried for as long as the sweep is
   * in flight — holds the watermark instead. A sweep with a gap finishes, keeps
   * its window, and starts over; nothing is lost and nothing is starved.
   */
  sweepHadGap: z.boolean().default(false),
  /**
   * Fingerprint of the space set the in-flight sweep is walking.
   *
   * Resuming skips every space before the resume point on the assumption that
   * an earlier run of this sweep already read them. That assumption breaks the
   * moment the resolved set GAINS a space sorting before the point — an admin
   * adding one to `spaceIds`, or a permission grant making one visible to
   * discovery. It would be skipped for the rest of the sweep, and the sweep
   * would then complete with no gap recorded and move the watermark over
   * everything in it.
   *
   * So the set is fingerprinted. A sweep that resumes into a different set is
   * not a resumption at all: the position is dropped and the sweep restarts
   * from the top, off the unchanged watermark, which re-reads everything.
   */
  spaceSetFingerprint: z.string().nullable().default(null),
  /**
   * The oldest message the sweep in flight saw that could still change, or
   * null. Carried across the sweep's runs so a message read on run one still
   * holds the window when run four finishes the sweep.
   */
  sweepOldestPendingMs: z.number().int().nonnegative().nullable().default(null),
  /**
   * When the sweep currently IN FLIGHT began, or null when none is.
   *
   * A sweep is not a run. The budget can cut one short and `spaceId` carries
   * it into the next run, so a large workspace is swept across several runs
   * over several scheduled ticks. The watermark has to anchor to when that
   * whole sweep started, which means the instant has to outlive the run that
   * stamped it — hence the cursor rather than a local.
   */
  sweepStartedAtMs: z.number().int().positive().nullable().default(null),
  /**
   * When the watermark first stopped for a bill it could not read, or null when
   * it is not stopped for one.
   *
   * The age of the hold, not its depth. A hold is a bet that the bill is merely
   * late, and the bet has to be callable: a day with more statements than one
   * reply can carry is cut short identically on every future run, and a hold
   * with no expiry pins the source to that instant forever while the sweep it
   * repeats grows wider each time. Depth cannot tell those apart — a first
   * sweep is legitimately thirty days back on its first run — so the instant
   * the hold BEGAN is what is carried, and it is cleared the moment a run
   * prices its window whole.
   *
   * Same shape as `sweepHadGap` above, and for the same reason: that flag
   * exists because making the resume point hang back at an unreadable space
   * bought starvation. This is the billing tables' version of the same trade.
   */
  costHeldSinceMs: z.number().int().positive().nullable().default(null),
  /**
   * How far the paid Genie bill read has reached, or null when it has never
   * finished a window — including when the read is switched off.
   *
   * The bill read's OWN position, and never the watermark's. The two reads
   * answer on different tables and fail independently: the warehouse
   * allocation holding for a late bill must not pin the bill line, and a bill
   * line cut short must not stop the watermark from moving over questions the
   * sweep read whole. A held bill read leaves this where the hold began, so
   * the next run asks about that period again; a finished one sets it to the
   * end of the window it read. `Math.max` on the way in keeps it monotonic.
   *
   * Written on a HELD first read as well as a finished one, and that is what
   * pins the floor: with no configured start the floor is "thirty days ago",
   * which is a different instant every run, so a first read that was refused
   * and wrote nothing would ask about a window that starts a day later each
   * day — losing a day of history per day while claiming to hold.
   */
  paidBillReadThroughMs: z.number().int().nonnegative().nullable().default(null),
  /**
   * When the paid bill read first stopped for a window it could not finish,
   * or null when it is not stopped for one.
   *
   * `costHeldSinceMs` for the other read, and for the same reason: a hold is
   * a bet that the bill is merely late, and a workspace that refuses the
   * billing tables every run would otherwise re-ask the same window forever.
   * Aged against `WAREHOUSE_COST_MAX_HOLD_MS`; once it runs out the position
   * moves to the end of the window that was asked about, the rows in it stay
   * unrecorded — with no amount, never zero — and the stamp is cleared so
   * the next hold ages from its own start. Cleared the moment a run reads its
   * window whole. Nullable with a default so a cursor written before the
   * field existed still parses.
   */
  paidBillHeldSinceMs: z.number().int().positive().nullable().default(null),
});
export type GenieCursor = z.infer<typeof cursorSchema>;

/**
 * Where the watermark lands after a sweep.
 *
 * It moves ONLY on a complete sweep, and it is derived from when the sweep
 * BEGAN rather than from the newest message it saw. The difference is the
 * whole correctness argument: a sweep walks six spaces over some seconds or
 * minutes, and someone asking a question in space one while the sweep is
 * already reading space four is invisible to it. A watermark at the newest
 * message seen would sit AFTER that question's timestamp, and the next run
 * would filter it out — a message lost with nothing anywhere reporting a
 * failure. Anchored to the sweep's start, that question is still in the next
 * run's window.
 *
 * `sweepStartedAtMs` is the start of the SWEEP, which on a large workspace is
 * several runs back — not the start of the run calling this. Anchoring to the
 * current run would reintroduce the same loss on exactly the workspaces the
 * resume mechanism exists for: the gap between the first run and the last is
 * scheduling interval times the number of runs, and everything asked in an
 * already-swept space during that gap would be filtered out for good.
 *
 * `Math.max` against the previous value keeps it monotonic, so a clock that
 * steps backwards cannot rewind the window to the beginning of history.
 */
function nextWatermark({
  previousMs,
  sweepStartedAtMs,
  complete,
  oldestPendingMs,
  pricedThroughMs,
  holdExpired,
}: {
  previousMs: number;
  sweepStartedAtMs: number;
  complete: boolean;
  /**
   * The oldest message that may still change. The window stops just short of
   * it so it is read again, rather than stopping altogether — a busy workspace
   * always has something in flight, and freezing on that would grow the
   * re-read window without bound.
   */
  oldestPendingMs: number | null;
  /**
   * The instant past which this run could not work out what anything cost.
   *
   * A second ceiling, and it exists because a question recorded at zero is
   * indistinguishable from one that genuinely cost nothing. Moving the
   * watermark past a period whose bill we could have read but did not means no
   * later run ever looks at it again — later runs re-read only the settling
   * window — so the zero becomes the permanent answer. Stopping here costs a
   * re-read of a period already recorded, and re-emitting a message REPLACES
   * its ledger row, so the correct figure lands the moment the bill does.
   *
   * `null` when nothing is owed: the window priced whole, or the billing
   * question could not be answered at all and holding would stall forever.
   */
  pricedThroughMs: number | null;
  /**
   * Whether this hold has gone on long enough to stop being a bet on lateness.
   *
   * Decided by the caller from `costHeldSinceMs`, which the cursor carries —
   * same shape as `sweepHadGap`, and for the same reason: a hold with no way to
   * expire starves the thing it is protecting.
   */
  holdExpired: boolean;
}): number {
  if (!complete) return previousMs;
  const swept = sweepStartedAtMs - WATERMARK_LAG_MS;
  const pending = oldestPendingMs === null ? swept : Math.min(swept, oldestPendingMs - 1);
  // At, not just short of: `pricedThroughMs` is the END of the last period read
  // whole, so everything up to and including that instant has its cost.
  //
  // Only while the hold is still worth honouring. `holdExpired` is decided by
  // how LONG the watermark has been held, not by how far back it sits: a first
  // sweep starts thirty days behind and that is not a stall, whereas the same
  // instant refused for a week running is.
  const capped =
    pricedThroughMs === null || holdExpired ? pending : Math.min(pending, pricedThroughMs);
  // Never backwards. An unsettled message always sits above the previous
  // watermark (it passed that filter to be read at all), so this only guards
  // the arithmetic, but a watermark that could move back would re-read forever.
  //
  // It also absorbs the case where NOTHING priced: the cost read starts at or
  // below the watermark, so its ceiling lands under `previousMs` and the
  // watermark simply holds.
  return Math.max(previousMs, capped);
}

/**
 * Where a read with no position yet starts: the configured instant, or the
 * last 30 days. Shared by the watermark's first run and the paid bill read's
 * first run, so switching the bill read on late still reads the same history
 * the source was told to begin at.
 */
export function configuredSinceMs({
  config,
  nowMs,
}: {
  config: DatabricksGeniePullConfig;
  nowMs: number;
}): number {
  const sinceMs = config.startingAt ? toEpochMs(config.startingAt) : defaultSinceMs(nowMs);
  return Number.isFinite(sinceMs) ? sinceMs : defaultSinceMs(nowMs);
}

/** A first run with no configured watermark reads the last 30 days. */
function defaultSinceMs(nowMs: number): number {
  return nowMs - 30 * 24 * 60 * 60 * 1000;
}

export function encodeGenieCursor(cursor: GenieCursor): string {
  return JSON.stringify(cursor);
}

/**
 * The cursor one run hands to the next.
 *
 * The whole in-flight/finished distinction lives here: a sweep that still owes
 * a space keeps its position, its anchor and its gap flag; a sweep that is done
 * drops all three so the next run starts clean.
 */
export function nextCursor({
  previous,
  sweep,
  sweepStartedAtMs,
  pricedThroughMs,
  paidBillWindow,
  nowMs,
}: {
  previous: GenieCursor;
  sweep: SweepResult;
  sweepStartedAtMs: number;
  /** Where cost knowledge ran out this run — see `nextWatermark`. */
  pricedThroughMs: number | null;
  /**
   * What the paid bill read did this run, or null when it asked about no
   * window. Its own position — see the cursor field — so it is folded on its
   * own and nowhere near `sinceMs` or the cost hold.
   */
  paidBillWindow: PaidGenieBillOutcome["window"];
  /** This run's clock, for ageing both holds. */
  nowMs: number;
}): GenieCursor {
  // `sweep.hadGap` is already sweep-scoped — it was seeded from this cursor —
  // so there is nothing to fold here. One name, one meaning, one place it
  // accumulates.
  const stillSweeping = sweep.resumeSpaceId !== null;

  // The hold starts the first run that owes a ceiling and survives across runs
  // that keep owing one; any run that prices its window whole clears it, so a
  // billing table that recovers costs nothing and the clock does not carry over
  // to the next thing that goes wrong.
  const costHeldSinceMs = pricedThroughMs === null ? null : (previous.costHeldSinceMs ?? nowMs);
  const holdExpired =
    costHeldSinceMs !== null && nowMs - costHeldSinceMs > WAREHOUSE_COST_MAX_HOLD_MS;

  return {
    // A sweep that walked past something it never read is not whole, no matter
    // how tidily it finished. Holding the window costs a re-read of the same
    // period next sweep; advancing it would drop whatever was in the hole,
    // permanently.
    sinceMs: nextWatermark({
      previousMs: previous.sinceMs,
      sweepStartedAtMs,
      complete: sweep.complete && !sweep.hadGap,
      oldestPendingMs: sweep.oldestPendingMs,
      pricedThroughMs,
      holdExpired,
    }),
    spaceId: sweep.resumeSpaceId,
    // Meaningless without a space to resume into, so it is cleared with it
    // rather than left behind to be matched against some later sweep's space
    // by accident.
    conversationId: stillSweeping ? sweep.resumeConversationId : null,
    // Carried only while the sweep is still in flight; a finished sweep starts
    // the next one clean.
    sweepHadGap: stillSweeping ? sweep.hadGap : false,
    // Pinned to the position; a finished sweep starts the next one clean.
    spaceSetFingerprint: stillSweeping ? sweep.spaceSetFingerprint : null,
    // Carried only while the sweep is in flight. Once it finishes, the ceiling
    // has already been folded into `sinceMs` above and must not be re-applied.
    sweepOldestPendingMs: stillSweeping ? sweep.oldestPendingMs : null,
    // Held only while the sweep is still in flight, so the next run stamps a
    // fresh anchor rather than inheriting a stale one and re-reading forever.
    sweepStartedAtMs: stillSweeping ? sweepStartedAtMs : null,
    // Cleared once expired as well as once priced: the watermark has already
    // moved past the period, so leaving the stamp would expire every subsequent
    // hold on arrival and the retry would never work again.
    costHeldSinceMs: holdExpired ? null : costHeldSinceMs,
    // The bill read's own position and hold, folded here and nowhere near
    // `sinceMs` or the cost hold above.
    ...nextPaidBillPosition({
      previous,
      paidBillWindow,
      nowMs,
    }),
  };
}

/**
 * The paid bill read's position and hold for the next run.
 *
 * The hold is aged the same way as the cost hold, on its own stamp. A run that
 * asked about no window — the read is off, or on with no warehouse — clears
 * it: the source is not waiting on a bill, and a stamp left running against a
 * misconfiguration would expire the hold the moment the source was fixed.
 * Once expired, the position moves to the end of the window this run asked
 * about — the rows in it stay unrecorded, with no amount — and the stamp is
 * cleared so the next hold ages from its own start.
 *
 * The position never moves backwards: a run that asked about no window leaves
 * it exactly where the last run that did put it. A held read writes its floor
 * too — that is the whole point of the hold — and the max keeps the settling
 * look-back from walking the floor backwards a run at a time.
 */
function nextPaidBillPosition({
  previous,
  paidBillWindow,
  nowMs,
}: {
  previous: GenieCursor;
  paidBillWindow: PaidGenieBillOutcome["window"];
  nowMs: number;
}): Pick<GenieCursor, "paidBillReadThroughMs" | "paidBillHeldSinceMs"> {
  if (paidBillWindow === null) {
    return {
      paidBillReadThroughMs: previous.paidBillReadThroughMs,
      paidBillHeldSinceMs: null,
    };
  }
  const heldSinceMs = paidBillWindow.held ? (previous.paidBillHeldSinceMs ?? nowMs) : null;
  const expired = heldSinceMs !== null && nowMs - heldSinceMs > WAREHOUSE_COST_MAX_HOLD_MS;
  const readThroughMs = expired ? paidBillWindow.endMs : paidBillWindow.readThroughMs;
  return {
    paidBillReadThroughMs: Math.max(previous.paidBillReadThroughMs ?? 0, readThroughMs),
    paidBillHeldSinceMs: expired ? null : heldSinceMs,
  };
}
