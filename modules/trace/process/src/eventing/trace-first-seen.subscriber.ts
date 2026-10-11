import type { TriggerContext } from "@langwatch/eventing";
import {
  isSpanReceivedEvent,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

import { isFirstSighting, isSentAsEvent } from "../rules/trace-first-seen.rules.ts";
import type { TraceCountMomentService } from "../services/trace-count-moment.service.ts";
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

/**
 * Records a new trace as trace's own event, at the summary's first write. Nothing is sent before
 * the upgrade has stored its count moment, nor for a trace first seen before it: the count has it.
 */
export function createTraceFirstSeenHandler({
  milestones,
  countMoment,
}: {
  milestones: Pick<TraceProjectMilestonesService, "recordTraceFirstSeen">;
  countMoment: Pick<TraceCountMomentService, "find">;
}): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (_event, context) => {
    const countedUntil = await countMoment.find();
    if (!isSentAsEvent({ firstSeenAt: context.state.createdAt, countedUntil })) return;
    await milestones.recordTraceFirstSeen({
      tenantId: context.tenantId,
      projectId: context.tenantId,
      traceId: context.aggregateId,
      firstSeenAt: context.state.createdAt,
    });
  };
}
