import type { EventSubscriberDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../trace-processing/schemas/constants";
import {
  isSpanReceivedEvent,
  parseSpanReferencedPayload,
  type SpanReceivedEvent,
  type SpanReferencedPayload,
  type TraceProcessingEvent,
} from "../../trace-processing/schemas/events";
import type { NormalizedSpan } from "../../trace-processing/schemas/spans";
import type { ContributeSpanFactsCommandData } from "../schemas/commands";
import {
  SPAN_FACTS_LIFTED_PAYLOAD_TYPE,
  SPAN_FACTS_LIFTED_PAYLOAD_VERSION_LATEST,
} from "../schemas/constants";
import {
  parseSpanFactsLiftedPayload,
  type SpanFactsLiftedPayload,
  spanFactsLiftedPayloadSchema,
} from "../schemas/events";
import {
  CODING_AGENT_CONTRIBUTION_KEYS,
  detectCodingAgent,
  resolveSpanConversationKey,
} from "../services/coding-agent-normalization";
import { isCodingAgentSessionSpan } from "../services/coding-agent-session.derivation";

const logger = createLogger("langwatch:coding-agent-processing:span-facts-dispatch");

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
 *     cost at zero. Origin gating is exactly this predicate — no gate subscriber
 *     (ADR-056 §3).
 *   - A `span_facts_lifted` job carries a bounded derivation: the facts, already
 *     lifted, on the job itself. The handler contributes them directly. Nothing
 *     is read back, so nothing races. **This is the shape this build STAGES**
 *     (R2 — see the deploy-order note below).
 *   - A `span_referenced` claim-check carries the span's identity, not its
 *     payload, and the handler reads the canonical span back from the span
 *     store. That read races the sibling spanStorage write, which is the
 *     failure the derivation shape exists to remove: on 2026-08-05 it parked 22
 *     per-trace groups in `:blocked`, and on 2026-08-10 the same class blocked
 *     88 groups while the error rate rose ~10x. This build no longer stages it;
 *     the handler keeps resolving it so references already in Redis drain.
 *   - A full `span_received` job still processes exactly as before references
 *     existed: jobs staged by a previous release, and matched events the seam
 *     could not lift, carry the whole event, and the handler normalizes
 *     inline in its own lane.
 *
 * **Deploy order (ADR-069).** The CONSUMER half shipped in #6621 and has been
 * live for a full release, so this build is the PRODUCER flip: it stages
 * `span_facts_lifted`, which every worker already knows how to read. Anything a
 * build cannot read at all throws instead of returning, so the next crossing of
 * this boundary fails as a retry rather than as a silent loss.
 *
 * **Why the flip is the fix, not a tuning knob.** The claim-check's retry budget
 * is finite (25 attempts, ~2h27m). The spanStorage map projection it reads from
 * is sharded into 128 lanes per tenant and coalesces 256 spans per dispatch
 * (`spanStorageGroupKey.ts`), while this subscriber keys one group PER TRACE.
 * A tenant with heavy coding-agent traffic therefore mints thousands of
 * per-trace groups that contend with those 128 lanes for the same per-tenant
 * in-flight soft cap — so the harder the tenant pushes, the later its spans
 * land, and the more claim-checks burn attempts against a store that has not
 * caught up. Every failed attempt re-queues, which adds contention, which
 * delays the write further. Removing the read-back breaks that loop at its
 * source; no cap or backoff tuning does.
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

  /**
   * The raw-name gate — the enqueue filter, and the handler's inline guard.
   * `isCodingAgentSessionSpan` is a set lookup for the whole firehose;
   * only a bare DECLARED name (codex's `session_task.turn`) additionally
   * asks the scope, so a foreign span reusing it never mints a session.
   */
  const isCodingAgentSpan = (event: TraceProcessingEvent): event is SpanReceivedEvent => {
    if (!isSpanReceivedEvent(event)) return false;
    const rawName = (event.data.span as { name?: unknown } | undefined)?.name;
    if (typeof rawName !== "string") return false;
    const rawScope = (event.data.instrumentationScope as { name?: unknown } | undefined)
      ?.name;
    return isCodingAgentSessionSpan({
      name: rawName,
      scopeName: typeof rawScope === "string" ? rawScope : null,
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
          makeSpanFactsLiftedPayload({
            event: event as SpanReceivedEvent,
            normalization,
          }),
      },
      // The lifted derivation resolves without touching the span store, so
      // there is no sibling write left to debounce past. The delay stays only
      // for the residual full-event fallback, which normalizes in its own lane
      // and is cheap to defer — and dropping it outright would dispatch a
      // burst of coding-agent spans at ingest rate rather than spreading them
      // across the dedup window below.
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

/**
 * Is a `span_received` payload's body readable at all — does it carry a span
 * object to gate, normalize and lift?
 *
 * Deliberately structural rather than a `spanReceivedEventSchema.parse`: a full
 * parse would turn any drift inside a span the event log already accepted into
 * a job that throws on every one of its 25 attempts and then parks the trace's
 * group — the blocked-group class this whole change exists to remove. The type
 * and the body's presence are what separate "cannot read" from "decline"; the
 * fields within a span the seam already gated stay the normalizer's business.
 */
function hasReadableSpanBody(event: SpanReceivedEvent): boolean {
  const span = (event.data as { span?: unknown } | undefined)?.span;
  // `typeof [] === "object"`, and an array has no `name`, so an array body
  // would reach the gate and be declined as an ordinary span.
  return typeof span === "object" && span !== null && !Array.isArray(span);
}

/**
 * The full-event path: a job carrying the whole `span_received`, staged by a
 * pre-derivation release or by a seam that could not lift the span.
 *
 * Split out of `handle` so that function stays what it reads as — a dispatcher
 * over the three staged shapes — rather than a dispatcher with one shape's
 * implementation inlined into it.
 */
async function handleFullEvent({
  event,
  normalization,
  isCodingAgentSpan,
  contributeSpanFacts,
}: {
  event: TraceProcessingEvent;
  normalization: SpanNormalizationPipelineService;
  isCodingAgentSpan: (event: TraceProcessingEvent) => event is SpanReceivedEvent;
  contributeSpanFacts: (data: ContributeSpanFactsCommandData) => Promise<void>;
}): Promise<void> {
  // Before treating this as a full event, establish that it IS one: a payload
  // of some other type is a shape this build cannot read — almost certainly
  // staged by a newer worker mid-rollout — and returning here would COMPLETE
  // the job with no throw, no retry and no counter, silently dropping that
  // span's facts. Refusing it is the whole reason the deploy-order rule is
  // enforceable (ADR-069).
  if (!isSpanReceivedEvent(event)) {
    throw new Error(
      `codingAgentSpanFactsDispatch cannot read staged payload of type "${String((event as { type?: unknown }).type)}"; refusing it into the queue's retry rather than completing it. A newer build likely staged it — drain with a build that knows the shape.`,
    );
  }

  // The type says `span_received`, so read the body before the name gate
  // answers for it. The gate's `false` means "an event I decline", and a body
  // with no span object would reach that answer for the wrong reason —
  // unreadable, not declined — and complete silently. This cannot fire for a
  // job this seam minted: `enqueue.filter` already found a listed span name on
  // `data.span`, so an absent span means the payload came from somewhere this
  // build does not know.
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

/**
 * Normalizes a full event's span, or reports the failure and yields `null`.
 *
 * Normalization is a pure function of the span's own bytes, so a body it cannot
 * read fails identically on every redelivery. Throwing would spend all 25
 * attempts re-deriving the same failure and then park the TRACE's group —
 * losing every other span's facts in that group to save one span that was never
 * recoverable. That is the blocked-group class this whole change removes, so an
 * unreadable body completes quietly and loudly instead: logged for an operator,
 * not retried.
 *
 * This is the only path such a span can reach, because the seam already failed
 * to lift it (`makeSpanFactsLiftedPayload` stages the full event on a
 * normalizer throw) — which is exactly why it must not throw here too.
 */
function normalizeOrReport({
  event,
  normalization,
}: {
  event: SpanReceivedEvent;
  normalization: SpanNormalizationPipelineService;
}): NormalizedSpan | null {
  try {
    return normalization.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
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

/**
 * Lifts a matched span's facts at the routing seam so the staged job carries
 * its own finished result (ADR-069's bounded derivation).
 *
 * Total at runtime, exactly like `makeSpanReferencedPayload` and for the same
 * reason: this runs as an `enqueue` hook on the shared routing seam, which has
 * no retry, so a throw here would permanently lose the job. Normalization runs
 * on untrusted wire data, so it is wrapped rather than trusted.
 *
 * The result is validated against the very schema the consumer parses with,
 * and a payload that does not validate is DISCARDED in favour of staging the
 * whole event. That is what makes the staged shape provably readable: the
 * consumer's `parseSpanFactsLiftedPayload` throws on a shape it cannot read
 * (correctly — it must never half-process), so staging an unvalidated
 * derivation would convert a malformed span into a job that fails all 25
 * attempts and then blocks its group, which is the exact failure class this
 * change removes.
 *
 * The fallback is the FULL EVENT, never the claim-check: the full-event path
 * resolves with no store read at all, so the rare malformed span costs
 * scheduling-plane bytes instead of re-introducing the race. Only spans this
 * seam cannot lift take it, and `filter` has already established that the span
 * carries a listed coding-agent name.
 */
function makeSpanFactsLiftedPayload({
  event,
  normalization,
}: {
  event: SpanReceivedEvent;
  normalization: SpanNormalizationPipelineService;
}): SpanFactsLiftedPayload | SpanReceivedEvent {
  let data: ContributeSpanFactsCommandData;
  try {
    const span = normalization.normalizeSpanReceived(
      event.tenantId,
      event.data.span,
      event.data.resource,
      event.data.instrumentationScope,
    );
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
  const agent = detectCodingAgent({
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

/**
 * The dedup identity, read from either staged shape with total field picks —
 * `makeId` runs on the staging path, so it must never throw.
 *
 * A span with no usable wire id keys on the event's own CORRELATION id — the
 * envelope KSUID — instead of on an empty string. That case is real, not
 * theoretical: `makeSpanReferencedPayload` refuses to reference an id-less span
 * and stages it whole. Keying it on `""` would collapse every id-less
 * coding-agent span in a trace onto one `…:<tenant>:<trace>:` key, so the
 * second one inside the TTL would dedup away and its facts would be silently
 * dropped.
 *
 * The correlation id is the right fallback precisely because it is what ties a
 * claim-check back to the event it was lifted from: `makeSpanReferencedPayload`
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
