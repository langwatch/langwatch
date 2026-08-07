/**
 * The span→session dispatcher, driven with RAW OTLP span events — the shape
 * trace-processing actually stores. The raw→normalized boundary lives HERE
 * now (PR #5708 had it inside a trace-keyed fold), and a gate that reads the
 * wrong field on that boundary fails silently: the subscriber runs, nothing
 * throws, and no session ever materializes.
 *
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  mapChRowToNormalized,
  serializeAttributes,
} from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import { createTenantId } from "~/server/event-sourcing";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../trace-processing/schemas/constants";
import {
  makeSpanReferencedPayload,
  type SpanReceivedEvent,
  type TraceProcessingEvent,
} from "../../../trace-processing/schemas/events";
import type { NormalizedSpan } from "../../../trace-processing/schemas/spans";
import type { ContributeSpanFactsCommandData } from "../../schemas/commands";
import {
  SPAN_FACTS_LIFTED_PAYLOAD_TYPE,
  SPAN_FACTS_LIFTED_PAYLOAD_VERSION_LATEST,
} from "../../schemas/constants";
import {
  parseSpanFactsLiftedPayload,
  type SpanFactsLiftedPayload,
} from "../../schemas/events";
import { createCodingAgentSpanFactsDispatchSubscriber } from "../codingAgentSpanFactsDispatch.subscriber";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

/** A raw OTLP span event exactly as the trace pipeline stores it. */
function rawSpanEvent({
  name,
  spanId,
  eventId = `evt-${spanId}`,
  resourceAttributes = {},
  attributes = {},
  startMs = 1_000,
  endMs = 2_000,
  statusCode = 0,
  traceId = TRACE_ID,
}: {
  name: string;
  spanId: string;
  /** The event envelope's own id — distinct per event even when the span is not. */
  eventId?: string;
  resourceAttributes?: Record<string, string>;
  attributes?: Record<string, string | number>;
  startMs?: number;
  endMs?: number;
  /** OTLP status: 0 UNSET, 1 OK, 2 ERROR. */
  statusCode?: number;
  /** The trace this span belongs to — span ids are unique only within one. */
  traceId?: string;
}): TraceProcessingEvent {
  return {
    id: eventId,
    aggregateId: traceId,
    aggregateType: "trace",
    tenantId: createTenantId("tenant-1"),
    createdAt: startMs,
    type: SPAN_RECEIVED_EVENT_TYPE,
    occurredAt: startMs,
    data: {
      span: {
        traceId,
        spanId,
        name,
        kind: 1,
        startTimeUnixNano: String(startMs * 1_000_000),
        endTimeUnixNano: String(endMs * 1_000_000),
        attributes: Object.entries(attributes).map(([key, value]) => ({
          key,
          value:
            typeof value === "number"
              ? { intValue: String(value) }
              : { stringValue: value },
        })),
        status: { code: statusCode },
        events: [],
        links: [],
      },
      resource: {
        attributes: Object.entries(resourceAttributes).map(([key, value]) => ({
          key,
          value: { stringValue: value },
        })),
      },
      instrumentationScope: { name: "com.anthropic.claude_code.tracing" },
    },
  } as unknown as TraceProcessingEvent;
}

/** The same normalization the platform runs — builds expected store rows. */
const normalization = new SpanNormalizationPipelineService(
  new CanonicalizeSpanAttributesService(),
);

function normalizedFrom(event: SpanReceivedEvent): NormalizedSpan {
  return normalization.normalizeSpanReceived(
    event.tenantId,
    event.data.span,
    event.data.resource,
    event.data.instrumentationScope,
  );
}

/**
 * What the claim-check path actually reads: the normalized span after a full
 * trip through the span store's own columns.
 *
 * Built by projecting the normalized span onto a `stored_spans` row and
 * running the REPOSITORY's `mapChRowToNormalized` over it, not by spreading
 * the original. That mapping is where the two paths can diverge — `name` comes
 * from `SpanName`, `startTimeUnixMs` from `StartTimeMs`, `statusCode` through
 * `validateStatusCode`, the scope name null-coalesces to `""`, and `id` is
 * dropped to `""` — so a fixture that copied those fields verbatim would keep
 * the identical-command assertion green through exactly the regressions it
 * exists to catch. The lossy Map(String, String) deserialize (turning
 * "true"/"1.0"/"90210" back into booleans and numbers) rides along inside the
 * mapper, which is where production does it too.
 */
function storeReadBackFrom(event: SpanReceivedEvent): NormalizedSpan {
  const span = normalizedFrom(event);
  return mapChRowToNormalized({
    SpanId: span.spanId,
    TraceId: span.traceId,
    TenantId: span.tenantId,
    ParentSpanId: span.parentSpanId ?? null,
    ParentTraceId: span.parentTraceId ?? null,
    ParentIsRemote: span.parentIsRemote ?? null,
    Sampled: span.sampled,
    StartTimeMs: span.startTimeUnixMs,
    EndTimeMs: span.endTimeUnixMs,
    DurationMs: span.durationMs,
    SpanName: span.name,
    SpanKind: span.kind,
    ResourceAttributes: serializeAttributes(span.resourceAttributes),
    SpanAttributes: serializeAttributes(span.spanAttributes),
    StatusCode: span.statusCode,
    StatusMessage: span.statusMessage ?? null,
    ScopeName: span.instrumentationScope?.name ?? null,
    ScopeVersion: span.instrumentationScope?.version ?? null,
    Cost: span.cost ?? null,
    NonBilledCost: span.nonBilledCost ?? null,
    Events_Timestamp: span.events.map((event) => event.timeUnixMs),
    Events_Name: span.events.map((event) => event.name),
    Events_Attributes: span.events.map((event) =>
      serializeAttributes(event.attributes),
    ),
    Links_TraceId: span.links.map((link) => link.traceId),
    Links_SpanId: span.links.map((link) => link.spanId),
    Links_Attributes: span.links.map((link) =>
      serializeAttributes(link.attributes),
    ),
  }) as NormalizedSpan;
}

/**
 * A `span_facts_lifted` job: the bounded derivation the seam stages once the
 * producer half ships. Built against the real constant and version so a bump
 * that forgets this suite fails here rather than in production.
 */
function liftedPayload({
  spanId,
  traceId = TRACE_ID,
  startMs = 1_000,
}: {
  spanId: string;
  traceId?: string;
  startMs?: number;
}): SpanFactsLiftedPayload {
  return {
    id: `evt-${spanId}`,
    version: SPAN_FACTS_LIFTED_PAYLOAD_VERSION_LATEST,
    aggregateId: traceId,
    aggregateType: "trace",
    tenantId: createTenantId("tenant-1"),
    createdAt: startMs,
    occurredAt: startMs,
    type: SPAN_FACTS_LIFTED_PAYLOAD_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: "session-1",
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: startMs,
      traceId,
      spanId,
      name: "claude_code.tool",
      startTimeUnixMs: startMs,
      endTimeUnixMs: startMs + 1_000,
      statusCode: 0,
      facts: { tool_name: "Bash" },
      scopeName: "claude_code",
    },
  } as unknown as SpanFactsLiftedPayload;
}

/**
 * Widens a staged payload to what `handle` accepts.
 *
 * `span_facts_lifted` is a plain job payload, deliberately NOT a member of
 * `TraceProcessingEvent`: the seam stages it in a trace event's place, and it
 * never reaches the event log. So the handler's own parameter type cannot
 * name it, and driving the handler with one needs this cast. Kept in one
 * named place rather than scattered inline, so the reason survives.
 */
function staged(event: unknown): TraceProcessingEvent {
  return event as TraceProcessingEvent;
}

function makeSubscriber(
  spanStore: (params: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }) => Promise<NormalizedSpan | null> = async () => null,
) {
  const dispatched: ContributeSpanFactsCommandData[] = [];
  // `tenantId` is recorded on purpose: it is the predicate that scopes the
  // claim-check read, and a regression that dropped or crossed it would be
  // invisible to a recorder that only kept trace/span.
  const reads: Array<{
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }> = [];
  const subscriber = createCodingAgentSpanFactsDispatchSubscriber({
    contributeSpanFacts: async (data) => {
      dispatched.push(data);
    },
    getNormalizedSpanById: async (params) => {
      reads.push({
        tenantId: params.tenantId,
        traceId: params.traceId,
        spanId: params.spanId,
        occurredAtMs: params.occurredAtMs,
      });
      return spanStore(params);
    },
  });
  return { subscriber, dispatched, reads };
}

const context = { tenantId: "tenant-1", aggregateId: TRACE_ID };

describe("codingAgentSpanFactsDispatch", () => {
  describe("when a coding-agent span carries the session key", () => {
    /** @scenario a session assembles from spans, logs and metrics */
    it("contributes span facts keyed by the provider session", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        rawSpanEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          attributes: {
            "gen_ai.conversation.id": "sess-1",
            input_tokens: 100,
            stop_reason: "end_turn",
          },
        }),
        context,
      );

      expect(dispatched).toHaveLength(1);
      const [contribution] = dispatched;
      expect(contribution!.sessionId).toBe("sess-1");
      expect(contribution!.sessionKeySource).toBe("provider");
      expect(contribution!.agent).toBe("claude_code");
      expect(contribution!.traceId).toBe(TRACE_ID);
      expect(contribution!.facts.input_tokens).toBe(100);
      expect(contribution!.facts.stop_reason).toBe("end_turn");
    });
  });

  describe("when the span carries no session key", () => {
    /** @scenario a session without a session id is not lost */
    it("degrades to the trace id as a one-trace session", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-1",
          attributes: { tool_name: "Bash" },
        }),
        context,
      );

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.sessionId).toBe(TRACE_ID);
      expect(dispatched[0]!.sessionKeySource).toBe("trace_fallback");
    });
  });

  describe("when a tool span FAILED on the wire", () => {
    // The OTLP status survives normalization as the numeric enum (ERROR = 2)
    // and the contribution schema forbids any string spelling of it.
    it("carries the numeric error status through to the contribution", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-err",
          attributes: { tool_name: "Bash" },
          statusCode: 2,
        }),
        context,
      );

      expect(dispatched[0]!.statusCode).toBe(2);
    });
  });

  describe("when a span from an ordinary LLM trace passes by", () => {
    // The handler's inline gate is the rollover-safety guard: a build without
    // the enqueue filter stages a job for every span, so after the upgrade the
    // handler must still discard the non-matching ones it dequeues.
    //
    // NB: the parity checker only reads an annotation whose line ends in `*/`,
    // so this stays a one-line JSDoc with the prose above it.
    /** @scenario work queued before the relevance rule existed still reaches the same outcome */
    it("is ignored without decoding it", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        rawSpanEvent({ name: "openai.chat", spanId: "s-1" }),
        context,
      );

      expect(dispatched).toHaveLength(0);
    });
  });

  describe("given the enqueue-time filter (ADR-069)", () => {
    describe("when the raw span name is a coding-agent name", () => {
      /** @scenario a matching event mints a job for the subscriber */
      it("passes the filter so a job is staged", () => {
        const { subscriber } = makeSubscriber();

        expect(
          subscriber.options?.enqueue?.filter?.(
            rawSpanEvent({ name: "claude_code.tool", spanId: "tool-1" }),
          ),
        ).toBe(true);
      });
    });

    describe("when the raw span name is an ordinary trace name", () => {
      /** @scenario a non-matching event never mints a job */
      it("fails the filter so no job is ever minted", () => {
        const { subscriber } = makeSubscriber();

        expect(
          subscriber.options?.enqueue?.filter?.(
            rawSpanEvent({ name: "openai.chat", spanId: "s-1" }),
          ),
        ).toBe(false);
      });
    });
  });

  describe("given the dedup key", () => {
    describe("when keying a span job", () => {
      /** @scenario a redelivered event resolves to the unit of work already queued */
      it("keys on tenant, trace and span so two traces' spans never collide", () => {
        const { subscriber } = makeSubscriber();
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-dedup",
          attributes: { tool_name: "Bash" },
        });

        // `deduplication` is the `"aggregate" | DeduplicationConfig` union;
        // this subscriber uses the custom-key form.
        const dedup = subscriber.options?.deduplication;
        if (dedup === undefined || dedup === "aggregate") {
          throw new Error("expected a custom deduplication config");
        }

        // Redelivering the SAME span resolves to the same unit of work, which
        // is what lets the queue recognise the duplicate.
        expect(dedup.makeId(event)).toBe(dedup.makeId(event));

        // And the same span id under a different trace does NOT: span ids are
        // unique only within a trace, so a key without the trace would let two
        // traces collide inside the TTL and silently drop one's facts.
        const sameSpanIdOtherTrace = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-dedup",
          attributes: { tool_name: "Bash" },
          traceId: `${TRACE_ID}-other`,
        });
        expect(dedup.makeId(sameSpanIdOtherTrace)).not.toBe(
          dedup.makeId(event),
        );
      });
    });

    describe("when keying a claim-check job", () => {
      /** @scenario relevant work waits in the queue at the cost of a pointer, not of its payload */
      it("derives the identical key from the reference shape", () => {
        const { subscriber } = makeSubscriber();
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-dedup",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;

        const dedup = subscriber.options?.deduplication;
        if (dedup === undefined || dedup === "aggregate") {
          throw new Error("expected a custom deduplication config");
        }

        expect(
          dedup.makeId(
            makeSpanReferencedPayload(event) as TraceProcessingEvent,
          ),
        ).toBe(dedup.makeId(event));
      });
    });

    describe("when two spans in one trace carry no wire span id", () => {
      // The id-less span is the shape `makeSpanReferencedPayload` refuses to
      // reference and stages whole, so this is a reachable production path,
      // not a hypothetical. Keying it on an empty span id would make both
      // spans share `…:<tenant>:<trace>:`, and the second one inside the 60s
      // TTL would dedup away — its facts dropped, silently. The event's own
      // correlation id keeps them distinct.
      /** @scenario two relevant events that share no payload identity are still delivered separately */
      it("keys each on its own event id instead of collapsing to the trace", () => {
        const { subscriber } = makeSubscriber();
        const first = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "",
          eventId: "evt-idless-1",
          attributes: { tool_name: "Bash" },
        });
        const second = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "",
          eventId: "evt-idless-2",
          attributes: { tool_name: "Read" },
        });

        const dedup = subscriber.options?.deduplication;
        if (dedup === undefined || dedup === "aggregate") {
          throw new Error("expected a custom deduplication config");
        }

        expect(dedup.makeId(first)).not.toBe(dedup.makeId(second));
        // And the reference upgrade cannot change the key: a reference copies
        // the source event's id, so an id-less span keys identically whichever
        // shape the seam happened to stage.
        expect(
          dedup.makeId(
            makeSpanReferencedPayload(
              first as SpanReceivedEvent,
            ) as TraceProcessingEvent,
          ),
        ).toBe(dedup.makeId(first));
      });
    });
  });

  describe("given a claim-check staged job (ADR-069)", () => {
    describe("when the referenced span is readable in the store", () => {
      /** @scenario relevant work waits in the queue at the cost of a pointer, not of its payload */
      it("lifts the identical command the full-event path produces", async () => {
        const event = rawSpanEvent({
          name: "claude_code.llm_request",
          spanId: "llm-ref",
          attributes: {
            "gen_ai.conversation.id": "sess-ref",
            input_tokens: 42,
            stop_reason: "end_turn",
          },
        }) as SpanReceivedEvent;

        const fullPath = makeSubscriber();
        await fullPath.subscriber.handle(event, context);

        const refPath = makeSubscriber(async () => storeReadBackFrom(event));
        await refPath.subscriber.handle(
          makeSpanReferencedPayload(event) as TraceProcessingEvent,
          context,
        );

        expect(refPath.dispatched).toHaveLength(1);
        expect(refPath.dispatched[0]).toEqual(fullPath.dispatched[0]);
        expect(refPath.reads).toEqual([
          {
            tenantId: "tenant-1",
            traceId: TRACE_ID,
            spanId: "llm-ref",
            occurredAtMs: 1_000,
          },
        ]);
        // The full-event path never touches the store.
        expect(fullPath.reads).toHaveLength(0);
      });
    });

    describe("when the reference belongs to another tenant", () => {
      // The claim-check read is the one place span facts leave this event's
      // envelope, so the tenant predicate has to travel with it. A read that
      // dropped the tenant — or carried a hardcoded one — would resolve
      // against the wrong project's spans, so the assertion uses a tenant
      // that appears nowhere else in this suite.
      it("scopes the store read to the referencing event's own tenant", async () => {
        const base = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-tenant",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const event = { ...base, tenantId: createTenantId("tenant-other") };

        const { subscriber, reads } = makeSubscriber(async () =>
          normalizedFrom(event),
        );
        await subscriber.handle(
          makeSpanReferencedPayload(event) as TraceProcessingEvent,
          context,
        );

        expect(reads[0]?.tenantId).toBe("tenant-other");
      });
    });

    describe("when the store read-back deserialized numeric-looking scalars", () => {
      /** @scenario relevant work waits in the queue at the cost of a pointer, not of its payload */
      it("keys the session identically and keeps the version fact in canonicalized form", async () => {
        // A purely numeric session key and a numeric-looking service.version:
        // the Map(String, String) round-trip hands them back as NUMBERS, and
        // the lift must land on the same command either way — not fall back
        // to trace-keyed sessions or silently drop the fact.
        const event = rawSpanEvent({
          name: "claude_code.llm_request",
          spanId: "llm-numeric",
          attributes: { "gen_ai.conversation.id": "175335720123" },
          resourceAttributes: { "service.version": "1.0" },
        }) as SpanReceivedEvent;

        const fullPath = makeSubscriber();
        await fullPath.subscriber.handle(event, context);

        const refPath = makeSubscriber(async () => storeReadBackFrom(event));
        await refPath.subscriber.handle(
          makeSpanReferencedPayload(event) as TraceProcessingEvent,
          context,
        );

        // The session key — the field that decides which aggregate the facts
        // land on — is identical across paths.
        expect(fullPath.dispatched[0]?.sessionId).toBe("175335720123");
        expect(fullPath.dispatched[0]?.sessionKeySource).toBe("provider");
        expect(refPath.dispatched[0]?.sessionId).toBe("175335720123");
        expect(refPath.dispatched[0]?.sessionKeySource).toBe("provider");
        // The version fact survives, canonicalized: the Map(String, String)
        // round-trip collapses "1.0" to the number 1, so the claim-check path
        // reports "1" — kept (not dropped), with the numeric formatting lost.
        expect(fullPath.dispatched[0]?.facts["service.version"]).toBe("1.0");
        expect(refPath.dispatched[0]?.facts["service.version"]).toBe("1");
      });
    });

    describe("when the referenced span outlived the ingest-time window", () => {
      /** @scenario work whose payload is not readable yet retries, never drops */
      it("centers the store read on the span's own start, not on ingest time", async () => {
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        const startMs = 1_000_000;
        const base = rawSpanEvent({
          name: "claude_code.blocked_on_user",
          spanId: "long-span",
          startMs,
          endMs: startMs + threeDays,
        }) as SpanReceivedEvent;
        // Ingest happened when the span ENDED — three days after it started,
        // which is outside a fixed window centered on ingest time.
        const event = { ...base, occurredAt: startMs + threeDays };

        const { subscriber, reads } = makeSubscriber(async () =>
          normalizedFrom(event),
        );
        await subscriber.handle(
          makeSpanReferencedPayload(event) as TraceProcessingEvent,
          context,
        );

        expect(reads).toEqual([
          {
            tenantId: "tenant-1",
            traceId: TRACE_ID,
            spanId: "long-span",
            occurredAtMs: startMs,
          },
        ]);
      });

      /** @scenario work whose payload is not readable yet retries, never drops */
      it("centers the read on the start even when the wire carried a protobuf Long", async () => {
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        const startMs = 1_753_000_000_000;
        const base = rawSpanEvent({
          name: "claude_code.blocked_on_user",
          spanId: "long-span-proto",
          startMs,
          endMs: startMs + threeDays,
        }) as SpanReceivedEvent;
        // An OTLP/protobuf decode yields a {low, high} Long here, not a decimal
        // string: `parseOtlpBody` decodes without `toObject({longs: String})`.
        const nano = BigInt(startMs) * 1_000_000n;
        const span = base.data.span as { startTimeUnixNano?: unknown };
        span.startTimeUnixNano = {
          low: Number(nano & 0xffffffffn) | 0,
          high: Number(nano >> 32n),
          unsigned: false,
        };
        const event = { ...base, occurredAt: startMs + threeDays };

        const { subscriber, reads } = makeSubscriber(async () =>
          normalizedFrom(event),
        );
        await subscriber.handle(
          makeSpanReferencedPayload(event) as TraceProcessingEvent,
          context,
        );

        expect(reads[0]?.occurredAtMs).toBe(startMs);
      });
    });

    describe("when the wire span carried no usable start", () => {
      /** @scenario work whose payload is not readable yet retries, never drops */
      it("stages the full event rather than a reference the read could not resolve", async () => {
        const base = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "zero-start",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        // A zero start is stored as 1970, so a reference for it would be
        // windowed on ingest time and never find its own row.
        const span = base.data.span as { startTimeUnixNano?: unknown };
        span.startTimeUnixNano = "0";
        const event = { ...base, occurredAt: 5_000 };

        const { subscriber, dispatched, reads } = makeSubscriber(
          async () => null,
        );
        await subscriber.handle(
          makeSpanReferencedPayload(event) as TraceProcessingEvent,
          context,
        );

        // No store read at all — the facts come off the staged payload.
        expect(reads).toHaveLength(0);
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]!.facts.tool_name).toBe("Bash");
      });
    });

    describe("when the referenced span is not readable yet", () => {
      /** @scenario work whose payload is not readable yet retries, never drops */
      it("throws into the queue's retry instead of dropping silently", async () => {
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-late",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const { subscriber, dispatched } = makeSubscriber(async () => null);

        await expect(
          subscriber.handle(
            makeSpanReferencedPayload(event) as TraceProcessingEvent,
            context,
          ),
        ).rejects.toThrow(/not readable in the span store/);
        expect(dispatched).toHaveLength(0);
      });

      /**
       * The message is operator-facing under a blocked group, so it has to
       * describe what the queue does rather than what we wish it did. The old
       * wording promised retries "until the span store write lands", which read
       * as still-working while 22 groups sat parked and stopped.
       */
      /** @scenario work whose payload is not readable yet retries, never drops */
      it("does not promise a retry budget the queue will not spend", async () => {
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-late-msg",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const { subscriber } = makeSubscriber(async () => null);

        const failure: unknown = await subscriber
          .handle(
            makeSpanReferencedPayload(event) as TraceProcessingEvent,
            context,
          )
          .then(
            () => null,
            (error: unknown) => error,
          );

        const message = (failure as Error).message;
        expect(message).not.toMatch(/until the span store write lands/);
        expect(message).toMatch(/blocks/);
        expect(message).toMatch(/spanStorage/);
      });
    });

    describe("when the reference carries a version this build does not know", () => {
      /** @scenario work a build cannot read fails loudly, never half-processed */
      it("throws into the queue's retry instead of no-opping as another shape", async () => {
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-vnext",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const future = {
          ...makeSpanReferencedPayload(event),
          version: "2199-01-01",
        };
        const { subscriber, dispatched } = makeSubscriber(async () =>
          normalizedFrom(event),
        );

        // A bare `toThrow()` would green on a fixture typo or a stub fault as
        // readily as on the version gate. Pin the failure to the gate itself:
        // a schema rejection whose issue is the `version` field.
        const failure: unknown = await subscriber
          .handle(staged(future), context)
          .then(
            () => null,
            (error: unknown) => error,
          );
        expect(failure).toBeInstanceOf(ZodError);
        expect(
          (failure as ZodError).issues.map((issue) => issue.path.join(".")),
        ).toContain("version");
        expect(dispatched).toHaveLength(0);
      });
    });

    describe("when the matched span has no span id to reference", () => {
      /** @scenario an event whose payload cannot be pointed at is still processed */
      it("stages the full event unchanged and the handler processes it as before", async () => {
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;

        const staged = makeSpanReferencedPayload(event);
        expect(staged).toBe(event);

        const { subscriber, dispatched, reads } = makeSubscriber();
        await subscriber.handle(staged as TraceProcessingEvent, context);
        expect(dispatched).toHaveLength(1);
        expect(reads).toHaveLength(0);
      });
    });
  });

  describe("given a lifted-derivation staged job (ADR-069)", () => {
    describe("when the job carries the facts already lifted", () => {
      /** @scenario work carrying its finished result completes without reading anything back */
      it("contributes them without reading the span store at all", async () => {
        const { subscriber, dispatched, reads } = makeSubscriber(async () => {
          throw new Error("the store must not be read for a lifted job");
        });

        await subscriber.handle(
          staged(liftedPayload({ spanId: "tool-lifted" })),
          context,
        );

        expect(reads).toHaveLength(0);
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]!.spanId).toBe("tool-lifted");
        expect(dispatched[0]!.facts.tool_name).toBe("Bash");
      });

      /**
       * The whole point of the shape: the sibling spanStorage write is the
       * dependency that parked 22 groups, so a lifted job must succeed with the
       * store entirely absent, not merely usually.
       */
      /** @scenario work carrying its finished result completes without reading anything back */
      it("succeeds even when the span never lands in the store", async () => {
        const { subscriber, dispatched } = makeSubscriber(async () => null);

        await subscriber.handle(
          staged(liftedPayload({ spanId: "tool-never-stored" })),
          context,
        );

        expect(dispatched).toHaveLength(1);
      });
    });

    describe("when a job arrives in the exact staged wire shape", () => {
      /**
       * The schema is a plain DTO now, but the bytes on the queue are a
       * contract — with the producer flip a release later, and with jobs
       * already staged mid-rollout. This fixture is deliberately ALL
       * literals, no shared constants, so any drift in the wire strings or
       * the envelope fields fails here rather than on a live queue.
       */
      const pinnedWireJob = () => ({
        id: "evt-wire-pinned",
        aggregateId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        aggregateType: "trace",
        tenantId: "tenant-1",
        createdAt: 1_000,
        occurredAt: 1_000,
        type: "lw.obs.coding_agent_session.span_facts_lifted",
        version: "2026-08-05",
        data: {
          tenantId: "tenant-1",
          sessionId: "sess-wire",
          sessionKeySource: "provider",
          agent: "claude_code",
          occurredAt: 1_000,
          traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
          spanId: "wire-span-1",
          name: "claude_code.tool",
          startTimeUnixMs: 1_000,
          endTimeUnixMs: 2_000,
          statusCode: 0,
          facts: { tool_name: "Bash" },
          scopeName: "claude_code",
        },
      });

      it("round-trips the pinned fixture through the parse unchanged", () => {
        expect(parseSpanFactsLiftedPayload(pinnedWireJob())).toEqual(
          pinnedWireJob(),
        );
      });

      /** @scenario work carrying its finished result completes without reading anything back */
      it("contributes the pinned fixture's facts without a store read", async () => {
        const { subscriber, dispatched, reads } = makeSubscriber(async () => {
          throw new Error("the store must not be read for a lifted job");
        });

        await subscriber.handle(staged(pinnedWireJob()), context);

        expect(reads).toHaveLength(0);
        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]!.sessionId).toBe("sess-wire");
        expect(dispatched[0]!.spanId).toBe("wire-span-1");
        expect(dispatched[0]!.facts.tool_name).toBe("Bash");
      });
    });

    describe("when the staged body names a different tenant than the envelope", () => {
      /** @scenario work carrying its finished result completes without reading anything back */
      it("contributes under the envelope's tenant, never the body's", async () => {
        const { subscriber, dispatched } = makeSubscriber();
        const lifted = liftedPayload({ spanId: "tool-x-tenant" });

        await subscriber.handle(
          staged({
            ...lifted,
            data: { ...lifted.data, tenantId: "tenant-other" },
          }),
          context,
        );

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]!.tenantId).toBe("tenant-1");
      });
    });

    describe("when the lifted job carries a version this build does not know", () => {
      /** @scenario work a build cannot read fails loudly, never half-processed */
      it("throws into the queue's retry instead of no-opping as another shape", async () => {
        const { subscriber, dispatched } = makeSubscriber();
        const future = {
          ...liftedPayload({ spanId: "tool-vnext-lifted" }),
          version: "2199-01-01",
        };

        const failure: unknown = await subscriber
          .handle(staged(future), context)
          .then(
            () => null,
            (error: unknown) => error,
          );

        expect(failure).toBeInstanceOf(ZodError);
        expect(
          (failure as ZodError).issues.map((issue) => issue.path.join(".")),
        ).toContain("version");
        expect(dispatched).toHaveLength(0);
      });
    });

    describe("when the dedup key is built from a lifted job", () => {
      /**
       * The reference upgrade kept the key stable; this one must too, or a
       * rollout that mixes shapes double-counts the same span's facts.
       */
      /** @scenario a redelivered event resolves to the unit of work already queued */
      it("matches the key the full event and the claim-check produce", async () => {
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-key",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const makeId = makeSubscriber().subscriber.options?.deduplication;
        if (typeof makeId !== "object" || makeId === null) {
          throw new Error("dedup config missing");
        }

        const fromFull = makeId.makeId(event);
        const fromReference = makeId.makeId(
          makeSpanReferencedPayload(event) as TraceProcessingEvent,
        );
        const fromLifted = makeId.makeId(
          staged(liftedPayload({ spanId: "tool-key" })),
        );

        expect(fromReference).toBe(fromFull);
        expect(fromLifted).toBe(fromFull);
      });
    });
  });

  describe("given the lift's closed vocabulary", () => {
    describe("when the span carries large content beside the listed facts", () => {
      /**
       * This is the guard that lets a derivation ride on the job at all: the
       * lift walks a fixed key list and takes scalars, so what it carries is
       * bounded by that list rather than by the span. If an unlisted key could
       * ride along, "carry the derivation" would quietly become "queue the
       * payload", which is the cost ADR-069 exists to prevent.
       */
      /** @scenario a carried derivation never carries content */
      it("carries the listed facts and none of the content", async () => {
        const { subscriber, dispatched } = makeSubscriber();
        const bulk = "x".repeat(50_000);

        await subscriber.handle(
          rawSpanEvent({
            name: "claude_code.tool",
            spanId: "tool-bulky",
            attributes: {
              tool_name: "Bash",
              prompt_length: 4,
              // Content, and plausibly-named neighbours of listed keys — none
              // of them is on the list, so none may be carried.
              "gen_ai.prompt": bulk,
              "gen_ai.completion": bulk,
              tool_result: bulk,
            },
          }) as TraceProcessingEvent,
          context,
        );

        expect(dispatched).toHaveLength(1);
        const { facts } = dispatched[0]!;
        expect(facts.tool_name).toBe("Bash");
        expect(facts.prompt_length).toBe(4);
        expect(Object.keys(facts)).not.toContain("gen_ai.prompt");
        expect(Object.keys(facts)).not.toContain("gen_ai.completion");
        expect(Object.keys(facts)).not.toContain("tool_result");
        expect(JSON.stringify(facts)).not.toContain(bulk);
      });
    });
  });

  describe("given a staged payload this build cannot read", () => {
    describe("when the type belongs to a newer build", () => {
      /** @scenario a staged shape from a newer build is refused, never quietly completed */
      it("throws into the queue's retry rather than completing the job", async () => {
        const { subscriber, dispatched } = makeSubscriber();

        await expect(
          subscriber.handle(
            staged({
              ...liftedPayload({ spanId: "tool-future" }),
              type: "lw.obs.coding_agent_session.span_facts_from_2099",
            }),
            context,
          ),
        ).rejects.toThrow(/cannot read staged payload/);
        expect(dispatched).toHaveLength(0);
      });
    });

    describe("when the type is span_received but the body carries no span", () => {
      /**
       * The half the type check alone misses: the name gate answers "not mine"
       * for a body it cannot read, so without this the job completes silently
       * on a payload no build here produced.
       */
      /** @scenario a staged shape from a newer build is refused, never quietly completed */
      it("throws instead of letting the name gate decline it", async () => {
        const { subscriber, dispatched } = makeSubscriber();
        const { data: _dropped, ...envelope } = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-bodyless",
        });

        await expect(
          subscriber.handle(
            { ...envelope, data: {} } as unknown as TraceProcessingEvent,
            context,
          ),
        ).rejects.toThrow(/cannot read the staged "span_received" body/);
        expect(dispatched).toHaveLength(0);
      });

      /**
       * `typeof [] === "object"`, so an array body reaches the gate, has no
       * `name`, and is declined as an ordinary span unless it is refused here.
       */
      /** @scenario a staged shape from a newer build is refused, never quietly completed */
      it("refuses an array in place of the span object", async () => {
        const { subscriber, dispatched } = makeSubscriber();
        const { data: _dropped, ...envelope } = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-array-body",
        });

        await expect(
          subscriber.handle(
            {
              ...envelope,
              data: { span: [] },
            } as unknown as TraceProcessingEvent,
            context,
          ),
        ).rejects.toThrow(/cannot read the staged "span_received" body/);
        expect(dispatched).toHaveLength(0);
      });
    });

    describe("when the payload is an event kind this build knows but declines", () => {
      /**
       * The counterweight to the scenario above: refusing unknown shapes must
       * not turn "not a coding-agent span" into a retry loop, or every ordinary
       * span in the project becomes a poison job during a filterless drain.
       */
      /** @scenario an event the subscriber declines is still completed quietly */
      it("completes quietly without contributing or throwing", async () => {
        const { subscriber, dispatched } = makeSubscriber();

        await expect(
          subscriber.handle(
            rawSpanEvent({
              name: "llm.completion",
              spanId: "ordinary",
            }) as TraceProcessingEvent,
            context,
          ),
        ).resolves.toBeUndefined();
        expect(dispatched).toHaveLength(0);
      });
    });
  });

  describe("when a Cowork session's span arrives (beta trace export)", () => {
    /** @scenario Cowork telemetry that shares Claude Code's event vocabulary is still Cowork */
    it("labels the contribution claude_cowork from the resource service", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      // Claude Code's span name and scope; only resource service.name says
      // cowork. The label must follow the service, not the runtime.
      await subscriber.handle(
        rawSpanEvent({
          name: "claude_code.llm_request",
          spanId: "s-cw",
          attributes: { "gen_ai.conversation.id": "cw-sess-1" },
          resourceAttributes: { "service.name": "cowork" },
        }),
        context,
      );

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.agent).toBe("claude_cowork");
      expect(dispatched[0]!.sessionId).toBe("cw-sess-1");
    });
  });
});
