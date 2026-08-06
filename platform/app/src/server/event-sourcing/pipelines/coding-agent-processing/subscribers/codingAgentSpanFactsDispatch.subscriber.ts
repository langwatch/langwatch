import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../trace-processing/schemas/constants";
import {
  isSpanReceivedEvent,
  makeSpanReferencedEvent,
  parseSpanReferencedEvent,
  type SpanReceivedEvent,
  type SpanReferencedEvent,
  type TraceProcessingEvent,
} from "../../trace-processing/schemas/events";
import type { NormalizedSpan } from "../../trace-processing/schemas/spans";
import type { ContributeSpanFactsCommandData } from "../schemas/commands";
import { parseSpanFactsLiftedEvent } from "../schemas/events";
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
 * Payload-cost shape (ADR-069):
 *
 *   - `enqueue.filter` runs the RAW span-name gate at the fan-out seam, so a
 *     span from any other trace never mints a job. Every span in the project
 *     flows past that predicate; one set lookup keeps an ordinary chat trace's
 *     cost at zero. Origin gating is exactly this predicate — no gate reactor
 *     (ADR-056 §3).
 *   - A `span_facts_lifted` job carries a bounded derivation: the facts, already
 *     lifted, on the job itself. The handler contributes them directly. Nothing
 *     is read back, so nothing races. This is the shape the seam will stage once
 *     R2 flips the producer (see the handler contract below).
 *   - A `span_referenced` claim-check carries the span's identity, not its
 *     payload, and the handler reads the canonical span back from the span
 *     store. That read races the sibling spanStorage write, which is the
 *     failure the derivation shape exists to remove: on 2026-08-05 it parked 22
 *     per-trace groups in `:blocked`. This build still STAGES it — the producer
 *     flip is R2 — and the handler keeps resolving it after that flip, so
 *     references already in Redis drain.
 *   - A full `span_received` job still processes exactly as before references
 *     existed: jobs staged by a previous release, and matched events the seam
 *     could not reference, carry the whole event, and the handler normalizes
 *     inline in its own lane.
 *
 * **Deploy order (ADR-069).** This build is the CONSUMER half: it reads
 * `span_facts_lifted` but does not stage it. The producer flip ships a release
 * later, because a worker that predates the type would otherwise complete such
 * a job silently. Anything this build cannot read at all now throws instead of
 * returning, so the next crossing of this boundary fails as a retry rather than
 * as a silent loss.
 */
export function createCodingAgentSpanFactsDispatchSubscriber(deps: {
  contributeSpanFacts: (data: ContributeSpanFactsCommandData) => Promise<void>;
  getNormalizedSpanById: (params: {
    tenantId: string;
    traceId: string;
    spanId: string;
    /** Required: the store read has no unbounded fallback to widen into. */
    occurredAtMs: number;
  }) => Promise<NormalizedSpan | null>;
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
      enqueue: {
        filter: isCodingAgentSpan,
        // `filter` has already established a coding-agent span_received
        // event; the stage hook is a total field-pick that swaps the staged
        // payload for its claim-check (or returns the event unchanged when
        // the span has no id to reference).
        stage: (event) => makeSpanReferencedEvent(event as SpanReceivedEvent),
      },
      // Debounce past the spanStorage sibling write: the reference resolves
      // against the span store, and both jobs are staged by the same fan-out.
      // Two seconds puts the first attempt after that write in the common
      // case; the queue's backoff covers the tail.
      delay: 2_000,
      deduplication: {
        makeId: (event) => {
          const { tenantId, aggregateId, spanId } = dedupIdentity(event);
          // aggregateId is the trace id — span ids are only unique WITHIN a
          // trace, so the key needs both or two traces' spans can collide
          // inside the TTL and silently drop facts. When the span carries a
          // wire id, all three staged shapes expose that same RAW id, so the
          // key is identical across both upgrades; when it carries none, the
          // key falls back to the event id (see `dedupIdentity`), which every
          // shape also shares.
          return `coding-agent-span-facts:${tenantId}:${aggregateId}:${spanId}`;
        },
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      // Staged bounded derivation: the facts already rode in on the job, so
      // there is nothing to read back and nothing to race.
      const lifted = parseSpanFactsLiftedEvent(event);
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
      const ref = parseSpanReferencedEvent(event);
      if (ref) {
        await deps.contributeSpanFacts(await resolveClaimCheck(ref, deps));
        return;
      }

      // Neither staged shape. Before treating this as a full event, establish
      // that it IS one: a payload of some other type is a shape this build
      // cannot read — almost certainly staged by a newer worker mid-rollout —
      // and returning here would COMPLETE the job with no throw, no retry and
      // no counter, silently dropping that span's facts. Refusing it is the
      // whole reason the deploy-order rule is enforceable (ADR-069).
      if (!isSpanReceivedEvent(event)) {
        throw new Error(
          `codingAgentSpanFactsDispatch cannot read staged payload of type "${String((event as { type?: unknown }).type)}"; refusing it into the queue's retry rather than completing it. A newer build likely staged it — drain with a build that knows the shape.`,
        );
      }

      // Full-event job: a pre-reference release staged it, or the seam could
      // not reference the span. Gate, normalize and lift inline — identical to
      // the pre-reference handler. A span_received this subscriber declines is
      // a legitimate quiet completion, not an unreadable shape.
      if (!isCodingAgentSpan(event)) return;
      const span = normalization.normalizeSpanReceived(
        event.tenantId,
        event.data.span,
        event.data.resource,
        event.data.instrumentationScope,
      );
      await deps.contributeSpanFacts(
        liftContribution({
          span,
          tenantId: event.tenantId,
          occurredAt: event.occurredAt,
        }),
      );
    },
  };
}

/**
 * Resolves a `span_referenced` claim-check through the span store and lifts its
 * facts. R2 stops producing references; the path stays after it so the ones
 * already staged in Redis drain.
 */
async function resolveClaimCheck(
  ref: SpanReferencedEvent,
  deps: {
    getNormalizedSpanById: (params: {
      tenantId: string;
      traceId: string;
      spanId: string;
      occurredAtMs: number;
    }) => Promise<NormalizedSpan | null>;
  },
): Promise<ContributeSpanFactsCommandData> {
  const span = await deps.getNormalizedSpanById({
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
    // The reference raced the sibling span write, or that write never landed.
    // Throwing is the contract: the queue retries with backoff.
    //
    // Say what the queue actually does. The retry budget is finite
    // (JOB_RETRY_CONFIG: 25 attempts, ~2h27m), and on exhaustion the job parks
    // its per-trace group in `:blocked` and stops. A message promising retries
    // "until the write lands" read as a system still working on it, while 22
    // groups sat blocked for hours on 2026-08-05.
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
  const sessionKey = resolveConversationKey(span.spanAttributes);
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
    agent: detectCodingAgent({
      recordName: span.name,
      scopeName: span.instrumentationScope.name,
      // The agent registry (#6103) landed after this branch was cut. Cowork
      // emits Claude Code's event vocabulary, so the resource service name is
      // the only signal separating them — omit it and every Cowork session is
      // misidentified as Claude Code.
      serviceName:
        typeof span.resourceAttributes["service.name"] === "string"
          ? (span.resourceAttributes["service.name"] as string)
          : null,
    }),
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

/**
 * The dedup identity, read from either staged shape with total field picks —
 * `makeId` runs on the staging path, so it must never throw.
 *
 * A span with no usable wire id keys on the event's own CORRELATION id — the
 * envelope KSUID — instead of on an empty string. That case is real, not
 * theoretical: `makeSpanReferencedEvent` refuses to reference an id-less span
 * and stages it whole. Keying it on `""` would collapse every id-less
 * coding-agent span in a trace onto one `…:<tenant>:<trace>:` key, so the
 * second one inside the TTL would dedup away and its facts would be silently
 * dropped.
 *
 * The correlation id is the right fallback precisely because it is what ties a
 * claim-check back to the event it was lifted from: `makeSpanReferencedEvent`
 * copies `event.id` verbatim, so the key stays stable across the reference
 * upgrade while dedup degrades to per-event — the weakest form that still
 * loses nothing. The event's `idempotencyKey` is NOT usable here: it is
 * `<tenant>:<trace>:<spanId>`, which collapses on exactly the same id-less
 * spans.
 */
function dedupIdentity(payload: TraceProcessingEvent): {
  tenantId: string;
  aggregateId: string;
  spanId: string;
} {
  const base = {
    tenantId: String(payload.tenantId),
    aggregateId: String(payload.aggregateId),
  };
  const data = (payload as { data?: unknown }).data;
  if (typeof data === "object" && data !== null) {
    const direct = (data as { spanId?: unknown }).spanId;
    if (typeof direct === "string" && direct.length > 0) {
      // span_referenced / span_facts_lifted: the raw wire span id sits on the
      // staged body itself, at the same path in both.
      return { ...base, spanId: direct };
    }
    const nested = (data as { span?: { spanId?: unknown } }).span?.spanId;
    if (typeof nested === "string" && nested.length > 0) {
      // span_received: the raw wire span id inside the OTLP payload.
      return { ...base, spanId: nested };
    }
  }
  // The `evt:` prefix can never collide with a wire span id, which is hex.
  return { ...base, spanId: `evt:${String(payload.id)}` };
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
