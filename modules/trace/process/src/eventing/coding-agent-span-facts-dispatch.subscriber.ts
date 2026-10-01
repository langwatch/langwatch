import {
  admitsCodingAgentSpan,
  type CodingAgentReceivedSpan,
} from "@langwatch/coding-agent-contract";
import type { EventSubscriberDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  isSpanReceivedEvent,
  type NormalizedSpan,
  SPAN_RECEIVED_EVENT_TYPE,
  type SpanReceivedEvent,
  type TraceProcessingEvent,
} from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:coding-agent-span-facts-dispatch");

export interface CodingAgentSpanFactsDispatchDeps {
  normalize: (event: SpanReceivedEvent) => NormalizedSpan;
  contributeReceivedSpan: (input: CodingAgentReceivedSpan) => Promise<void>;
}

function isCodingAgentSpan(event: TraceProcessingEvent): event is SpanReceivedEvent {
  return (
    isSpanReceivedEvent(event) &&
    admitsCodingAgentSpan({
      name: event.data.span.name,
      scopeName: event.data.instrumentationScope?.name ?? null,
    })
  );
}

/** Main's span-facts dispatch (ADR-056/069): one job per coding-agent span. */
export function createCodingAgentSpanFactsDispatchSubscriber(
  deps: CodingAgentSpanFactsDispatchDeps,
): EventSubscriberDefinition<TraceProcessingEvent> {
  return {
    name: "codingAgentSpanFactsDispatch",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    options: {
      enqueue: { filter: isCodingAgentSpan },
      delay: 2_000,
      deduplication: {
        // Span ids are unique only within a trace, so the key carries the trace too.
        makeId: (event) =>
          `coding-agent-span-facts:${String(event.tenantId)}:${String(event.aggregateId)}:${
            isSpanReceivedEvent(event) ? event.data.span.spanId : `evt:${String(event.id)}`
          }`,
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      if (!isCodingAgentSpan(event)) return;
      let span: NormalizedSpan;
      try {
        span = deps.normalize(event);
      } catch (error) {
        // Completing quietly beats blocking the trace's whole group on one unreadable span.
        logger.error(
          { tenantId: String(event.tenantId), traceId: String(event.aggregateId), error },
          "codingAgentSpanFactsDispatch: span failed normalization; completing without contributing",
        );
        return;
      }
      await deps.contributeReceivedSpan({
        tenantId: String(event.tenantId),
        occurredAt: event.occurredAt,
        span,
      });
    },
  };
}
