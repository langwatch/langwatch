import {
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEvent,
  type PulledUsageRetractedEvent,
} from "@langwatch/enterprise-governance-contract";
import type { Event, ProcessManagerApplier } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { computeNextRunAt, Temporal } from "@langwatch/time";

import type { CostRollupDayComparer } from "../app/governance.members.ts";
import {
  COST_ROLLUP_WATCH_MAX_ATTEMPTS,
  CostRollupWatchIntent,
  compareCostRollupDaySchema,
} from "./cost-rollup-watch.intent.ts";

const logger = createLogger("langwatch:governance:cost-rollup:watch");

/** The registered process name. Instance, inbox and outbox rows key on it. */
export const COST_ROLLUP_WATCH_PROCESS_NAME = "costRollupWatch" as const;

/**
 * A cron rather than a period: the check is a wall-clock appointment —
 * "04:23 UTC", not "24 hours after whatever armed it". Only the instant on
 * the process instance is ever written.
 */
const COST_ROLLUP_WATCH_CRON = "23 4 * * *";
const COST_ROLLUP_WATCH_TIMEZONE = "UTC";

/** The widest moment an instant can state, so a wilder number is refused. */
const EPOCH_MS_LIMIT = 8.64e15;

export interface CostRollupWatchState {
  /** UTC `YYYY-MM-DD`, in the order they were first marked. Set semantics. */
  pendingDays: string[];
  /**
   * Duplicates the instance's own `nextWakeAt` on purpose: a handler that
   * cannot read the armed moment out of its own state would re-arm on every
   * charge, and it makes "days marked with nothing armed" a state a test can find.
   */
  armedAt: number | null;
  /**
   * Days ever newly marked, never reset — not even by a check. Part of what
   * identifies a comparison request: a redelivered wake carries the same
   * count and stays a repeat; a new mark moves it and asks a new question.
   */
  marks: number;
}

const INITIAL_COST_ROLLUP_WATCH_STATE: CostRollupWatchState = {
  pendingDays: [],
  armedAt: null,
  marks: 0,
};

/**
 * The UTC day a charge falls on, or null when it carries no moment anyone
 * can name. A day derived from garbage would sit on the pending list
 * permanently, compared against a summary holding nothing, forever.
 */
function findChargeDay(occurredAtMs: unknown): string | null {
  const isNameableMoment =
    typeof occurredAtMs === "number" &&
    Number.isInteger(occurredAtMs) &&
    Math.abs(occurredAtMs) <= EPOCH_MS_LIMIT;
  if (!isNameableMoment) return null;
  return Temporal.Instant.fromEpochMilliseconds(occurredAtMs).toString().slice(0, 10);
}

/** The next check slot strictly after `after`. */
export function nextCostRollupCheckAt(after: number): number {
  return computeNextRunAt({
    cron: COST_ROLLUP_WATCH_CRON,
    timezone: COST_ROLLUP_WATCH_TIMEZONE,
    after: Temporal.Instant.fromEpochMilliseconds(after),
  }).epochMilliseconds;
}

/**
 * The slot comes from WALL CLOCK, never the charge's own moment — a booking
 * date days ahead would otherwise silence the organization until then. An
 * already-overdue check is kept as is; re-arming would push it out a night.
 */
function markCostRollupDay({
  state,
  occurredAtMs,
  now,
}: {
  state: CostRollupWatchState;
  occurredAtMs: unknown;
  now: number;
}): CostRollupWatchState {
  const day = findChargeDay(occurredAtMs);
  if (day === null) {
    logger.warn(
      { occurredAtMs },
      "pulled charge carries no usable moment; no day is marked for the cost drift check",
    );
    return state;
  }
  // Stored state is read back exactly as written rather than merged over the
  // initial state, so a field added to this shape arrives as `undefined` on
  // every instance that predates it.
  const pendingDays = state.pendingDays ?? [];
  const marks = state.marks ?? 0;
  const isNewDay = !pendingDays.includes(day);
  return {
    pendingDays: isNewDay ? [...pendingDays, day] : pendingDays,
    armedAt: state.armedAt ?? nextCostRollupCheckAt(now),
    marks: isNewDay ? marks + 1 : marks,
  };
}

type PulledUsageChargeEvent =
  | (PulledUsageObservedEvent & Event)
  | (PulledUsageRetractedEvent & Event);

/**
 * The daily cost drift check, driven by the charges instead of by a clock
 * (ADR-128). One instance per ORGANIZATION via `keyBy`; it never repairs
 * anything, only counts and logs drift as the outbox ladder's verdict.
 */
export class CostRollupWatchProcess {
  private constructor(
    private readonly comparer: CostRollupDayComparer,
    private readonly intent: CostRollupWatchIntent,
  ) {}

  static create(comparer: CostRollupDayComparer): CostRollupWatchProcess {
    return new CostRollupWatchProcess(comparer, CostRollupWatchIntent.create(comparer));
  }

  processManager(): ProcessManagerApplier<PulledUsageChargeEvent> {
    const mark = (
      state: CostRollupWatchState,
      data: { occurredAtMs?: unknown } | null,
      now: number,
    ) => {
      const next = markCostRollupDay({ state, occurredAtMs: data?.occurredAtMs, now });
      return { state: next, nextWakeAt: next.armedAt };
    };

    return (process) =>
      process
        .state<CostRollupWatchState>(INITIAL_COST_ROLLUP_WATCH_STATE)
        .intent("compareDay", compareCostRollupDaySchema, (payload, context) =>
          this.intent.execute(payload, { attempt: context.attempt }),
        )
        .on(PULLED_USAGE_EVENT_TYPES.OBSERVED, (state, data, context) =>
          mark(state, data, context.now),
        )
        // A retraction dates the day it CORRECTS, and may arrive before the
        // observation it answers — separate streams. Marking handles that
        // without noticing, because a day is a day either way.
        .on(PULLED_USAGE_EVENT_TYPES.RETRACTED, (state, data, context) =>
          mark(state, data, context.now),
        )
        .onWake((state, context) => ({
          // Emptied of its days, but the mark counter is carried over: a
          // counter that started over at every check would hand the next
          // re-mark the key this wake just used.
          state: {
            ...INITIAL_COST_ROLLUP_WATCH_STATE,
            marks: state.marks ?? 0,
          },
          nextWakeAt: null,
          // The slot and the counter are both part of the key: the slot so a
          // redelivery of THIS wake is a repeat while a day marked again next
          // week is a new question, the counter so a re-mark inside one slot
          // does not collide with the request made here.
          intents: (state.pendingDays ?? []).map((day) =>
            context.intents.compareDay(`compare:${day}:${context.at}:${state.marks ?? 0}`, {
              tenantId: context.projectId,
              day,
              costSource: this.comparer.costSource,
            }),
          ),
        }))
        .keyBy((event) => `tenant:${event.tenantId}`)
        // The content boundary: the process needs the moment and nothing else,
        // and a value that is not a finite number is narrowed to null here
        // rather than written into state and read back as garbage.
        .toPayload((event) => {
          const occurredAtMs = (event.data as { occurredAtMs?: unknown } | null)?.occurredAtMs;
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
          // short enough that a night's checks finish inside the night.
          retryDelayMs: ({ attempt }) => Math.min(30_000 * 2 ** (attempt - 1), 600_000),
        });
  }
}
