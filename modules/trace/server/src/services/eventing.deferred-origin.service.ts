import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  STALE_TRACE_THRESHOLD_MS,
  type ResolveOriginCommandData,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { nowInstant } from "@langwatch/time";
import type { DeferredOriginPayload, TraceDeferredOriginScheduler } from "../app/trace.infrastructure.ts";

const logger = createLogger("langwatch:trace-processing:origin-gate");

export const DEFERRED_ORIGIN_CHECK_DELAY_MS = 5 * 60 * 1000;
export const ORIGIN_GATE_DELAY_MS = 5_000;
export const ORIGIN_GATE_DEDUP_TTL_MS = 15_000;

export class TraceDeferredOriginEventingAdapter {
  static create(): TraceDeferredOriginEventingAdapter {
    return new TraceDeferredOriginEventingAdapter();
  }

  static needsOriginResolution({
    event,
    foldState,
  }: {
    event: TraceProcessingEvent;
    foldState: TraceSummaryData;
  }): boolean {
    if (event.occurredAt < nowInstant().epochMilliseconds - STALE_TRACE_THRESHOLD_MS) return false;
    return !foldState.attributes?.["langwatch.origin"];
  }

  static createOriginGateHandler(
    scheduler: TraceDeferredOriginScheduler,
  ): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
    return async (event, context) => {
      const { tenantId, aggregateId: traceId, state: foldState } = context;

      if (!TraceDeferredOriginEventingAdapter.needsOriginResolution({ event, foldState })) return;
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

  static createDeferredOriginHandler(
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

  static makeDeferredOriginJobId(payload: DeferredOriginPayload): string {
    return `deferred-origin:${payload.tenantId}:${payload.traceId}`;
  }
}
