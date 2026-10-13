import type { Event, PeerSubscriberDefinition } from "@langwatch/eventing";
import {
  MONTH_TRACE_IDS_LISTED_EVENT_TYPE,
  monthTraceIdsListedEventDataSchema,
  SPAN_RECEIVED_EVENT_TYPE,
  spanReceivedEventDataSchema,
} from "@langwatch/trace-contract";

import type { TraceUsageService } from "../services/trace-usage.service.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";

/** Frozen once landed: the peer lanes are `entitlement.<name>`. */
export const TRACE_USAGE_SPAN_SUBSCRIBER_NAME = "traceUsageSpan";
export const TRACE_USAGE_MONTH_IDS_SUBSCRIBER_NAME = "traceUsageMonthIds";

/** How long a trace's spans settle into one job: 1 or 1,000 spans write one row. */
export const TRACE_USAGE_SETTLE_MS = 30_000;

/**
 * One debounced job per trace: each span inside the window resets it, and the job keeps the
 * window's first span, so its append time is the closest to the trace's first sighting.
 */
export const TRACE_USAGE_SPAN_OPTIONS = {
  delay: TRACE_USAGE_SETTLE_MS,
  deduplication: {
    makeId: (event: Event): string =>
      `subscriber:${TRACE_USAGE_SPAN_SUBSCRIBER_NAME}:${event.tenantId}:${event.aggregateId}`,
    ttlMs: TRACE_USAGE_SETTLE_MS,
    replace: false,
  },
};

type Recorder = Pick<TraceUsageService, "recordTraces">;

/** Reads no span field: the trace is the event's aggregate, the month its append time. */
const spanSeenDataSchema = spanReceivedEventDataSchema.pick({});

/** Trace's span event: the trace (its aggregate) in the month the span was appended. */
export function traceUsageSpanSubscriber(
  usage: Recorder,
): PeerSubscriberDefinition<typeof spanSeenDataSchema> {
  return {
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    data: spanSeenDataSchema,
    options: TRACE_USAGE_SPAN_OPTIONS,
    handle: (_data, context) =>
      usage.recordTraces({
        projectId: context.tenantId,
        month: UsageCountingService.monthOf(context.createdAt),
        traceIds: [context.aggregateId],
      }),
  };
}

/** Trace's upgrade step: a page of a project's trace ids first seen in the named month. */
export function traceUsageMonthIdsSubscriber(
  usage: Recorder,
): PeerSubscriberDefinition<typeof monthTraceIdsListedEventDataSchema> {
  return {
    eventType: MONTH_TRACE_IDS_LISTED_EVENT_TYPE,
    data: monthTraceIdsListedEventDataSchema,
    handle: (data) =>
      usage.recordTraces({ projectId: data.projectId, month: data.month, traceIds: data.traceIds }),
  };
}
