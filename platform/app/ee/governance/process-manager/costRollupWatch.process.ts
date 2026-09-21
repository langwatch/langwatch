// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import { GOVERNANCE_COST_SOURCE } from "../projections/governanceCostRollup.constants";
import {
  COMPARED_COST_SOURCES,
  type CostRollupComparatorDayComparer,
  reportCostRollupDrift,
} from "../services/costRollupComparator.service";

const logger = createLogger("langwatch:governance:cost-rollup:watch");

/** The registered process name. Instance, inbox and outbox rows key on it. */
export const COST_ROLLUP_WATCH_PROCESS_NAME = "costRollupWatch" as const;

/**
 * How many looks one day's comparison gets before the outbox retires it.
 *
 * Named rather than inlined into `.outbox()` because the intent handler reads
 * it too: the handler has to know which look is its LAST one, since that is the
 * look whose disagreement it is willing to call drift. Two literals would let
 * the two notions of "last" drift apart silently, and the failure mode is
 * either drift that is never reported or drift reported a look early.
 *
 * The dispatcher retires a message when `attempt >= maxAttempts`
 * (`outboxDispatcherService.ts`), so attempt 5 of 5 is both the last delivery
 * and the one this must not throw from.
 */
export const COST_ROLLUP_WATCH_MAX_ATTEMPTS = 5;

/**
 * A comparison disagreed, and there are looks left, so it is not drift yet.
 *
 * Thrown to spend a rung of the outbox ladder: the ladder is the wait, and a
 * quiet return would clear the day for good — nothing marks it again once the
 * fold catches up. The alternative, reporting the disagreement on sight, is
 * what this whole design exists to avoid, because a summary the fold is
 * seconds behind on is indistinguishable from drift at the moment you look.
 *
 * The watermark check (`costRollupSummaryFreshness.ts`) can sometimes PROVE
 * the fold is behind, and when it does its count rides on the warn line. It
 * cannot prove the opposite, though — it is a maximum of provider timestamps,
 * and two charges sharing one timestamp move it not at all — so level
 * watermarks buy no confidence and this is thrown either way.
 *
 * A plain `Error`, not a `HandledError`: nothing here reaches a customer, and
 * dressing a deliberate wait up as a handled fault would promise a reader an
 * action they do not have. What an operator needs is on the warn line and the
 * lag gauge, both written before this is raised.
 */
export class CostRollupCheckUnsettledError extends Error {
  readonly day: string;
  readonly attempt: number;
  readonly mismatchCount: number;

  constructor({
    day,
    attempt,
    mismatchCount,
  }: {
    day: string;
    attempt: number;
    mismatchCount: number;
  }) {
    super(
      `Governance cost rollup for ${day} disagrees on ${mismatchCount} cell(s) after look ${attempt} of ${COST_ROLLUP_WATCH_MAX_ATTEMPTS}; looking again`,
    );
    this.name = "CostRollupCheckUnsettledError";
    this.day = day;
    this.attempt = attempt;
    this.mismatchCount = mismatchCount;
  }
}

/**
 * One look at one day, and what the look is worth.
 *
 * This is where a disagreement becomes drift, or does not. It reads the
 * attempt number because that is the only thing separating the two: a fold
 * that is behind catches up between looks, and drift does not, so the answer
 * to "is this real" is "ask again" until there is nothing left to ask.
 *
 * Failures propagate so the outbox retries — a swallowed one is a check that
 * silently did not happen.
 */
async function lookAtDay({
  comparator,
  payload,
  attempt,
}: {
  comparator: CostRollupComparatorDayComparer;
  payload: CompareDayPayload;
  attempt: number;
}): Promise<void> {
  const comparison = await comparator.compareDay({
    tenantId: payload.tenantId,
    day: payload.day,
    costSource: payload.costSource,
  });

  // Two ways a look can be inconclusive, and both buy another one. The figures
  // differing is the obvious one. The other is the summary being PROVABLY mid-
  // fold while the figures happen to agree: an unfolded charge that nets to
  // nothing, or one whose cell the agreeing figures do not cover. Agreement
  // reached over a summary that is still catching up is a coincidence, not a
  // verdict, and clearing the day on it is permanent — nothing marks it again.
  const settled =
    comparison.mismatches.length === 0 && comparison.behind.length === 0;
  if (settled) return;

  if (attempt < COST_ROLLUP_WATCH_MAX_ATTEMPTS) {
    logger.warn(
      {
        tenantId: payload.tenantId,
        day: payload.day,
        cost_source: payload.costSource,
        attempt,
        of_attempts: COST_ROLLUP_WATCH_MAX_ATTEMPTS,
        mismatched_cells: comparison.mismatches.length,
        // Non-zero names the reason outright; zero alongside a mismatch means
        // the watermarks look level, which proves nothing (see the freshness
        // module) and is precisely why this waits anyway.
        cells_behind: comparison.behind.length,
        lag_ms: comparison.lagMs,
      },
      comparison.mismatches.length > 0
        ? "Governance cost rollup disagrees with its events; looking again before calling it drift"
        : "Governance cost rollup agrees with its events but has not folded all of them; looking again before trusting it",
    );
    throw new CostRollupCheckUnsettledError({
      day: payload.day,
      attempt,
      mismatchCount: comparison.mismatches.length,
    });
  }

  // The last look, and whatever it found stands. A disagreement has now
  // outlived the whole ladder, which is the only evidence available that it is
  // not the fold running behind — including the disagreement that IS a missing
  // summary row, since money on the log that never folded is exactly what the
  // counter is for. So it is named, counted, and the intent COMPLETES:
  // throwing here would retire the row as dead and file a real fault under
  // "the outbox broke", where nobody reads it.
  reportCostRollupDrift({ tenantId: payload.tenantId, comparison });

  // Waited out the ladder and the figures still agree — so the only thing left
  // is a fold that has stopped rather than one that is slow. Said once, here,
  // because this is where the day is cleared and nothing will ask about it
  // again; the lag gauge alone would not say which day went unjudged.
  if (comparison.mismatches.length === 0) {
    logger.warn(
      {
        tenantId: payload.tenantId,
        day: payload.day,
        cost_source: payload.costSource,
        cells_behind: comparison.behind.length,
        lag_ms: comparison.lagMs,
      },
      "Governance cost rollup still had not folded every charge of the day on the last look; its figures agreed and the day is being cleared on that",
    );
  }
}

/**
 * When the day's drift check falls, as a cron in UTC.
 *
 * A cron rather than a period because the check is a wall-clock appointment —
 * "04:23 UTC", not "24 hours after whatever armed it" — and `computeNextRunAt`
 * is the pure evaluator the rest of the app already computes appointments
 * with. Nothing schedules a row: the expression is a time formula here, and
 * the only thing written is the instant on the process instance.
 */
const COST_ROLLUP_WATCH_CRON = "23 4 * * *";
const COST_ROLLUP_WATCH_TIMEZONE = "UTC";

/**
 * The days this organization has charges on that have not been compared since,
 * and the moment the check that will compare them is armed for.
 *
 * `armedAt` duplicates the instance's own `nextWakeAt`, and that is not
 * redundancy: an evolution states its wake outright rather than amending one,
 * so a handler that cannot read the armed moment out of its own state has no
 * way to leave it alone and would re-arm — or disarm — on every charge. It is
 * also what makes "days marked with nothing armed" a state an assertion can
 * find, which is the only canary this design has that the wiring is alive at
 * all.
 */
export interface CostRollupWatchState {
  /** UTC `YYYY-MM-DD`, in the order they were first marked. Set semantics. */
  pendingDays: string[];
  armedAt: number | null;
  /**
   * How many days this organization has ever newly marked, counted from its
   * first charge and never reset — not even by a check. It is part of what
   * identifies a comparison request, and that is the only reason it exists.
   *
   * Two machines need not agree on the clock, and the worker that answers a
   * check can run its slot late, so a charge can carry a moment just before
   * tonight's slot and still be written after tonight's check has committed.
   * It marks the day again and arms the slot that has already gone by, so the
   * check fires again at once and asks for the same day at the same slot.
   * Identified by day and slot alone that is indistinguishable from the
   * request already made and is dropped as a repeat — exactly when the day was
   * marked again because its charges had changed. The counter separates the
   * two: a redelivery of one wake carries the same count and stays a repeat,
   * while a day marked again moves it and asks a new question.
   */
  marks: number;
}

export const INITIAL_COST_ROLLUP_WATCH_STATE: CostRollupWatchState = {
  pendingDays: [],
  armedAt: null,
  marks: 0,
};

/**
 * Every field carries what a durable outbox row needs: a payload written by
 * the previous build is read back by this one, so `costSource` defaults rather
 * than turning an older row into a permanent parse failure. The tenant and the
 * day cannot be defaulted — a comparison that guessed either would compare the
 * wrong thing and report the answer as fact.
 */
export const compareDaySchema = z.object({
  /** The org's hidden governance project — the storage partition. */
  tenantId: z.string(),
  /** UTC `YYYY-MM-DD`. */
  day: z.string(),
  costSource: z
    .enum(COMPARED_COST_SOURCES)
    .default(GOVERNANCE_COST_SOURCE.PULLED),
});
export type CompareDayPayload = z.infer<typeof compareDaySchema>;

/**
 * The UTC day a charge falls on, or null when it carries no moment anyone can
 * name.
 *
 * Refusing is the only honest option. A day derived from a missing or garbage
 * timestamp is written onto the pending list permanently — only a check clears
 * it — and every check from then on compares a day that never happened against
 * a summary that holds nothing, forever agreeing with itself.
 */
export function dayOfMs(occurredAtMs: unknown): string | null {
  if (typeof occurredAtMs !== "number" || !Number.isFinite(occurredAtMs)) {
    return null;
  }
  const date = new Date(occurredAtMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** The next check slot strictly after `after`. */
export function nextCompareWakeAt(after: number): number {
  return computeNextRunAt({
    cron: COST_ROLLUP_WATCH_CRON,
    timezone: COST_ROLLUP_WATCH_TIMEZONE,
    after: new Date(after),
  }).getTime();
}

/**
 * Marks a charge's day and makes sure a check is armed to answer it.
 *
 * The slot is computed from WALL CLOCK, never from the charge's own moment.
 * A provider's booking date can sit days ahead, and arming from that would let
 * one bad timestamp silence an organization's check until the date it names —
 * with every other day marked in the meantime waiting behind it. The opposite
 * direction is harmless and deliberate: a day dated ahead is compared tonight,
 * before it has finished happening, and a day holding one charge agrees with
 * itself.
 *
 * An already-armed check is kept exactly as it is, INCLUDING one whose moment
 * has passed. That writes a wake behind the present on purpose: the wake is
 * overdue because nothing answered it, and re-arming would push the days it
 * holds out by another night rather than getting them compared.
 *
 * The counter moves only when a day is genuinely added. A repeat of a day
 * already on the list changes nothing anyone has to ask about again, so moving
 * it there would hand a redelivered wake a key the first delivery never used.
 *
 * Stored state is read back exactly as it was written rather than merged over
 * the initial state, so every field is defaulted on the way in — a field added
 * to this shape arrives as `undefined` on every instance that predates it.
 */
function markDay(
  state: CostRollupWatchState,
  occurredAtMs: unknown,
  now: number,
): CostRollupWatchState {
  const day = dayOfMs(occurredAtMs);
  if (day === null) {
    logger.warn(
      { occurredAtMs },
      "pulled charge carries no usable moment; no day is marked for the cost drift check",
    );
    return state;
  }
  const pendingDays = state.pendingDays ?? [];
  const marks = state.marks ?? 0;
  const isNewDay = !pendingDays.includes(day);
  return {
    pendingDays: isNewDay ? [...pendingDays, day] : pendingDays,
    armedAt: state.armedAt ?? nextCompareWakeAt(now),
    marks: isNewDay ? marks + 1 : marks,
  };
}

export interface CostRollupWatchProcessDeps {
  comparator: CostRollupComparatorDayComparer;
}

/**
 * The daily cost drift check, driven by the charges instead of by a clock
 * (ADR-128).
 *
 * One instance per ORGANIZATION, not per charge: the comparison reads a whole
 * organization's day, so a check per charge would ask the same question
 * hundreds of times for one answer. That is what `keyBy` buys — and it doubles
 * as the generated subscriber's queue group, so one organization's charges
 * drain in one lane instead of fighting over the instance revision.
 *
 * It replaces a nightly job that ran for every governance organization whether
 * or not anything had happened, and compared yesterday and only yesterday. The
 * two gaps that closes are the two halves of the state: an organization that
 * spent nothing has no instance and costs nothing, and a correction dated last
 * week puts last week back on the list.
 *
 * What it deliberately does NOT do: repair anything. Finding drift counts it
 * and logs it. The summary is a consequence of the event history, so a repair
 * that only reached storage would be undone by the next rebuild and one that
 * reached the history is a restatement somebody has to stand behind.
 *
 * What counts AS finding drift is the outbox ladder, not one comparison. The
 * fold and this check run on independent queues, so at the moment of looking a
 * summary that is seconds behind and a summary that is wrong are the same
 * picture. A disagreement therefore costs a rung of the ladder instead of an
 * alert, and only one that is still there on the last rung — some seven and a
 * half minutes of looking later — is reported.
 */
export function costRollupWatchPM(
  deps: CostRollupWatchProcessDeps,
): ProcessManagerApplier<PulledUsageProcessingEvent> {
  const mark = (
    state: CostRollupWatchState,
    data: unknown,
    now: number,
  ): { state: CostRollupWatchState; nextWakeAt: number | null } => {
    const next = markDay(
      state,
      (data as { occurredAtMs?: unknown } | null)?.occurredAtMs,
      now,
    );
    return { state: next, nextWakeAt: next.armedAt };
  };

  return (pm) =>
    pm
      .state<CostRollupWatchState>(INITIAL_COST_ROLLUP_WATCH_STATE)
      .intent("compareDay", compareDaySchema, (payload, ctx) =>
        lookAtDay({
          comparator: deps.comparator,
          payload,
          attempt: ctx.attempt,
        }),
      )
      .on(PULLED_USAGE_EVENT_TYPES.OBSERVED, (state, data, ctx) =>
        mark(state, data, ctx.now),
      )
      // A retraction dates the day it CORRECTS, so it marks that day rather
      // than the day the correction arrived. It may also arrive before the
      // observation it answers — the two are separate streams — which marking
      // handles without noticing, because a day is a day either way.
      .on(PULLED_USAGE_EVENT_TYPES.RETRACTED, (state, data, ctx) =>
        mark(state, data, ctx.now),
      )
      .onWake((state, ctx) => ({
        // Emptied of its days, but the mark counter is carried over rather
        // than reset: it is what tells a day marked again apart from a
        // redelivery of this wake, and a counter that started over at every
        // check would hand the next re-mark the key this wake just used.
        state: {
          ...INITIAL_COST_ROLLUP_WATCH_STATE,
          marks: state.marks ?? 0,
        },
        nextWakeAt: null,
        // The slot and the mark counter are both part of the key. The slot so
        // a redelivery of THIS wake is recognised as a repeat while a day
        // marked again next week is a new question — keying by the day alone
        // would let tonight's record swallow next week's request, and a
        // corrected day would never be re-checked, the exact defect this whole
        // process exists to fix. The counter for the same reason inside one
        // slot: a day marked again after this wake can re-arm the slot that
        // has just passed, and without the counter its request would collide
        // with the one made here and be dropped.
        intents: (state.pendingDays ?? []).map((day) =>
          ctx.intents.compareDay(
            `compare:${day}:${ctx.at}:${state.marks ?? 0}`,
            {
              tenantId: ctx.projectId,
              day,
              costSource: GOVERNANCE_COST_SOURCE.PULLED,
            },
          ),
        ),
      }))
      .keyBy((event) => `tenant:${event.tenantId}`)
      // The content boundary: the process needs the moment and nothing else,
      // and the moment has to be JSON to be persisted at all — so a value that
      // is not a finite number is narrowed to null here and refused below,
      // rather than written into state as `NaN` and read back as garbage.
      .toPayload((event) => {
        const occurredAtMs = (event.data as { occurredAtMs?: unknown } | null)
          ?.occurredAtMs;
        return {
          occurredAtMs:
            typeof occurredAtMs === "number" && Number.isFinite(occurredAtMs)
              ? occurredAtMs
              : null,
        };
      })
      .outbox({
        maxAttempts: COST_ROLLUP_WATCH_MAX_ATTEMPTS,
        // ~30s, 1m, 2m, 4m: long enough to ride out a ClickHouse restart,
        // short enough that a night's checks finish inside the night. A
        // comparison is a read, so a slow retry costs nothing but the wait.
        retryDelayMs: ({ attempt }) =>
          Math.min(30_000 * 2 ** (attempt - 1), 600_000),
      });
}
