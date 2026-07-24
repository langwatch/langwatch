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
import { createTenantId } from "~/server/event-sourcing";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../trace-processing/schemas/constants";
import type { TraceProcessingEvent } from "../../../trace-processing/schemas/events";
import type { ContributeSpanFactsCommandData } from "../../schemas/commands";
import { createCodingAgentSpanFactsDispatchSubscriber } from "../codingAgentSpanFactsDispatch.subscriber";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

/** A raw OTLP span event exactly as the trace pipeline stores it. */
function rawSpanEvent({
  name,
  spanId,
  resourceAttributes = {},
  attributes = {},
  startMs = 1_000,
  endMs = 2_000,
  statusCode = 0,
}: {
  name: string;
  spanId: string;
  resourceAttributes?: Record<string, string>;
  attributes?: Record<string, string | number>;
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

function makeSubscriber() {
  const dispatched: ContributeSpanFactsCommandData[] = [];
  const subscriber = createCodingAgentSpanFactsDispatchSubscriber({
    contributeSpanFacts: async (data) => {
      dispatched.push(data);
    },
  });
  return { subscriber, dispatched };
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
    /**
     * The handler's inline gate is the rollover-safety guard: a build without
     * the enqueue filter stages a job for every span, so after the upgrade the
     * handler must still discard the non-matching ones it dequeues.
     *
     * @scenario a job staged before the filter existed is still gated by the handler
     */
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
