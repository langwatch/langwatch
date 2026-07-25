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
import { CanonicalizeSpanAttributesService } from "~/server/app-layer/traces/canonicalisation";
import {
  deserializeAttributes,
  serializeAttributes,
} from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import { createTenantId } from "~/server/event-sourcing";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../trace-processing/schemas/constants";
import {
  makeSpanReferencedEvent,
  type SpanReceivedEvent,
  type TraceProcessingEvent,
} from "../../../trace-processing/schemas/events";
import type { NormalizedSpan } from "../../../trace-processing/schemas/spans";
import type { ContributeSpanFactsCommandData } from "../../schemas/commands";
import { createCodingAgentSpanFactsDispatchSubscriber } from "../codingAgentSpanFactsDispatch.subscriber";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

/** A raw OTLP span event exactly as the trace pipeline stores it. */
function rawSpanEvent({
  name,
  spanId,
  attributes = {},
  resourceAttributes = {},
  startMs = 1_000,
  endMs = 2_000,
  statusCode = 0,
}: {
  name: string;
  spanId: string;
  attributes?: Record<string, string | number>;
  resourceAttributes?: Record<string, string>;
  startMs?: number;
  endMs?: number;
  /** OTLP status: 0 UNSET, 1 OK, 2 ERROR. */
  statusCode?: number;
}): TraceProcessingEvent {
  return {
    id: `evt-${spanId}`,
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    tenantId: createTenantId("tenant-1"),
    createdAt: startMs,
    type: SPAN_RECEIVED_EVENT_TYPE,
    occurredAt: startMs,
    data: {
      span: {
        traceId: TRACE_ID,
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
 * What the claim-check path actually reads: the normalized span AFTER its
 * attributes round-tripped ClickHouse's Map(String, String) columns — the
 * deliberately lossy deserialize turns "true"/"1.0"/"90210" style strings
 * into booleans and numbers, which is exactly the divergence the
 * identical-command contract has to absorb.
 */
function storeReadBackFrom(event: SpanReceivedEvent): NormalizedSpan {
  const span = normalizedFrom(event);
  return {
    ...span,
    spanAttributes: deserializeAttributes(
      serializeAttributes(span.spanAttributes),
    ),
    resourceAttributes: deserializeAttributes(
      serializeAttributes(span.resourceAttributes),
    ),
  };
}

function makeSubscriber(
  spanStore: (params: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs?: number;
  }) => Promise<NormalizedSpan | null> = async () => null,
) {
  const dispatched: ContributeSpanFactsCommandData[] = [];
  const reads: Array<{
    traceId: string;
    spanId: string;
    occurredAtMs?: number;
  }> = [];
  const subscriber = createCodingAgentSpanFactsDispatchSubscriber({
    contributeSpanFacts: async (data) => {
      dispatched.push(data);
    },
    getNormalizedSpanById: async (params) => {
      reads.push({
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
    /** @scenario a job staged before the filter existed is still gated by the handler */
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
      /** @scenario filtering leaves the dedup identity of the jobs that remain intact */
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

        expect(dedup.makeId(event)).toBe(
          `coding-agent-span-facts:tenant-1:${TRACE_ID}:tool-dedup`,
        );
      });
    });

    describe("when keying a claim-check job", () => {
      /** @scenario a matched event's heavy payload travels as a claim-check, not inline */
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
          dedup.makeId(makeSpanReferencedEvent(event) as TraceProcessingEvent),
        ).toBe(dedup.makeId(event));
      });
    });
  });

  describe("given a claim-check staged job (ADR-069)", () => {
    describe("when the referenced span is readable in the store", () => {
      /** @scenario a matched event's heavy payload travels as a claim-check, not inline */
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
          makeSpanReferencedEvent(event) as TraceProcessingEvent,
          context,
        );

        expect(refPath.dispatched).toHaveLength(1);
        expect(refPath.dispatched[0]).toEqual(fullPath.dispatched[0]);
        expect(refPath.reads).toEqual([
          { traceId: TRACE_ID, spanId: "llm-ref", occurredAtMs: 1_000 },
        ]);
        // The full-event path never touches the store.
        expect(fullPath.reads).toHaveLength(0);
      });
    });

    describe("when the store read-back deserialized numeric-looking scalars", () => {
      /** @scenario a matched event's heavy payload travels as a claim-check, not inline */
      it("keys the session and keeps the version fact identically to the full-event path", async () => {
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
          makeSpanReferencedEvent(event) as TraceProcessingEvent,
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
      /** @scenario a reference that cannot be resolved yet retries, never drops */
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
          makeSpanReferencedEvent(event) as TraceProcessingEvent,
          context,
        );

        expect(reads).toEqual([
          { traceId: TRACE_ID, spanId: "long-span", occurredAtMs: startMs },
        ]);
      });

      it("falls back to ingest time when the wire span carried no parseable start", async () => {
        const valid = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "no-start",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const base = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "no-start",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const span = base.data.span as { startTimeUnixNano?: unknown };
        span.startTimeUnixNano = "not-a-timestamp";
        const event = { ...base, occurredAt: 5_000 };

        // Only the read HINT is under test; the stub's span content just has
        // to be a well-formed store row (a garbage start can't normalize, so
        // the store never holds one).
        const { subscriber, reads } = makeSubscriber(async () =>
          normalizedFrom(valid),
        );
        await subscriber.handle(
          makeSpanReferencedEvent(event) as TraceProcessingEvent,
          context,
        );

        expect(reads[0]?.occurredAtMs).toBe(5_000);
      });
    });

    describe("when the referenced span is not readable yet", () => {
      /** @scenario a reference that cannot be resolved yet retries, never drops */
      it("throws into the queue's retry instead of dropping silently", async () => {
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-late",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const { subscriber, dispatched } = makeSubscriber(async () => null);

        await expect(
          subscriber.handle(
            makeSpanReferencedEvent(event) as TraceProcessingEvent,
            context,
          ),
        ).rejects.toThrow(/not readable yet/);
        expect(dispatched).toHaveLength(0);
      });
    });

    describe("when the reference carries a version this build does not know", () => {
      /** @scenario a reference this build cannot read fails loudly, never half-parses */
      it("throws into the queue's retry instead of no-opping as another shape", async () => {
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-vnext",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;
        const future = {
          ...makeSpanReferencedEvent(event),
          version: "2199-01-01",
        };
        const { subscriber, dispatched } = makeSubscriber(async () =>
          normalizedFrom(event),
        );

        await expect(
          subscriber.handle(future as TraceProcessingEvent, context),
        ).rejects.toThrow();
        expect(dispatched).toHaveLength(0);
      });
    });

    describe("when the matched span has no span id to reference", () => {
      /** @scenario an event that cannot be referenced stages whole */
      it("stages the full event unchanged and the handler processes it as before", async () => {
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "",
          attributes: { tool_name: "Bash" },
        }) as SpanReceivedEvent;

        const staged = makeSpanReferencedEvent(event);
        expect(staged).toBe(event);

        const { subscriber, dispatched, reads } = makeSubscriber();
        await subscriber.handle(staged as TraceProcessingEvent, context);
        expect(dispatched).toHaveLength(1);
        expect(reads).toHaveLength(0);
      });
    });
  });
});
