import type { ResolveOriginCommandData } from "../schemas/commands";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:origin-gate-reactor",
);

/** Delay (ms) before the deferred origin resolution fires */
export const DEFERRED_CHECK_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export type DeferredOriginPayload = {
  id: string;       // traceId — used as staged job ID for debuggability
  tenantId: string;
  traceId: string;
};

export interface OriginGateReactorDeps {
  scheduleDeferred: (payload: DeferredOriginPayload) => Promise<void>;
}

/**
 * Ensures every trace gets an origin resolved.
 *
 * Fires on every trace event (via traceSummary fold). If origin is already
 * set (explicit, legacy markers, or SDK heuristic), this is a no-op.
 * If absent (pure OTEL traces), schedules a 5-minute deferred origin
 * resolution job.
 *
 * Completely decoupled from evaluation dispatch — evaluationTrigger
 * handles that independently.
 */
export function createOriginGateReactor(
  deps: OriginGateReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "originGate",
    options: {
      makeJobId: (payload) =>
        `origin-gate:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 5_000,    // 5s dedup — debounce the initial span burst
      delay: 5_000,  // 5s delay — settle before checking origin
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId, foldState } = context;

      // Guard: skip old traces (resyncing)
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;

      const attrs = foldState.attributes ?? {};
      if (attrs["langwatch.origin"]) return; // origin already resolved

      // No origin — schedule deferred resolution (5-min delay)
      logger.debug(
        { tenantId, traceId },
        "No origin resolved, scheduling deferred origin resolution",
      );
      await deps.scheduleDeferred({
        id: traceId,
        tenantId,
        traceId,
      });
    },
  };
}

/**
 * Creates the deferred origin resolution handler.
 *
 * Fires after a 5-minute delay for pure OTEL traces that had no origin
 * at normal debounce time. Unconditionally dispatches a resolveOrigin
 * command with origin="application" — the command's idempotency key
 * and the fold projection's no-override guard handle duplicates.
 *
 * The resulting OriginResolvedEvent flows through:
 *   fold (sets origin if absent) → evaluationTrigger reactor → dispatchEvaluations()
 */
export function createDeferredOriginHandler(
  resolveOrigin: (data: ResolveOriginCommandData) => Promise<void>,
) {
  return async (payload: DeferredOriginPayload): Promise<void> => {
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

/** Dedup key for deferred origin resolution jobs */
export function makeDeferredJobId(payload: DeferredOriginPayload): string {
  return `deferred-origin:${payload.tenantId}:${payload.traceId}`;
}
