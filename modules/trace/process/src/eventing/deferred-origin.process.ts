import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  isSpanReceivedEvent,
  STALE_TRACE_THRESHOLD_MS,
  type ResolveOriginCommandData,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type { DeferredOriginPayload } from "../app/trace.members.ts";

const logger = createLogger("langwatch:trace-processing:origin-gate");

export const DEFERRED_ORIGIN_CHECK_DELAY_MS = 5 * 60 * 1000;

export function needsOriginResolution({
  event,
  foldState,
}: {
  event: TraceProcessingEvent;
  foldState: TraceSummaryData;
}): boolean {
  // Only a span arrival opens the gate: a clustering pass re-emits
  // topic_assigned stamped with the current time for its whole backlog, so
  // the staleness check below never catches it and months-old traces would
  // have the deferred fallback scheduled (#8191).
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < nowInstant().epochMilliseconds - STALE_TRACE_THRESHOLD_MS) return false;
  return !foldState.attributes?.["langwatch.origin"];
}

export function createDeferredOriginHandler(
  resolveOrigin: (data: ResolveOriginCommandData) => Promise<void>,
): (payload: DeferredOriginPayload) => Promise<void> {
  return async (payload) => {
    logger.debug(
      { tenantId: payload.tenantId, traceId: payload.traceId },
      "Deferred origin resolution: dispatching resolveOrigin command",
    );
    await resolveOrigin({
      tenantId: payload.tenantId,
      traceId: payload.traceId,
      origin: "application",
      reason: "deferred_fallback",
      occurredAt: nowInstant().epochMilliseconds,
    });
  };
}

export const DEFERRED_ORIGIN_PROCESS_NAME = "deferredOriginResolution" as const;

export const resolveDeferredOriginIntentSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
  scheduledFor: z.number().int(),
});

export interface DeferredOriginState {
  /** When the fallback fires, while one is armed; null once resolved or never armed. */
  resolveAfterMs: number | null;
}

export const DEFERRED_ORIGIN_INITIAL_STATE: DeferredOriginState = { resolveAfterMs: null };

export type DeferredOriginIntents = {
  resolveDeferredOrigin: IntentSpec<typeof resolveDeferredOriginIntentSchema>;
};

/** The first unresolved span arms the fallback; later spans keep main's first deadline. */
export const onSpanReceivedArmOrigin: EventHandler<
  DeferredOriginState,
  unknown,
  DeferredOriginIntents
> = (state, _data, ctx) => {
  if (state.resolveAfterMs !== null) return { state, nextWakeAt: state.resolveAfterMs };
  if (ctx.at < ctx.now - STALE_TRACE_THRESHOLD_MS) return { state, nextWakeAt: null };
  const resolveAfterMs = Math.max(ctx.at, ctx.now) + DEFERRED_ORIGIN_CHECK_DELAY_MS;
  return { state: { resolveAfterMs }, nextWakeAt: resolveAfterMs };
};

/** A resolved origin disarms: there is nothing left to fall back from. */
export const onOriginResolvedDisarm: EventHandler<
  DeferredOriginState,
  unknown,
  DeferredOriginIntents
> = () => ({ state: DEFERRED_ORIGIN_INITIAL_STATE, nextWakeAt: null });

/** Pure; the intent re-reads the fold, so a trace whose spans named an origin sends nothing. */
export const deferredOriginWake: WakeHandler<DeferredOriginState, DeferredOriginIntents> = (
  state,
  ctx,
) => {
  if (state.resolveAfterMs === null) return { state, nextWakeAt: null };
  return {
    state: DEFERRED_ORIGIN_INITIAL_STATE,
    nextWakeAt: null,
    intents: [
      ctx.intents.resolveDeferredOrigin(`deferred-origin:${ctx.projectId}:${ctx.key}`, {
        tenantId: ctx.projectId,
        traceId: ctx.key,
        scheduledFor: state.resolveAfterMs,
      }),
    ],
  };
};
