import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../trace-processing/schemas/constants";
import {
  isSpanReceivedEvent,
  type TraceProcessingEvent,
} from "../../trace-processing/schemas/events";
import type { ContributeSpanFactsCommandData } from "../schemas/commands";
import {
  CODING_AGENT_CONTRIBUTION_KEYS,
  detectCodingAgent,
  resolveConversationKey,
} from "../services/coding-agent-normalization";
import { CODING_AGENT_SPAN_NAMES } from "../services/coding-agent-session.derivation";

/**
 * The span→session dispatcher (ADR-056 §2): a subscriber on
 * trace-processing's stored `span_received` events that lifts a coding-agent
 * span's facts and contributes them to its session.
 *
 * The gate runs on the RAW span name before any decoding: every span in the
 * project flows past here, and normalizing one runs the whole
 * canonicalisation registry. One set lookup keeps an ordinary chat trace's
 * cost at zero. Origin gating is exactly this predicate — no gate reactor
 * (ADR-056 §3).
 */
export function createCodingAgentSpanFactsDispatchSubscriber(deps: {
  contributeSpanFacts: (data: ContributeSpanFactsCommandData) => Promise<void>;
}): EventSubscriberDefinition<TraceProcessingEvent> {
  const normalization = new SpanNormalizationPipelineService(
    new CanonicalizeSpanAttributesService(),
  );

  return {
    name: "codingAgentSpanFactsDispatch",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    options: {
      deduplication: {
        makeId: (event) => {
          const spanId =
            isSpanReceivedEvent(event) && typeof event.data.span.spanId === "string"
              ? event.data.span.spanId
              : String(event.aggregateId);
          return `coding-agent-span-facts:${event.tenantId}:${spanId}`;
        },
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      if (!isSpanReceivedEvent(event)) return;
      const rawName = (event.data.span as { name?: unknown } | undefined)?.name;
      if (typeof rawName !== "string" || !CODING_AGENT_SPAN_NAMES.has(rawName)) {
        return;
      }

      const span = normalization.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );

      const sessionKey = resolveConversationKey(span.spanAttributes);
      const facts = liftSpanFacts(span.spanAttributes);
      const serviceVersion = span.resourceAttributes["service.version"];
      if (typeof serviceVersion === "string" && serviceVersion.length > 0) {
        facts["service.version"] = serviceVersion;
      }

      await deps.contributeSpanFacts({
        tenantId: event.tenantId,
        sessionId: sessionKey ?? span.traceId,
        sessionKeySource: sessionKey !== null ? "provider" : "trace_fallback",
        agent: detectCodingAgent({
          recordName: span.name,
          scopeName: span.instrumentationScope.name,
        }),
        occurredAt: event.occurredAt,
        traceId: span.traceId,
        spanId: span.spanId,
        name: span.name,
        startTimeUnixMs: span.startTimeUnixMs,
        endTimeUnixMs: span.endTimeUnixMs,
        statusCode: span.statusCode ?? 0,
        facts,
        scopeName: span.instrumentationScope.name || null,
      });
    },
  };
}

/** The scalar coding-agent vocabulary off one span's attributes. */
function liftSpanFacts(
  attrs: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const facts: Record<string, string | number | boolean> = {};
  for (const key of CODING_AGENT_CONTRIBUTION_KEYS) {
    const value = attrs[key];
    if (
      (typeof value === "string" && value.length > 0) ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      facts[key] = value;
    }
  }
  return facts;
}
