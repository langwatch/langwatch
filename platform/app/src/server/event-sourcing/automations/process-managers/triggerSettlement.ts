import { createHash } from "node:crypto";
import { defineProcess } from "@langwatch/event-sourcing";
import { z } from "zod";
import { computeScheduledFor } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import { type MatchRecordedData, triggerAggregate } from "../aggregate";
import { settleWindowBucket } from "../settleWindow";

/**
 * `triggerSettlement`: the durable process manager that turns matched-trace
 * activity into settled dispatches (ADR-098 decision 1). An effect fires once
 * a trace's activity has converged, never on the raw observation of a match —
 * delivery order is best effort, so firing per observation would notify once
 * per span instead of once per settled trace.
 */
export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;

/** A trace-storm bound. Overflow never drops a match — the oldest pending
 *  matches dispatch ahead of their settle boundary instead. */
export const MAX_PENDING_MATCHES = 1_000;

export interface PendingMatch {
  /** When this match's settle window closes: the instant after which
   *  continuing activity for the trace opens a NEW round instead of
   *  re-arming this one. */
  readonly settleDueAt: number;
  /** When the match is due to dispatch — equal to `settleDueAt` for a persist
   *  or immediate-cadence notify action, snapped to the next cadence-window
   *  boundary for a digest notify action. */
  readonly dispatchDueAt: number;
  readonly actionClass: MatchRecordedData["actionClass"];
  /** The round's own identity (`settleWindow.ts`), so a later round for the
   *  same trace is provably a different round. */
  readonly settleWindowBucket: string;
}

export const triggerSettlementStateSchema = z.object({
  pendingMatches: z.record(
    z.object({
      settleDueAt: z.number(),
      dispatchDueAt: z.number(),
      actionClass: z.enum(["notify", "persist"]),
      settleWindowBucket: z.string(),
    }),
  ),
});
export type TriggerSettlementState = z.infer<
  typeof triggerSettlementStateSchema
>;

/** The earliest instant anything pending is due, or `null` when nothing is. */
export function settleBoundary(state: TriggerSettlementState): number | null {
  let next: number | null = null;
  for (const match of Object.values(state.pendingMatches)) {
    if (next === null || match.dispatchDueAt < next) next = match.dispatchDueAt;
  }
  return next;
}

/** A stable, order-independent name for a set of trace ids — the same set
 *  always hashes the same, whatever order it was collected in. */
export function digestBatchKey(traceIds: readonly string[]): string {
  return createHash("sha256")
    .update([...traceIds].sort().join("\0"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Records one match, re-arming (not appending to) the trace's settle window:
 * a second match for a pending trace moves its due times later, because it is
 * the same round continuing.
 *
 * Past `MAX_PENDING_MATCHES` the oldest matches are evicted and returned as
 * `flushed` for the caller to dispatch immediately — degraded batching under a
 * trace storm, never data loss.
 */
export function addPending(
  previousState: TriggerSettlementState,
  data: MatchRecordedData,
  at: number,
): {
  state: TriggerSettlementState;
  flushed: Array<{ traceId: string; match: PendingMatch }>;
} {
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

  const flushed: Array<{ traceId: string; match: PendingMatch }> = [];
  const traceIds = Object.keys(pendingMatches);
  if (traceIds.length > MAX_PENDING_MATCHES) {
    const oldestFirst = traceIds.sort(
      (left, right) =>
        pendingMatches[left]!.settleDueAt - pendingMatches[right]!.settleDueAt,
    );
    for (const traceId of oldestFirst.slice(
      0,
      traceIds.length - MAX_PENDING_MATCHES,
    )) {
      flushed.push({ traceId, match: pendingMatches[traceId]! });
      delete pendingMatches[traceId];
    }
  }

  return { state: { pendingMatches }, flushed };
}

/**
 * Splits the pending set at `at`: notify-class matches sharing a
 * `dispatchDueAt` coalesce into one digest, persist-class matches stay
 * independent (ADR-026 — every match is the intent), everything not yet due
 * stays pending.
 */
export function drainDue(state: TriggerSettlementState, at: number) {
  const remaining: Record<string, PendingMatch> = {};
  const notifyByBoundary = new Map<number, string[]>();
  const settledMatches: Array<{ traceId: string; settleWindowBucket: string }> =
    [];

  for (const [traceId, match] of Object.entries(state.pendingMatches)) {
    if (match.dispatchDueAt > at) {
      remaining[traceId] = match;
      continue;
    }
    if (match.actionClass === "persist") {
      settledMatches.push({
        traceId,
        settleWindowBucket: match.settleWindowBucket,
      });
      continue;
    }
    const traceIds = notifyByBoundary.get(match.dispatchDueAt) ?? [];
    traceIds.push(traceId);
    notifyByBoundary.set(match.dispatchDueAt, traceIds);
  }

  const nextState: TriggerSettlementState = { pendingMatches: remaining };
  return {
    state: nextState,
    boundaries: Array.from(notifyByBoundary, ([key, traceIds]) => ({
      key,
      traceIds: traceIds.sort(),
    })),
    settledMatches,
    nextBoundary: settleBoundary(nextState),
  };
}

/**
 * The one declaration. Every `messageKey` is a pure function of its own
 * payload, so a redelivery of the same logical intent always computes the
 * same key and collapses on the outbox.
 *
 * Both steps schedule from `max(ctx.at, ctx.now)`: an input delivered late (a
 * backlog draining, a redelivery) must compute its boundary from now, or
 * every backlogged match dispatches immediately as its own singleton and
 * defeats the coalescing the settle window exists for.
 */
export const triggerSettlement = defineProcess(TRIGGER_SETTLEMENT_PROCESS_NAME)
  .state(triggerSettlementStateSchema, () => ({ pendingMatches: {} }))
  .intents({
    notifyDigest: {
      payload: z.object({
        triggerId: z.string().min(1),
        traceIds: z.array(z.string().min(1)).min(1),
        boundary: z.number().int().positive(),
      }),
      messageKey: (payload) =>
        `digest:${payload.boundary}:${digestBatchKey(payload.traceIds)}`,
    },
    persistMatch: {
      payload: z.object({
        triggerId: z.string().min(1),
        traceId: z.string().min(1),
        settleWindowBucket: z.string().min(1),
      }),
      messageKey: (payload) =>
        `persist:${payload.traceId}:${payload.settleWindowBucket}`,
    },
    logOverflow: {
      payload: z.object({
        triggerId: z.string().min(1),
        traceIds: z.array(z.string().min(1)).min(1),
      }),
      messageKey: (payload) => `overflow:${digestBatchKey(payload.traceIds)}`,
    },
  })
  .on(triggerAggregate)
  .onEvents({
    matchRecorded: (state, data, intents, ctx) => {
      const { state: nextState, flushed } = addPending(
        state,
        data,
        Math.max(ctx.at, ctx.now),
      );
      if (flushed.length === 0) {
        return {
          state: nextState,
          intents: [],
          nextWakeAt: settleBoundary(nextState),
        };
      }

      // The cap was hit: the oldest matches dispatch now rather than being
      // discarded.
      return {
        state: nextState,
        intents: [
          ...flushed.map(({ traceId, match }) =>
            match.actionClass === "persist"
              ? intents.persistMatch({
                  triggerId: ctx.processKey,
                  traceId,
                  settleWindowBucket: match.settleWindowBucket,
                })
              : intents.notifyDigest({
                  triggerId: ctx.processKey,
                  traceIds: [traceId],
                  boundary: match.dispatchDueAt,
                }),
          ),
          intents.logOverflow({
            triggerId: ctx.processKey,
            traceIds: flushed.map(({ traceId }) => traceId),
          }),
        ],
        nextWakeAt: settleBoundary(nextState),
      };
    },
  })
  .onWake((state, intents, ctx) => {
    const due = drainDue(state, Math.max(ctx.at, ctx.now));
    return {
      state: due.state,
      intents: [
        ...due.boundaries.map((boundary) =>
          intents.notifyDigest({
            triggerId: ctx.processKey,
            traceIds: boundary.traceIds,
            boundary: boundary.key,
          }),
        ),
        ...due.settledMatches.map((match) =>
          intents.persistMatch({
            triggerId: ctx.processKey,
            traceId: match.traceId,
            settleWindowBucket: match.settleWindowBucket,
          }),
        ),
      ],
      nextWakeAt: due.nextBoundary,
    };
  })
  .build();

export type NotifyDigestIntent = Parameters<
  typeof triggerSettlement.intents.notifyDigest
>[0];
export type PersistMatchIntent = Parameters<
  typeof triggerSettlement.intents.persistMatch
>[0];
export type LogOverflowIntent = Parameters<
  typeof triggerSettlement.intents.logOverflow
>[0];
