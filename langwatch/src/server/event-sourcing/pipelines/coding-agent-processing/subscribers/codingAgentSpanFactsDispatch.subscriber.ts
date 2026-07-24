import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { readStagedProjection } from "../../../subscribers/stagedProjection";
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
 * Under the payload-cost doctrine (ADR-069 invariant 4) the work is split
 * across the enqueue seam:
 *
 *   - `enqueue.filter` runs the RAW span-name gate before any decoding, so a
 *     span from any other trace never mints a job. Every span in the project
 *     flows past that predicate; one set lookup keeps an ordinary chat trace's
 *     cost at zero. Origin gating is exactly this predicate — no gate reactor
 *     (ADR-056 §3).
 *   - `enqueue.project` normalizes the matched span and lifts its ~20 scalar
 *     facts into the `ContributeSpanFactsCommandData` (~2KB) at fan-out, while
 *     the span is already in memory. The staged job carries that command data
 *     instead of the multi-MB raw span.
 *
 * The handler then only dispatches the command. It still recognizes a full
 * event, because a build deployed before ADR-069 staged the raw event and its
 * jobs can still be in Redis during the rollover — that path runs the gate,
 * normalization and lift inline, exactly as the handler did before.
 */
export function createCodingAgentSpanFactsDispatchSubscriber(deps: {
  contributeSpanFacts: (data: ContributeSpanFactsCommandData) => Promise<void>;
}): EventSubscriberDefinition<TraceProcessingEvent> {
  const normalization = new SpanNormalizationPipelineService(
    new CanonicalizeSpanAttributesService(),
  );

  /** The raw-name gate — the enqueue filter, and the guard for full-event jobs. */
  const isCodingAgentSpan = (
    event: TraceProcessingEvent,
  ): event is SpanReceivedEvent => {
    if (!isSpanReceivedEvent(event)) return false;
    const rawName = (event.data.span as { name?: unknown } | undefined)?.name;
    return typeof rawName === "string" && CODING_AGENT_SPAN_NAMES.has(rawName);
  };

  /**
   * Normalize a matched coding-agent span and lift its facts into the command
   * data. Runs as `enqueue.project` at the seam AND inline for full-event jobs,
   * so both shapes produce byte-for-byte the same command.
   */
  const liftContribution = (
    event: SpanReceivedEvent,
  ): ContributeSpanFactsCommandData => {
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

    return {
      tenantId: event.tenantId,
      sessionId: sessionKey ?? span.traceId,
      sessionKeySource: sessionKey !== null ? "provider" : "trace_fallback",
      agent: detectCodingAgent({
        recordName: span.name,
        scopeName: span.instrumentationScope.name,
        // Added by the agent registry (#6103) after this helper was written:
        // Cowork emits Claude Code's event vocabulary, so the service name is
        // the only signal that separates them. Dropping it silently
        // misidentifies every Cowork session as Claude Code.
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
    };
  };

  return {
    name: "codingAgentSpanFactsDispatch",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    options: {
      enqueue: {
        filter: isCodingAgentSpan,
        // `filter` has already established a coding-agent span_received event.
        project: (event) => liftContribution(event as SpanReceivedEvent),
      },
      deduplication: {
        makeId: (event) => {
          const { tenantId, aggregateId, spanId } = dedupIdentity(event);
          // aggregateId is the trace id — span ids are only unique WITHIN a
          // trace, so the key needs both or two traces' spans can collide
          // inside the TTL and silently drop facts. Format and TTL are
          // preserved from ADR-056; the span id is the canonical span id (the
          // command's `spanId` for a staged projection, the raw wire id for a
          // pre-upgrade full event).
          return `coding-agent-span-facts:${tenantId}:${aggregateId}:${spanId}`;
        },
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      // Freshly staged job: carries the lifted command (ADR-069). Dispatch it.
      const projected =
        readStagedProjection<ContributeSpanFactsCommandData>(event);
      if (projected) {
        await deps.contributeSpanFacts(projected);
        return;
      }

      // Pre-upgrade job or synchronous full-event dispatch: run the gate,
      // normalization and lift inline — identical to the pre-ADR-069 handler.
      if (!isCodingAgentSpan(event)) return;
      await deps.contributeSpanFacts(liftContribution(event));
    },
  };
}

/**
 * The dedup identity for a span job, read from either staged shape. The raw
 * event exposes the wire span id; the staged envelope exposes the routing
 * metadata at the top level and the (canonical) span id inside the projection.
 */
function dedupIdentity(payload: unknown): {
  tenantId: unknown;
  aggregateId: string;
  spanId: string;
} {
  const projected = readStagedProjection<ContributeSpanFactsCommandData>(
    payload,
  );
  if (projected) {
    const envelope = payload as { tenantId: unknown; aggregateId: unknown };
    return {
      tenantId: envelope.tenantId,
      aggregateId: String(envelope.aggregateId),
      spanId: typeof projected.spanId === "string" ? projected.spanId : "",
    };
  }

  const event = payload as TraceProcessingEvent;
  const spanId =
    isSpanReceivedEvent(event) && typeof event.data.span.spanId === "string"
      ? event.data.span.spanId
      : "";
  return {
    tenantId: event.tenantId,
    aggregateId: String(event.aggregateId),
    spanId,
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
