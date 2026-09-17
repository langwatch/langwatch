import {
  type ContributeSpanFactsCommandData,
  parseSpanFactsLiftedPayload,
  type SpanFactsLiftedPayload,
  spanFactsLiftedPayloadSchema,
  SPAN_FACTS_LIFTED_PAYLOAD_TYPE,
  SPAN_FACTS_LIFTED_PAYLOAD_VERSION_LATEST,
  CODING_AGENT_CONTRIBUTION_KEYS,
  detectCodingAgent,
  resolveSpanConversationKey,
} from "@langwatch/coding-agent-contract";
import type { EventSubscriberDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  isSpanReceivedEvent,
  type NormalizedSpan,
  parseSpanReferencedPayload,
  SPAN_RECEIVED_EVENT_TYPE,
  type SpanReceivedEvent,
  type SpanReferencedPayload,
  type TraceProcessingEvent,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type { CodingAgentTraceProcessor } from "../app/coding-agent.members.ts";
import { CodingAgentSessionSpanProjection } from "./coding-agent-session-span.projection.ts";

const logger = createLogger("langwatch:coding-agent-processing:span-facts-dispatch");
const codingAgentSpanGateSchema = z.object({
  data: z.object({
    span: z.object({ name: z.string() }).passthrough(),
    instrumentationScope: z.object({ name: z.string().optional() }).passthrough().nullish(),
  }),
});
const readableSpanBodySchema = z.object({
  span: z.object({}).passthrough(),
});
const stagedTypeSchema = z.object({ type: z.unknown() });
const dedupDataSchema = z
  .object({
    spanId: z.string().optional(),
    span: z.object({ spanId: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/**
 * Dispatches admitted coding-agent spans as bounded session facts (ADR-056/069). The
 * enqueue filter prevents unrelated spans from creating jobs; new jobs carry lifted facts
 * and need no racing store read. Legacy payloads remain readable so queued work drains.
 */
export function createCodingAgentSpanFactsDispatchSubscriber(deps: {
  contributeSpanFacts: (data: ContributeSpanFactsCommandData) => Promise<void>;
  traces: CodingAgentTraceProcessor;
}): EventSubscriberDefinition<TraceProcessingEvent> {
  const normalization = deps.traces;

  /**
   * The raw-name gate: `CodingAgentSessionSpanProjection.admits` is a set lookup for the
   * firehose; only a bare DECLARED name (codex's `session_task.turn`) additionally asks the
   * scope, so a foreign span reusing that name never mints a session.
   */
  const isCodingAgentSpan = (event: TraceProcessingEvent): event is SpanReceivedEvent => {
    if (!isSpanReceivedEvent(event)) return false;
    const parsed = codingAgentSpanGateSchema.safeParse(event);
    if (!parsed.success) return false;

    const rawName = parsed.data.data.span.name;
    const rawScope = parsed.data.data.instrumentationScope?.name;
    return CodingAgentSessionSpanProjection.admits({
      name: rawName,
      scopeName: rawScope ?? null,
    });
  };

  return {
    name: "codingAgentSpanFactsDispatch",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
    options: {
      enqueue: {
        filter: isCodingAgentSpan,
        // `filter` has already established a coding-agent span_received event.
        // The stage hook lifts that span's facts HERE, so the job carries its
        // own finished result and the handler reads nothing back.
        stage: (event) =>
          isCodingAgentSpan(event) ? makeSpanFactsLiftedPayload({ event, normalization }) : event,
      },
      // The lifted derivation resolves without touching the span store, so there is no
      // sibling write left to debounce past. The delay stays for the residual full-event
      // fallback, which normalizes in its own lane and spreads bursts across the dedup window.
      delay: 2_000,
      deduplication: {
        makeId: (event) => {
          const { tenantId, aggregateId, spanId } = dedupIdentity(event);
          // aggregateId is the trace id — span ids are only unique WITHIN a trace, so the key
          // needs both, or two traces' spans could collide inside the TTL and drop facts. All
          // three staged shapes expose the same RAW id, or fall back to the event id alike.
          return `coding-agent-span-facts:${tenantId}:${aggregateId}:${spanId}`;
        },
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      // Staged bounded derivation: the facts already rode in on the job, so
      // there is nothing to read back and nothing to race.
      const lifted = parseSpanFactsLiftedPayload(event);
      if (lifted) {
        await deps.contributeSpanFacts({
          ...lifted.data,
          // The envelope's tenant is the one the scheduler grouped and routed
          // this job by, so it stays authoritative over the staged body. They
          // are identical by construction; pinning it means a malformed
          // payload cannot contribute across tenants.
          tenantId: lifted.tenantId,
        });
        return;
      }

      // Claim-check: still the shape this build stages, and the shape earlier
      // releases staged. Resolve it through the span store.
      const ref = parseSpanReferencedPayload(event);
      if (ref) {
        await deps.contributeSpanFacts(await resolveClaimCheck(ref, deps));
        return;
      }

      // Neither staged shape — the remaining one is a whole event.
      await handleFullEvent({
        event,
        normalization,
        isCodingAgentSpan,
        contributeSpanFacts: deps.contributeSpanFacts,
      });
    },
  };
}

/** Check payload body readability without full parse (avoid blocked-group issue). */
function hasReadableSpanBody(event: SpanReceivedEvent): boolean {
  return readableSpanBodySchema.safeParse(event.data).success;
}

/**
 * The full-event path: a job carrying the whole `span_received`, staged by a pre-derivation
 * release or a seam that could not lift the span. Split out of `handle` so that function
 * stays what it reads as — a dispatcher over the three staged shapes.
 */
async function handleFullEvent({
  event,
  normalization,
  isCodingAgentSpan,
  contributeSpanFacts,
}: {
  event: TraceProcessingEvent;
  normalization: CodingAgentTraceProcessor;
  isCodingAgentSpan: (event: TraceProcessingEvent) => event is SpanReceivedEvent;
  contributeSpanFacts: (data: ContributeSpanFactsCommandData) => Promise<void>;
}): Promise<void> {
  // Before treating this as a full event, establish that it IS one: an unreadable payload
  // type is likely a newer worker mid-rollout, and completing here would silently drop that
  // span's facts. Refusing it is what makes the deploy-order rule enforceable (ADR-069).
  if (!isSpanReceivedEvent(event)) {
    const parsedType = stagedTypeSchema.safeParse(event);
    const stagedType = parsedType.success ? parsedType.data.type : void 0;
    throw new Error(
      `codingAgentSpanFactsDispatch cannot read staged payload of type "${String(stagedType)}"; refusing it into the queue's retry rather than completing it. A newer build likely staged it — drain with a build that knows the shape.`,
    );
  }

  // The type says `span_received`, so read the body before the name gate answers for it: a
  // body with no span object would reach the gate's "declined" answer for the wrong reason —
  // unreadable, not declined. Can't fire for a job this seam minted (filter already found a
  // span name on `data.span`), so an absent span means an unknown payload origin.
  if (!hasReadableSpanBody(event)) {
    throw new Error(
      `codingAgentSpanFactsDispatch cannot read the staged "span_received" body (trace ${String(event.aggregateId)}): no span object on it. Refusing it into the queue's retry rather than completing it.`,
    );
  }

  // A span_received carrying a readable span this subscriber declines is a
  // legitimate quiet completion, not an unreadable shape — a build that
  // poisons the queue with every ordinary span is worse than the loss this
  // refusal prevents.
  if (!isCodingAgentSpan(event)) return;

  const span = normalizeOrReport({ event, normalization });
  if (span === null) return;

  await contributeSpanFacts(
    liftContribution({
      span,
      tenantId: event.tenantId,
      occurredAt: event.occurredAt,
    }),
  );
}

/** Normalize span or report failure; completes quietly to avoid blocked-group loss. */
function normalizeOrReport({
  event,
  normalization,
}: {
  event: SpanReceivedEvent;
  normalization: CodingAgentTraceProcessor;
}): NormalizedSpan | null {
  try {
    return normalization.normalizeSpan({
      tenantId: event.tenantId,
      span: event.data.span,
      resource: event.data.resource,
      instrumentationScope: event.data.instrumentationScope,
    });
  } catch (error) {
    logger.error(
      {
        tenantId: String(event.tenantId),
        traceId: String(event.aggregateId),
        error: error instanceof Error ? error.message : String(error),
      },
      "codingAgentSpanFactsDispatch: span body failed normalization; completing without contributing rather than blocking the trace's group",
    );
    return null;
  }
}

/** Lift span facts at routing seam (bounded derivation); stages full event as fallback. */
function makeSpanFactsLiftedPayload({
  event,
  normalization,
}: {
  event: SpanReceivedEvent;
  normalization: CodingAgentTraceProcessor;
}): SpanFactsLiftedPayload | SpanReceivedEvent {
  let data: ContributeSpanFactsCommandData;
  try {
    const span = normalization.normalizeSpan({
      tenantId: event.tenantId,
      span: event.data.span,
      resource: event.data.resource,
      instrumentationScope: event.data.instrumentationScope,
    });
    data = liftContribution({
      span,
      tenantId: event.tenantId,
      occurredAt: event.occurredAt,
    });
  } catch {
    return event;
  }

  const candidate = {
    id: event.id,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: event.tenantId,
    createdAt: event.createdAt,
    occurredAt: event.occurredAt,
    type: SPAN_FACTS_LIFTED_PAYLOAD_TYPE,
    version: SPAN_FACTS_LIFTED_PAYLOAD_VERSION_LATEST,
    data,
    metadata: event.metadata,
  };
  const parsed = spanFactsLiftedPayloadSchema.safeParse(candidate);
  return parsed.success ? parsed.data : event;
}

/**
 * Resolves a `span_referenced` claim-check through the span store and lifts its
 * facts. R2 stopped producing references; the path stays so the ones already
 * staged in Redis drain.
 */
async function resolveClaimCheck(
  ref: SpanReferencedPayload,
  deps: { traces: CodingAgentTraceProcessor },
): Promise<ContributeSpanFactsCommandData> {
  const span = await deps.traces.findNormalizedSpan({
    tenantId: ref.tenantId,
    traceId: ref.data.traceId,
    spanId: ref.data.spanId,
    // Center the store's partition window on the span's OWN start (the stored
    // row's StartTime is this exact value), not on ingest time: a span that ran
    // longer than the window and exported on end would otherwise sit
    // permanently outside an occurredAt-centered read and exhaust its retries
    // into a blocked group.
    occurredAtMs: ref.data.startTimeUnixMs ?? ref.occurredAt,
  });
  if (span === null) {
    // The reference raced the sibling span write, or that write never landed. Throwing is
    // the contract: the queue retries with backoff (JOB_RETRY_CONFIG: 25 attempts, ~2h27m),
    // then parks the per-trace group in `:blocked` and stops — not "retries until it lands".
    throw new Error(
      `Referenced span is not readable in the span store (trace ${ref.data.traceId}, span ${ref.data.spanId}). Retrying on the shared job budget; once that is exhausted this group blocks and stops. A group that blocks here means the span's spanStorage write never landed — investigate that write, not this subscriber.`,
    );
  }
  return liftContribution({
    span,
    tenantId: ref.tenantId,
    occurredAt: ref.occurredAt,
  });
}

/**
 * The facts lift off one canonical span — shared verbatim by the claim-check
 * path (span read back from the store) and the full-event path (span
 * normalized inline), so both produce the identical command.
 */
function liftContribution({
  span,
  tenantId,
  occurredAt,
}: {
  span: NormalizedSpan;
  tenantId: string;
  occurredAt: number;
}): ContributeSpanFactsCommandData {
  const agent = detectCodingAgent({
    recordName: span.name,
    scopeName: span.instrumentationScope.name,
    // The agent registry (#6103) landed after this branch was cut. Cowork
    // emits Claude Code's event vocabulary, so the resource service name is
    // the only signal separating them — omit it and every Cowork session is
    // misidentified as Claude Code.
    serviceName:
      typeof span.resourceAttributes["service.name"] === "string"
        ? span.resourceAttributes["service.name"]
        : null,
  });
  // Through the AGENT's own reading first: codex's turn span carries the
  // turn id under the shared candidate key and the session under thread.id,
  // so the shared order alone would split each turn into its own session.
  const sessionKey = resolveSpanConversationKey({
    agent,
    name: span.name,
    attrs: span.spanAttributes,
  });
  const facts = liftSpanFacts(span.spanAttributes);
  const serviceVersion = span.resourceAttributes["service.version"];
  if (typeof serviceVersion === "string" && serviceVersion.length > 0) {
    facts["service.version"] = serviceVersion;
  } else if (
    // The store read-back deserializes numeric-looking versions ("1.0",
    // "2024") as numbers — keep the fact instead of silently dropping it on
    // the claim-check path only.
    typeof serviceVersion === "number" &&
    Number.isFinite(serviceVersion)
  ) {
    facts["service.version"] = String(serviceVersion);
  }

  return {
    tenantId,
    sessionId: sessionKey ?? span.traceId,
    sessionKeySource: sessionKey !== null ? "provider" : "trace_fallback",
    agent,
    occurredAt,
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    startTimeUnixMs: span.startTimeUnixMs,
    endTimeUnixMs: span.endTimeUnixMs,
    statusCode: span.statusCode ?? 0,
    facts,
    scopeName: span.instrumentationScope.name || null,
  };
}

/** Dedup identity; uses correlation id fallback for id-less spans. */
function dedupIdentity(payload: TraceProcessingEvent): {
  tenantId: string;
  aggregateId: string;
  spanId: string;
} {
  const base = {
    tenantId: String(payload.tenantId),
    aggregateId: String(payload.aggregateId),
  };
  const parsed = dedupDataSchema.safeParse(payload.data);
  if (parsed.success) {
    const direct = parsed.data.spanId;
    if (direct && direct.length > 0) {
      // span_referenced / span_facts_lifted: the raw wire span id sits on the
      // staged body itself, at the same path in both.
      return { ...base, spanId: direct };
    }
    const nested = parsed.data.span?.spanId;
    if (nested && nested.length > 0) {
      // span_received: the raw wire span id inside the OTLP payload.
      return { ...base, spanId: nested };
    }
  }
  // The `evt:` prefix can never collide with a wire span id, which is hex.
  return { ...base, spanId: `evt:${String(payload.id)}` };
}

/** The scalar coding-agent vocabulary off one span's attributes. */
function liftSpanFacts(attrs: Record<string, unknown>): Record<string, string | number | boolean> {
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
