import type { TriggerContext } from "@langwatch/eventing";
import {
  isSpanReceivedEvent,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

import { isFirstSighting } from "../rules/trace-first-seen.rules.ts";
import type { TraceProjectMilestonesService } from "../services/trace-project-milestones.service.ts";

/** Queue name of the subscriber that records each trace's first sighting. */
export const TRACE_FIRST_SEEN_SUBSCRIBER_NAME = "traceFirstSeen" as const;

/** One job per trace: the first batch's spans share it, and none after that batch qualifies. */
export const TRACE_FIRST_SEEN_DEDUP = {
  makeId: (event: TraceProcessingEvent): string => `${event.tenantId}:${event.aggregateId}`,
  ttlMs: 60 * 60 * 1000,
  extend: false,
  replace: false,
};

/** A span from the batch that first wrote the trace's summary; later spans never qualify. */
export function isTraceFirstSighting({
  event,
  foldState,
}: {
  event: TraceProcessingEvent;
  foldState: TraceSummaryData;
}): boolean {
  if (!isSpanReceivedEvent(event)) return false;
  return isFirstSighting({
    spanAppendedAt: event.createdAt,
    summaryCreatedAt: foldState.createdAt,
  });
}

/** Records the sighting as trace's own fact, at the summary's first write. */
export function createTraceFirstSeenHandler({
  milestones,
}: {
  milestones: Pick<TraceProjectMilestonesService, "recordTraceFirstSeen">;
}): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (_event, context) => {
    await milestones.recordTraceFirstSeen({
      tenantId: context.tenantId,
      projectId: context.tenantId,
      traceId: context.aggregateId,
      firstSeenAt: context.state.createdAt,
    });
  };
}
