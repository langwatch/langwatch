import { createHash } from "node:crypto";
import type {
  EvolveStep,
  HandlerContext,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { computeScheduledFor } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import {
  type automationsEvents,
  type MatchRecordedData,
  triggerActionClassSchema,
} from "./events";
import { isTerminalDispatchError } from "./intentDispatch";

const logger = createLogger("langwatch:automations:trigger-settlement");

/** An effect fires once a trace's activity has converged, never on the raw
 *  observation of a match — delivery order is best effort, so firing per
 *  observation would notify once per span instead of once per settled trace. */
export const TRIGGER_SETTLEMENT_PROCESS_NAME = "triggerSettlement" as const;

/** A trace-storm bound. Overflow never drops a match — the oldest pending
 *  matches dispatch ahead of their settle boundary instead. */
export const MAX_PENDING_MATCHES = 1_000;

export const triggerSettlementStateSchema = z.object({
  pendingMatches: z.record(
    z.object({
      /** The instant after which continuing activity for the trace opens a NEW
       *  round instead of re-arming this one. */
      settleDueAt: z.number(),
      /** Equal to `settleDueAt` for a persist or immediate-cadence notify,
       *  snapped to the next cadence-window boundary for a digest notify. */
      dispatchDueAt: z.number(),
      actionClass: triggerActionClassSchema,
      settleWindowBucket: z.string(),
    }),
  ),
  /** Matches flushed early because the pending set hit its cap. Overflow never
   *  discards customer matches — it dispatches them ahead of their settle
   *  boundary instead (degraded batching, no loss). Also what a redelivered
   *  `logOverflow` intent collapses on: the counter, never the trace-id set,
   *  because two overflow rounds can evict the identical set of traces. */
  overflowFlushed: z.number().int().nonnegative(),
});
export type TriggerSettlementState = z.infer<
  typeof triggerSettlementStateSchema
>;
export type PendingMatch = TriggerSettlementState["pendingMatches"][string];

export function initTriggerSettlementState(): TriggerSettlementState {
  return { pendingMatches: {}, overflowFlushed: 0 };
}

/**
 * The identity of one round of trace activity (ADR-098 decision 4). Derived
 * from the event's own instant, never from wall-clock at handling time, so a
 * redelivery names the same round and its persist intent collapses on the
 * outbox instead of writing the customer's match twice.
 */
function settleWindowBucket({
  occurredAt,
  traceDebounceMs,
}: {
  occurredAt: number;
  traceDebounceMs: number;
}): string {
  const width = Math.max(traceDebounceMs, 1);
  return `${traceDebounceMs}-${Math.floor(occurredAt / width)}`;
}

/** The earliest instant anything pending is due, or `null` when nothing is. */
export function settleBoundary(state: TriggerSettlementState): number | null {
  let next: number | null = null;
  for (const match of Object.values(state.pendingMatches)) {
    if (next === null || match.dispatchDueAt < next) next = match.dispatchDueAt;
  }
  return next;
}

/** The window is stamped from the event; only the schedule clamps to the
 *  present, so a match delivered late wakes now rather than arming a past
 *  instant. */
function nextWake(state: TriggerSettlementState, now: number): number | null {
  const boundary = settleBoundary(state);
  return boundary === null ? null : Math.max(boundary, now);
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
 * Records one match, re-arming (not appending to) the trace's settle window: a
 * second match for a pending trace moves its due times later, because it is
 * the same round continuing. Every field derives from `occurredAt` and the
 * match's own config, so re-applying one event is a no-op.
 *
 * Past `MAX_PENDING_MATCHES` the oldest matches are evicted and returned as
 * `flushed` for the caller to dispatch immediately — degraded batching under a
 * trace storm, never data loss.
 */
export function addPending(
  previousState: TriggerSettlementState,
  data: MatchRecordedData,
  occurredAt: number,
): {
  state: TriggerSettlementState;
  flushed: Array<{ traceId: string; match: PendingMatch }>;
} {
  const settleDueAt = occurredAt + data.traceDebounceMs;
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
        occurredAt,
        traceDebounceMs: data.traceDebounceMs,
      }),
    },
  };

  const flushed: Array<{ traceId: string; match: PendingMatch }> = [];
  const traceIds = Object.keys(pendingMatches);
  if (traceIds.length > MAX_PENDING_MATCHES) {
    // Ties break on the trace id: insertion order is not durable state, so an
    // eviction that fell back on it would evict a different match depending on
    // the order the same set of events arrived in.
    const oldestFirst = traceIds.sort((left, right) => {
      const bySettleDueAt =
        pendingMatches[left]!.settleDueAt - pendingMatches[right]!.settleDueAt;
      if (bySettleDueAt !== 0) return bySettleDueAt;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    for (const traceId of oldestFirst.slice(
      0,
      traceIds.length - MAX_PENDING_MATCHES,
    )) {
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

/**
 * Splits the pending set at `at`: notify-class matches sharing a
 * `dispatchDueAt` coalesce into one digest, persist-class matches stay
 * independent, everything not yet due stays pending.
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

  const nextState: TriggerSettlementState = {
    ...state,
    pendingMatches: remaining,
  };
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

// ---- intents ----

export const notifyDigestPayloadSchema = z.object({
  triggerId: z.string().min(1),
  traceIds: z.array(z.string().min(1)).min(1),
  boundary: z.number().int().positive(),
});
export type NotifyDigestPayload = z.infer<typeof notifyDigestPayloadSchema>;

export const persistMatchPayloadSchema = z.object({
  triggerId: z.string().min(1),
  traceId: z.string().min(1),
  settleWindowBucket: z.string().min(1),
});
export type PersistMatchPayload = z.infer<typeof persistMatchPayloadSchema>;

export const logOverflowPayloadSchema = z.object({
  triggerId: z.string().min(1),
  traceIds: z.array(z.string().min(1)).min(1),
  flushed: z.number().int().positive(),
  totalFlushed: z.number().int().positive(),
});
export type LogOverflowPayload = z.infer<typeof logOverflowPayloadSchema>;

type WithTenant<T> = T & { readonly tenantId: string };

/**
 * What `triggerSettlement`'s handlers call out to: one port per QUESTION the
 * control flow needs answered, not one per channel. Provider selection,
 * templates, caps and suppression live behind `sendNotifyDigest` /
 * `runPersistAction`, in `app-layer/automations/*` — reaching into those from
 * here is the sideways coupling ADR-102 decision 5 rules out.
 */
export interface TriggerDispatchPorts {
  /** A trigger deleted or deactivated after its match was recorded drops its
   *  pending dispatch rather than failing. */
  triggerIsActive(
    params: WithTenant<Pick<PersistMatchPayload, "triggerId">>,
  ): Promise<boolean>;

  /**
   * Re-confirms a settled match still satisfies the trigger's conditions at
   * dispatch time. Three outcomes because "we cannot tell yet" and "we know it
   * fails" need opposite handling: `"trace-not-settled"` is a retryable gap in
   * the trace fold, `"filters-failed"` is a terminal, silent drop.
   */
  confirmSettledMatch(
    params: WithTenant<Pick<PersistMatchPayload, "triggerId" | "traceId">>,
  ): Promise<"confirmed" | "trace-not-settled" | "filters-failed">;

  /** At-most-once gate independent of the outbox's own dedup: the outbox
   *  collapses a RETRY of one intent, this collapses two DIFFERENT intents
   *  (two settle rounds for one trace) that would otherwise both fire. */
  isSendClaimed(
    params: WithTenant<Pick<PersistMatchPayload, "triggerId" | "traceId">>,
  ): Promise<boolean>;

  /** Written AFTER a successful send — writing it first would make a retry of
   *  a failed send silently no-op. */
  claimSend(
    params: WithTenant<Pick<PersistMatchPayload, "triggerId" | "traceId">>,
  ): Promise<void>;

  /** Throws `TerminalDispatchError` for an outcome that must not retry;
   *  anything else thrown retries on the outbox's budget. */
  sendNotifyDigest(
    params: WithTenant<Pick<NotifyDigestPayload, "triggerId" | "traceIds">>,
  ): Promise<void>;

  /** Runs the persist-class action for one confirmed, unclaimed trace. Same
   *  retry contract as `sendNotifyDigest`. */
  runPersistAction(
    params: WithTenant<Pick<PersistMatchPayload, "triggerId" | "traceId">>,
  ): Promise<void>;
}

async function confirmAndFilterCandidates({
  ports,
  tenantId,
  triggerId,
  traceIds,
}: {
  ports: TriggerDispatchPorts;
  tenantId: string;
  triggerId: string;
  traceIds: readonly string[];
}): Promise<string[]> {
  const candidates: string[] = [];
  for (const traceId of new Set(traceIds)) {
    const outcome = await ports.confirmSettledMatch({
      tenantId,
      triggerId,
      traceId,
    });
    if (outcome === "trace-not-settled") {
      // Not "this match fails" — "we cannot yet tell". Throwing hands the job
      // back to the outbox; dropping it here is indistinguishable from a real
      // filter failure.
      throw new Error(
        `trace ${traceId} not settled yet for trigger ${triggerId} dispatch`,
      );
    }
    if (outcome === "filters-failed") continue;
    if (await ports.isSendClaimed({ tenantId, triggerId, traceId })) continue;
    candidates.push(traceId);
  }
  return candidates;
}

async function claimAll({
  ports,
  tenantId,
  triggerId,
  traceIds,
}: {
  ports: TriggerDispatchPorts;
  tenantId: string;
  triggerId: string;
  traceIds: readonly string[];
}): Promise<void> {
  // Best-effort: the sends already happened, so a claim-write failure must not
  // throw — that would retry the whole intent and double-send every surviving
  // trace.
  for (const traceId of traceIds) {
    try {
      await ports.claimSend({ tenantId, triggerId, traceId });
    } catch (error) {
      logger.warn(
        {
          tenantId,
          triggerId,
          traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "claimSend failed after a successful dispatch — swallowing to avoid a double-send on retry",
      );
    }
  }
}

function createNotifyDigestIntent(
  ports: TriggerDispatchPorts,
): IntentDef<typeof notifyDigestPayloadSchema> {
  return {
    payload: notifyDigestPayloadSchema,
    messageKey: (payload) =>
      `digest:${payload.boundary}:${digestBatchKey(payload.traceIds)}`,
    async deliver(payload, ctx: HandlerContext) {
      const tenantId = ctx.tenantId;
      if (
        !(await ports.triggerIsActive({
          tenantId,
          triggerId: payload.triggerId,
        }))
      ) {
        logger.info(
          { tenantId, triggerId: payload.triggerId },
          "Trigger gone or deactivated since match — dropping digest",
        );
        return;
      }

      const candidates = await confirmAndFilterCandidates({
        ports,
        tenantId,
        triggerId: payload.triggerId,
        traceIds: payload.traceIds,
      });
      if (candidates.length === 0) {
        logger.debug(
          {
            tenantId,
            triggerId: payload.triggerId,
            batchSize: payload.traceIds.length,
          },
          "Digest fully suppressed (filters / prior claims) — no dispatch",
        );
        return;
      }

      try {
        await ports.sendNotifyDigest({
          tenantId,
          triggerId: payload.triggerId,
          traceIds: candidates,
        });
      } catch (error) {
        if (isTerminalDispatchError(error)) {
          logger.info(
            { tenantId, triggerId: payload.triggerId, reason: error.message },
            "Notify digest dropped as terminal — not retried",
          );
          return;
        }
        logger.error(
          {
            tenantId,
            triggerId: payload.triggerId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Notify digest dispatch failed — retrying",
        );
        throw error;
      }

      await claimAll({
        ports,
        tenantId,
        triggerId: payload.triggerId,
        traceIds: candidates,
      });
    },
  };
}

/** One settled trace runs its persist action independently of every other
 *  pending match — batching would defeat "every match is the intent". */
function createPersistMatchIntent(
  ports: TriggerDispatchPorts,
): IntentDef<typeof persistMatchPayloadSchema> {
  return {
    payload: persistMatchPayloadSchema,
    messageKey: (payload) =>
      `persist:${payload.traceId}:${payload.settleWindowBucket}`,
    async deliver(payload, ctx: HandlerContext) {
      const tenantId = ctx.tenantId;
      if (
        !(await ports.triggerIsActive({
          tenantId,
          triggerId: payload.triggerId,
        }))
      ) {
        logger.info(
          { tenantId, triggerId: payload.triggerId, traceId: payload.traceId },
          "Trigger gone or deactivated since match — dropping persist dispatch",
        );
        return;
      }
      if (
        await ports.isSendClaimed({
          tenantId,
          triggerId: payload.triggerId,
          traceId: payload.traceId,
        })
      ) {
        return;
      }

      const outcome = await ports.confirmSettledMatch({
        tenantId,
        triggerId: payload.triggerId,
        traceId: payload.traceId,
      });
      if (outcome === "trace-not-settled") {
        throw new Error(
          `trace ${payload.traceId} not settled yet for trigger ${payload.triggerId} persist dispatch`,
        );
      }
      if (outcome === "filters-failed") return;

      try {
        await ports.runPersistAction({
          tenantId,
          triggerId: payload.triggerId,
          traceId: payload.traceId,
        });
      } catch (error) {
        if (isTerminalDispatchError(error)) {
          logger.info(
            {
              tenantId,
              triggerId: payload.triggerId,
              traceId: payload.traceId,
              reason: error.message,
            },
            "Persist dispatch dropped as terminal — not retried",
          );
          return;
        }
        logger.error(
          {
            tenantId,
            triggerId: payload.triggerId,
            traceId: payload.traceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Persist dispatch failed — retrying",
        );
        throw error;
      }

      await claimAll({
        ports,
        tenantId,
        triggerId: payload.triggerId,
        traceIds: [payload.traceId],
      });
    },
  };
}

/** Records a bounded-state flush after the fact — never from the pure step,
 *  which must stay a function of its inputs alone. */
function createLogOverflowIntent(): IntentDef<typeof logOverflowPayloadSchema> {
  return {
    payload: logOverflowPayloadSchema,
    // The cumulative counter, never a hash of the trace-id set: two overflow
    // rounds can evict the identical set of traces, and each is its own
    // occurrence worth logging.
    messageKey: (payload) => `overflow:${payload.totalFlushed}`,
    async deliver(payload) {
      logger.warn(
        {
          triggerId: payload.triggerId,
          flushed: payload.flushed,
          totalFlushed: payload.totalFlushed,
        },
        "Trigger settlement pending-match bound flushed oldest matches to immediate dispatch",
      );
    },
  };
}

export function triggerSettlementIntents(ports: TriggerDispatchPorts) {
  return {
    notifyDigest: createNotifyDigestIntent(ports),
    persistMatch: createPersistMatchIntent(ports),
    logOverflow: createLogOverflowIntent(),
  };
}

type TriggerSettlementIntents = ReturnType<typeof triggerSettlementIntents>;

/**
 * The one `matchRecorded` handler. Pure — every field derives from the event
 * and the process's own state, never from a collaborator, so redelivery is
 * safe by construction (ADR-098 decision 5).
 */
export const triggerSettlementOn: ProcessManagerHandlerMap<
  typeof automationsEvents,
  TriggerSettlementState,
  TriggerSettlementIntents
> = {
  matchRecorded(
    state,
    data,
    ctx: ProcessContext,
  ): EvolveStep<TriggerSettlementState, TriggerSettlementIntents> {
    const { state: nextState, flushed } = addPending(state, data, ctx.now);
    if (flushed.length === 0) {
      return {
        state: nextState,
        intents: [],
        nextWakeAt: nextWake(nextState, ctx.now),
      };
    }

    // The cap was hit: the oldest matches dispatch now rather than being
    // discarded.
    return {
      state: nextState,
      intents: [
        ...flushed.map(({ traceId, match }) =>
          match.actionClass === "persist"
            ? {
                type: "persistMatch" as const,
                payload: {
                  triggerId: ctx.processKey,
                  traceId,
                  settleWindowBucket: match.settleWindowBucket,
                },
              }
            : {
                type: "notifyDigest" as const,
                payload: {
                  triggerId: ctx.processKey,
                  traceIds: [traceId],
                  boundary: match.dispatchDueAt,
                },
              },
        ),
        {
          type: "logOverflow" as const,
          payload: {
            triggerId: ctx.processKey,
            traceIds: flushed.map(({ traceId }) => traceId),
            flushed: flushed.length,
            totalFlushed: nextState.overflowFlushed,
          },
        },
      ],
      nextWakeAt: nextWake(nextState, ctx.now),
    };
  },
};

/** A wake delivered late drains what is due NOW, not what was due when the
 *  wake was armed. */
export function triggerSettlementOnWake(
  state: TriggerSettlementState,
  ctx: ProcessContext,
): EvolveStep<TriggerSettlementState, TriggerSettlementIntents> {
  const due = drainDue(state, ctx.now);
  return {
    state: due.state,
    intents: [
      ...due.boundaries.map((boundary) => ({
        type: "notifyDigest" as const,
        payload: {
          triggerId: ctx.processKey,
          traceIds: boundary.traceIds,
          boundary: boundary.key,
        },
      })),
      ...due.settledMatches.map((match) => ({
        type: "persistMatch" as const,
        payload: {
          triggerId: ctx.processKey,
          traceId: match.traceId,
          settleWindowBucket: match.settleWindowBucket,
        },
      })),
    ],
    nextWakeAt: nextWake(due.state, ctx.now),
  };
}
