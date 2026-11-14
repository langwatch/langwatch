/**
 * Records a trace that became failed by trace's own rule, the summary's `containsErrorStatus`
 * (span-status-fold), once per trace, so a peer counting failed traces reads one fact instead of
 * keeping a copy of the rule. Spec: modules/trace/specs/trace-failed-fact.feature
 */
import type { TriggerContext } from "@langwatch/eventing";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";

import type { TraceProjectMilestonesService } from "../services/trace-project-milestones.service.ts";

/** How long after a trace's first span, and after a span's append, a failure still records. */
export const TRACE_FAILED_WINDOW_MS = 60 * 60_000;

/**
 * One job per trace. Held for two windows: a span still inside the window is processed at most
 * one window after the trace's first span was, so every later span of the trace is squashed.
 */
export const TRACE_FAILED_DEDUP = {
  makeId: (event: Pick<TraceProcessingEvent, "tenantId" | "aggregateId">): string =>
    `trace-failed:${event.tenantId}:${event.aggregateId}`,
  ttlMs: 2 * TRACE_FAILED_WINDOW_MS,
  extend: false,
  replace: false,
  shouldSurviveDispatch: true,
};

export interface TraceFailedSubscriberDeps {
  milestones: Pick<TraceProjectMilestonesService, "recordTraceFailed">;
}

/**
 * A failed trace whose span is fresh (not a replay's or resync's re-emit) and within the window
 * of the trace's first span. The window is the only bound: trace_failed's idempotency key is
 * collapsed on read alone, so a second append still reaches every peer subscriber.
 */
export function isNewlyFailedTrace({
  event,
  state,
  now,
}: {
  event: Pick<TraceProcessingEvent, "occurredAt">;
  state: Pick<TraceSummaryData, "containsErrorStatus" | "createdAt">;
  now: number;
}): boolean {
  return (
    state.containsErrorStatus &&
    now - event.occurredAt < TRACE_FAILED_WINDOW_MS &&
    event.occurredAt - state.createdAt < TRACE_FAILED_WINDOW_MS
  );
}

/** Records trace_failed with the trace's origin; a failed send throws, so the job retries. */
export function createTraceFailedHandler(
  deps: TraceFailedSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (event, { tenantId, aggregateId, state }) => {
    const origin = state.attributes["langwatch.origin"];
    await deps.milestones.recordTraceFailed({
      tenantId,
      projectId: tenantId,
      traceId: aggregateId,
      occurredAt: event.occurredAt,
      ...(origin ? { origin } : {}),
    });
  };
}
