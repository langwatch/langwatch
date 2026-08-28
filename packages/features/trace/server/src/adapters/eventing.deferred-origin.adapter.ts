import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  STALE_TRACE_THRESHOLD_MS,
  type ResolveOriginCommandData,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:origin-gate");

export const DEFERRED_ORIGIN_CHECK_DELAY_MS = 5 * 60 * 1000;
export const ORIGIN_GATE_DELAY_MS = 5_000;
export const ORIGIN_GATE_DEDUP_TTL_MS = 15_000;

export type DeferredOriginPayload = {
  id: string;
  tenantId: string;
  traceId: string;
};

/** The pipeline builder receives this named scheduler before its queue exists. */
export abstract class TraceDeferredOriginSchedulerPort {
  abstract schedule(payload: DeferredOriginPayload): Promise<void>;
}

export function needsOriginResolution({
  event,
  foldState,
}: {
  event: TraceProcessingEvent;
  foldState: TraceSummaryData;
}): boolean {
  if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
  return !foldState.attributes?.["langwatch.origin"];
}

export function createOriginGateHandler(
  scheduler: TraceDeferredOriginSchedulerPort,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (event, context) => {
    const { tenantId, aggregateId: traceId, state: foldState } = context;

    if (!needsOriginResolution({ event, foldState })) return;
    if (!traceId) {
      logger.warn(
        { tenantId, eventId: event.id, eventType: event.type },
        "Skipping deferred origin resolution: empty traceId on trace event",
      );
      return;
    }

    logger.debug(
      { tenantId, traceId },
      "No origin resolved, scheduling deferred origin resolution",
    );
    await scheduler.schedule({ id: traceId, tenantId, traceId });
  };
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
      occurredAt: Date.now(),
    });
  };
}

export function makeDeferredOriginJobId(payload: DeferredOriginPayload): string {
  return `deferred-origin:${payload.tenantId}:${payload.traceId}`;
}
