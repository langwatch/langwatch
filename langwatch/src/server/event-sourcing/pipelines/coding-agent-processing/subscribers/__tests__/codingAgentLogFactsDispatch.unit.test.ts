/**
 * The log→session dispatcher, driven with canonical log records — the shape
 * log-processing actually stores (attributes flattened as JSON).
 *
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "../../../log-processing/schemas/constants";
import type { LogProcessingEvent } from "../../../log-processing/schemas/events";
import type { ContributeLogFactsCommandData } from "../../schemas/commands";
import { createCodingAgentLogFactsDispatchSubscriber } from "../codingAgentLogFactsDispatch.subscriber";

const WIRE_TRACE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

function canonicalLogEvent({
  attributes,
  scopeName = "com.anthropic.claude_code.events",
  eventName = "",
  correlationTraceId = "",
  correlationSource = "none",
  providerSessionId = "",
  recordId = "rec-1",
}: {
  attributes: Record<string, unknown>;
  scopeName?: string;
  eventName?: string;
  correlationTraceId?: string;
  correlationSource?: string;
  providerSessionId?: string;
  recordId?: string;
}): LogProcessingEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
    occurredAt: 1_500,
    data: {
      tenantId: "tenant-1",
      recordId,
      scopeName,
      eventName,
      attributesFlatJson: JSON.stringify(attributes),
      resourceAttributesFlatJson: JSON.stringify({
        "service.version": "2.0.1",
      }),
      correlationTraceId,
      correlationSpanId: "",
      correlationSource,
      providerKind: "claude_code",
      providerSessionId,
      timeUnixMs: 1_500,
      severityNumber: 9,
      occurredAt: 1_500,
    },
  } as unknown as LogProcessingEvent;
}

function makeSubscriber() {
  const dispatched: ContributeLogFactsCommandData[] = [];
  const subscriber = createCodingAgentLogFactsDispatchSubscriber({
    contributeLogFacts: async (data) => {
      dispatched.push(data);
    },
  });
  return { subscriber, dispatched };
}

const context = { tenantId: "tenant-1", aggregateId: "rec-1" };

describe("codingAgentLogFactsDispatch", () => {
  describe("when a denied tool's decision log arrives", () => {
    /** @scenario a denied tool is part of the session story */
    it("contributes the lifted facts keyed by the provider session", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        canonicalLogEvent({
          attributes: {
            "event.name": "claude_code.tool_decision",
            "session.id": "sess-1",
            decision: "reject",
            tool_name: "Bash",
          },
        }),
        context,
      );

      expect(dispatched).toHaveLength(1);
      const [contribution] = dispatched;
      expect(contribution!.sessionId).toBe("sess-1");
      expect(contribution!.sessionKeySource).toBe("provider");
      expect(contribution!.agent).toBe("claude_code");
      expect(contribution!.facts.decision).toBe("reject");
      // The resource's service.version rides the same facts map so identity
      // can be established from any signal.
      expect(contribution!.facts["service.version"]).toBe("2.0.1");
      // No correlation on the record: the contribution carries no trace.
      expect(contribution!.traceId).toBeNull();
    });
  });

  describe("when the record carries a wire correlation", () => {
    it("passes the correlation trace id through", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        canonicalLogEvent({
          attributes: {
            "event.name": "claude_code.api_request",
            "session.id": "sess-1",
            cost_usd: 0.25,
          },
          correlationTraceId: WIRE_TRACE,
          correlationSource: "wire",
        }),
        context,
      );

      expect(dispatched[0]!.traceId).toBe(WIRE_TRACE);
    });
  });

  describe("when the record spells the session only in its provider column", () => {
    it("falls back to providerSessionId", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        canonicalLogEvent({
          attributes: { "event.name": "claude_code.user_prompt" },
          providerSessionId: "sess-from-column",
        }),
        context,
      );

      expect(dispatched[0]!.sessionId).toBe("sess-from-column");
      expect(dispatched[0]!.sessionKeySource).toBe("provider");
    });
  });

  describe("when an ordinary application log passes by", () => {
    it("is ignored without dispatching", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        canonicalLogEvent({
          attributes: { "event.name": "http.request", "session.id": "s" },
          scopeName: "express",
        }),
        context,
      );

      expect(dispatched).toHaveLength(0);
    });
  });

  describe("when a coding-agent record has no session key and no correlation", () => {
    it("skips it — there is nothing to aggregate under", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        canonicalLogEvent({
          attributes: { "event.name": "claude_code.internal_error" },
        }),
        context,
      );

      expect(dispatched).toHaveLength(0);
    });
  });
});
