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
import type { Event } from "../../../../domain/types";
import { makeStagedProjection } from "../../../../subscribers/stagedProjection";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../../trace-processing/schemas/constants";
import type { TraceProcessingEvent } from "../../../trace-processing/schemas/events";
import type { ContributeSpanFactsCommandData } from "../../schemas/commands";
import { createCodingAgentSpanFactsDispatchSubscriber } from "../codingAgentSpanFactsDispatch.subscriber";

const TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

/** A raw OTLP span event exactly as the trace pipeline stores it. */
function rawSpanEvent({
  name,
  spanId,
  attributes = {},
  startMs = 1_000,
  endMs = 2_000,
  statusCode = 0,
}: {
  name: string;
  spanId: string;
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
      resource: { attributes: [] },
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
    /** @scenario traces from other sources are untouched */
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

  describe("given the enqueue-time projection (ADR-069)", () => {
    describe("when a matched span is projected at the seam", () => {
      it("lifts the same command the full-event handler builds", async () => {
        const { subscriber, dispatched } = makeSubscriber();
        const event = rawSpanEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          attributes: {
            "gen_ai.conversation.id": "sess-1",
            input_tokens: 100,
            stop_reason: "end_turn",
          },
        });

        // The full-event path (what a pre-upgrade job runs) builds the command.
        await subscriber.handle(event, context);
        const fromFullEvent = dispatched[0]!;

        // The projection lifts the identical command at enqueue time.
        const projected = subscriber.options!.enqueue!.project!(event);

        expect(projected).toEqual(fromFullEvent);
      });
    });
  });

  describe("given a staged projection job (the post-upgrade shape)", () => {
    describe("when the handler receives the projection envelope", () => {
      /**
       * @scenario a matching event's job carries the derived slice, not the raw payload
       */
      it("dispatches the carried command without re-decoding a span", async () => {
        const { subscriber, dispatched } = makeSubscriber();
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-9",
          attributes: { tool_name: "Bash" },
        });
        const projection = subscriber.options!.enqueue!.project!(event);
        const envelope = makeStagedProjection({
          event: event as unknown as Event,
          projection,
        });

        await subscriber.handle(
          envelope as unknown as TraceProcessingEvent,
          context,
        );

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]).toEqual(projection);
      });
    });
  });

  describe("given a mixed deploy across the upgrade boundary", () => {
    describe("when the same span arrives as both the old and new shape", () => {
      /**
       * The hard compatibility requirement: a pre-upgrade job carries the full
       * event, a post-upgrade job carries the projection, and both must produce
       * the identical command.
       *
       * @scenario a job staged before the upgrade still processes
       */
      it("produces the identical command from either shape", async () => {
        const event = rawSpanEvent({
          name: "claude_code.llm_request",
          spanId: "llm-mixed",
          attributes: {
            "gen_ai.conversation.id": "sess-mixed",
            input_tokens: 42,
          },
        });

        const oldBuild = makeSubscriber();
        await oldBuild.subscriber.handle(event, context);

        const newBuild = makeSubscriber();
        const envelope = makeStagedProjection({
          event: event as unknown as Event,
          projection: newBuild.subscriber.options!.enqueue!.project!(event),
        });
        await newBuild.subscriber.handle(
          envelope as unknown as TraceProcessingEvent,
          context,
        );

        expect(oldBuild.dispatched).toHaveLength(1);
        expect(newBuild.dispatched).toHaveLength(1);
        expect(newBuild.dispatched[0]).toEqual(oldBuild.dispatched[0]);
      });
    });
  });

  describe("given the dedup key must survive the projection", () => {
    describe("when keying a staged projection job", () => {
      /** @scenario extraction changes the payload, not the delivery guarantees */
      it("keeps the tenant:trace:span key on the envelope", () => {
        const { subscriber } = makeSubscriber();
        const event = rawSpanEvent({
          name: "claude_code.tool",
          spanId: "tool-dedup",
          attributes: { tool_name: "Bash" },
        });
        const projection = subscriber.options!.enqueue!.project!(
          event,
        ) as ContributeSpanFactsCommandData;
        const envelope = makeStagedProjection({
          event: event as unknown as Event,
          projection,
        });

        const key = subscriber.options!.deduplication!.makeId(
          envelope as unknown as TraceProcessingEvent,
        );

        expect(key).toBe(
          `coding-agent-span-facts:tenant-1:${TRACE_ID}:${projection.spanId}`,
        );
      });
    });
  });
});
