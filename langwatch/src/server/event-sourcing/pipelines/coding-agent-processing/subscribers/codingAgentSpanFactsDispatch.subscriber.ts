import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../trace-processing/schemas/constants";
import {
  isSpanReceivedEvent,
  type SpanReceivedEvent,
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
 * The span→session dispatcher (ADR-056 §2): a subscriber on trace-processing's
 * stored `span_received` events that lifts a coding-agent span's facts and
 * contributes them to its session.
 *
 * The raw span-name gate runs twice, on purpose:
 *
 *   - as `enqueue.filter` at the fan-out seam (ADR-069 invariant 4), so a span
 *     from any other trace never mints a job. Every span in the project flows
 *     past that predicate; one set lookup keeps an ordinary chat trace's cost
 *     at zero. Origin gating is exactly this predicate — no gate reactor
 *     (ADR-056 §3).
 *   - inline in the handler, which still receives jobs staged by a build
 *     deployed before the filter existed during the rollover window.
 *
 * Normalization and fact lifting stay in the handler's own consumer lane, so a
 * span the registry cannot decode fails and retries only this subscriber's
 * job — never the shared routing dispatch.
 */
export function createCodingAgentSpanFactsDispatchSubscriber(deps: {
  contributeSpanFacts: (data: ContributeSpanFactsCommandData) => Promise<void>;
}): EventSubscriberDefinition<TraceProcessingEvent> {
  const normalization = new SpanNormalizationPipelineService(
    new CanonicalizeSpanAttributesService(),
  );

  /** The raw-name gate — the enqueue filter, and the handler's inline guard. */
  const isCodingAgentSpan = (
    event: TraceProcessingEvent,
  ): event is SpanReceivedEvent => {
    if (!isSpanReceivedEvent(event)) return false;
    const rawName = (event.data.span as { name?: unknown } | undefined)?.name;
    return typeof rawName === "string" && CODING_AGENT_SPAN_NAMES.has(rawName);
  };

  return {
    name: "codingAgentSpanFactsDispatch",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    options: {
      enqueue: { filter: isCodingAgentSpan },
      deduplication: {
        makeId: (event) => {
          const spanId =
            isSpanReceivedEvent(event) &&
            typeof event.data.span.spanId === "string"
              ? event.data.span.spanId
              : "";
          // aggregateId is the trace id — span ids are only unique WITHIN a
          // trace, so the key needs both or two traces' spans can collide
          // inside the TTL and silently drop facts.
          return `coding-agent-span-facts:${event.tenantId}:${String(event.aggregateId)}:${spanId}`;
        },
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      if (!isCodingAgentSpan(event)) return;

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
          // The agent registry (#6103) landed after this branch was cut. Cowork
          // emits Claude Code's event vocabulary, so the resource service name
          // is the only signal separating them — omit it and every Cowork
          // session is misidentified as Claude Code.
          serviceName:
            typeof span.resourceAttributes["service.name"] === "string"
              ? (span.resourceAttributes["service.name"] as string)
              : null,
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
