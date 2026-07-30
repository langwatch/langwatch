import { createHash } from "node:crypto";
import { computeScheduledFor } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { MatchRecordedData } from "../aggregate";
import { settleWindowBucket } from "../settleWindow";
import { defineProcessManager, type EventStep, type WakeStep } from "./defineProcessManager";
import {
  INITIAL_TRIGGER_SETTLEMENT_STATE,
  MAX_PENDING_MATCHES,
  type PendingMatch,
  triggerSettlementIntentSchemas,
  triggerSettlementStateSchema,
  type TriggerSettlementState,
} from "./triggerSettlement.types";

export { MAX_PENDING_MATCHES };

/**
 * `triggerSettlement`: the durable, at-least-once process manager that turns
 * matched-trace activity into settled dispatches (ADR-098 decision 1). This
 * is where the settle window actually does its job — an effect fires once a
 * trace's activity has *converged*, never on the raw observation of a match,
 * because delivery order on the dispatch plane is best effort (ADR-098
 * decision 4) and firing per-observation would notify once per span instead
 * of once per settled trace.
 *
 * Everything below is a pure function of `(state, input, ctx)`. That is
 * deliberate, not incidental: a process manager's durability comes from its
 * STATE being persisted and its INTENTS being dispatched at-least-once by
 * the executor, neither of which this file does (`defineProcessManager.ts`
 * explains why no executor lives here yet). What this file guarantees on
 * its own is the property a pure function can guarantee: given the same
 * state and the same input, it always computes the same next state and the
 * same intents, so replaying a delivery — which at-least-once delivery
 * guarantees will eventually happen — is always safe.
 */

export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;

type Intents = typeof triggerSettlementIntentSchemas;

function nextWakeFrom(state: TriggerSettlementState): number | null {
  let next: number | null = null;
  for (const match of Object.values(state.pendingMatches)) {
    if (next === null || match.dispatchDueAt < next) next = match.dispatchDueAt;
  }
  return next;
}

/** A match evicted from the pending set by `MAX_PENDING_MATCHES`, flushed to
 *  immediate dispatch rather than discarded. */
export interface OverflowFlush {
  readonly traceId: string;
  readonly match: PendingMatch;
}

/**
 * Records one match into the pending set, re-arming (not appending to) the
 * trace's settle window — a second match for a trace already pending simply
 * moves its due times later, because it is the SAME round continuing, not a
 * second one starting.
 *
 * When the pending set exceeds `MAX_PENDING_MATCHES`, the oldest matches
 * (by `settleDueAt`) are evicted and returned as `flushed` for the caller to
 * schedule as immediate dispatch — degraded batching under a trace storm,
 * never data loss.
 */
export function addPending(
  previousState: TriggerSettlementState,
  data: MatchRecordedData,
  at: number,
): { state: TriggerSettlementState; flushed: OverflowFlush[] } {
  const settleDueAt = at + data.traceDebounceMs;
  const dispatchDueAt = computeScheduledFor({
    action: data.action,
    cadence: data.notificationCadence,
    now: new Date(settleDueAt),
  }).getTime();

  const pendingMatches: Record<string, PendingMatch> = {
    ...previousState.pendingMatches,
    [data.traceId]: {
      settleDueAt,
      dispatchDueAt,
      actionClass: data.actionClass,
      settleWindowBucket: settleWindowBucket({
        occurredAt: at,
        traceDebounceMs: data.traceDebounceMs,
      }),
    },
  };

  const flushed: OverflowFlush[] = [];
  const traceIds = Object.keys(pendingMatches);
  if (traceIds.length > MAX_PENDING_MATCHES) {
    const oldestFirst = traceIds.sort(
      (left, right) =>
        pendingMatches[left]!.settleDueAt - pendingMatches[right]!.settleDueAt,
    );
    for (const traceId of oldestFirst.slice(0, traceIds.length - MAX_PENDING_MATCHES)) {
      flushed.push({ traceId, match: pendingMatches[traceId]! });
      delete pendingMatches[traceId];
    }
  }

  return {
    state: {
      pendingMatches,
      overflowFlushed: previousState.overflowFlushed + flushed.length,
    },
    flushed,
  };
}

/** The process's own next-wake computation, exposed standalone so callers
 *  (and tests) can ask "what is due next" without re-deriving it. */
export function settleBoundary(state: TriggerSettlementState): number | null {
  return nextWakeFrom(state);
}

/** A stable, order-independent key for a coalesced digest batch — the same
 *  set of trace ids always names the same digest, regardless of which order
 *  they were recorded in. */
export function digestBatchKey(traceIds: readonly string[]): string {
  return createHash("sha256").update(traceIds.join("\0")).digest("hex").slice(0, 16);
}

interface DrainOutcome {
  readonly state: TriggerSettlementState;
  readonly boundaries: ReadonlyArray<{ key: number; traceIds: readonly string[] }>;
  readonly settledMatches: ReadonlyArray<{
    traceId: string;
    settleWindowBucket: string;
  }>;
  readonly nextBoundary: number | null;
}

/**
 * Splits the pending set at `at`: everything due is removed and grouped —
 * notify-class matches coalesced by shared `dispatchDueAt` boundary into one
 * digest each, persist-class matches kept independent (ADR-026: persist
 * actions always fire immediately and individually, never batched, because
 * batching would defeat "every match is the intent"). Everything not yet due
 * stays pending.
 */
export function drainDue(state: TriggerSettlementState, at: number): DrainOutcome {
  const remaining: Record<string, PendingMatch> = {};
  const notifyByBoundary = new Map<number, string[]>();
  const settledMatches: Array<{ traceId: string; settleWindowBucket: string }> = [];

  for (const [traceId, match] of Object.entries(state.pendingMatches)) {
    if (match.dispatchDueAt > at) {
      remaining[traceId] = match;
      continue;
    }
    if (match.actionClass === "persist") {
      settledMatches.push({ traceId, settleWindowBucket: match.settleWindowBucket });
      continue;
    }
    const traceIds = notifyByBoundary.get(match.dispatchDueAt) ?? [];
    traceIds.push(traceId);
    notifyByBoundary.set(match.dispatchDueAt, traceIds);
  }

  const nextState: TriggerSettlementState = { ...state, pendingMatches: remaining };
  return {
    state: nextState,
    boundaries: Array.from(notifyByBoundary, ([key, traceIds]) => ({
      key,
      traceIds: traceIds.sort(),
    })),
    settledMatches,
    nextBoundary: nextWakeFrom(nextState),
  };
}

/**
 * The event step: a `matchRecorded` event either opens a new pending round
 * for its trace or re-arms the one already running.
 *
 * Scheduling from `max(ctx.at, ctx.now)` rather than `ctx.at` alone matters
 * here specifically: a match delivered late (a backlog draining, a
 * redelivery arriving after some delay) must still schedule its debounce
 * and cadence boundary from "now", not from a past instant — otherwise
 * `computeScheduledFor` returns a due time already behind the present and
 * every backlogged match dispatches immediately as its own singleton,
 * defeating the coalescing the settle window exists to provide.
 */
export const evolveTriggerMatchRecorded: EventStep<
  TriggerSettlementState,
  MatchRecordedData,
  Intents
> = (state, data, ctx) => {
  const handledAt = Math.max(ctx.at, ctx.now);
  const { state: nextState, flushed } = addPending(state, data, handledAt);

  if (flushed.length === 0) {
    return { state: nextState, nextWakeAt: settleBoundary(nextState) };
  }

  // The cap was hit: the oldest matches dispatch NOW instead of being
  // discarded — degraded batching under extreme load, never loss.
  return {
    state: nextState,
    intents: [
      ...flushed.map(({ traceId, match }) =>
        match.actionClass === "persist"
          ? ctx.intents.persistMatch(`persist:${traceId}:${match.settleWindowBucket}`, {
              triggerId: ctx.key,
              traceId,
            })
          : ctx.intents.notifyDigest(
              `digest:${match.dispatchDueAt}:${digestBatchKey([traceId])}`,
              { triggerId: ctx.key, traceIds: [traceId], boundary: match.dispatchDueAt },
            ),
      ),
      ctx.intents.logOverflow(`overflow:${nextState.overflowFlushed}`, {
        triggerId: ctx.key,
        flushed: flushed.length,
        totalFlushed: nextState.overflowFlushed,
      }),
    ],
    nextWakeAt: settleBoundary(nextState),
  };
};

/** The wake step: drains whatever is due at `max(ctx.at, ctx.now)` — the
 *  same late-delivery clamp as the event step, so a wake delivered late
 *  still drains what is due NOW rather than what was due when the wake was
 *  scheduled. */
export const onTriggerSettlementWake: WakeStep<TriggerSettlementState, Intents> = (
  state,
  ctx,
) => {
  const due = drainDue(state, Math.max(ctx.at, ctx.now));
  return {
    state: due.state,
    intents: [
      ...due.boundaries.map((boundary) =>
        ctx.intents.notifyDigest(
          `digest:${boundary.key}:${digestBatchKey(boundary.traceIds)}`,
          { triggerId: ctx.key, traceIds: boundary.traceIds, boundary: boundary.key },
        ),
      ),
      ...due.settledMatches.map((match) =>
        ctx.intents.persistMatch(`persist:${match.traceId}:${match.settleWindowBucket}`, {
          triggerId: ctx.key,
          traceId: match.traceId,
        }),
      ),
    ],
    nextWakeAt: due.nextBoundary,
  };
};

/**
 * The one declaration. `defineProcessManager` derives the intent
 * constructors from `triggerSettlementIntentSchemas` and threads them into
 * both steps automatically (`ctx.intents` needs no separate assembly, here
 * or in a test) — there is exactly one place this process's shape is
 * authored.
 */
export const triggerSettlementDefinition = defineProcessManager(
  TRIGGER_SETTLEMENT_PROCESS_NAME,
)
  .state(triggerSettlementStateSchema, () => INITIAL_TRIGGER_SETTLEMENT_STATE)
  .intents(triggerSettlementIntentSchemas)
  .events({ matchRecorded: evolveTriggerMatchRecorded })
  .onWake(onTriggerSettlementWake);
