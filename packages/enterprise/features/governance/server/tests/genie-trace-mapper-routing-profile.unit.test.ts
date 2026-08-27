// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The mapper serves more than one source, so the four things that used to be
 * Databricks constants now travel with the source: which events count as
 * conversations, the agent that answered, the provenance tag, and the scope
 * name. Genie keeps its own values by holding the profile that carries them,
 * so nothing about what it produces changes.
 *
 * The load-bearing one is the agent name. Decision 14(d) relies on it never
 * resolving in the pricing table, which held for free while it was a constant
 * no caller could reach. A profile that accepted any string would hand that
 * property away — a source naming a real model would put a price on a
 * conversation nobody was charged for — so profiles may only name an agent
 * from a closed set.
 */

import { describe, expect, it } from "vitest";
import { spanSchema } from "@langwatch/trace-contract";
import {
  type ConversationRoutingProfile,
  GENIE_ROUTING_PROFILE,
  KNOWN_AGENT_IDENTITIES,
  mapGenieEventsToTraceRequest,
} from "../src/adapters/genie-trace-mapper.adapter";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";

const ORIGIN = {
  ingestionSourceId: "source-1",
  organizationId: "org-1",
  sourceType: "databricks_genie",
  profile: GENIE_ROUTING_PROFILE,
};

/** A second source's profile, shaped the way a real one would be. */
const OTHER_PROFILE: ConversationRoutingProfile = {
  conversationAction: "copilot_conversation",
  agentModel: "microsoft/copilot-studio",
  provenanceSource: "copilot_studio",
  scopeName: "langwatch.ingestion.copilot_studio",
  identityNamespace: "copilot_studio",
};

function conversationEvent(action: string): NormalizedPullEvent {
  return {
    source_event_id: "msg-1",
    event_timestamp: "2026-08-20T10:00:00.000Z",
    actor: "analyst@acme.example",
    action,
    target: "Sales space",
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify({
      message_id: "msg-1",
      conversation_id: "conv-1",
      content: "Which region sold most?",
      status: "COMPLETED",
      created_timestamp: 1755684000,
      attachments: [{ text: { content: "EMEA.", purpose: "ANSWER" } }],
    }),
    extra: { conversationId: "conv-1", messageId: "msg-1" },
  };
}

function attributesOf(request: unknown) {
  const span = (request as any).resourceSpans[0].scopeSpans[0].spans[0];
  return (span.attributes as Array<{ key: string; value: any }>).reduce<
    Record<string, string | undefined>
  >((acc, attr) => {
    acc[attr.key] = attr.value?.stringValue;
    return acc;
  }, {});
}

describe("given a source mapping its own conversations", () => {
  describe("when the batch carries the events its own profile recognises", () => {
    it("routes the events its own profile recognises", () => {
      const request = mapGenieEventsToTraceRequest({
        events: [conversationEvent("copilot_conversation")],
        origin: {
          ...ORIGIN,
          sourceType: "copilot_studio",
          profile: OTHER_PROFILE,
        },
      });

      expect(request).not.toBeNull();
      expect((request as any).resourceSpans[0].scopeSpans[0].scope.name).toBe(
        "langwatch.ingestion.copilot_studio",
      );
    });

    it("emits spans a second source's batch can actually be ingested from", () => {
      const request = mapGenieEventsToTraceRequest({
        events: [conversationEvent("copilot_conversation")],
        origin: {
          ...ORIGIN,
          sourceType: "copilot_studio",
          profile: OTHER_PROFILE,
        },
      });

      // The same gate Genie's own mapping is held to. Without it the assertions
      // below could pass on a span the trace pipeline would reject on arrival.
      const spans = (request as any).resourceSpans[0].scopeSpans[0].spans;
      expect(spans.length).toBeGreaterThan(0);
      for (const span of spans) {
        expect(spanSchema.safeParse(span).success).toBe(true);
      }
    });

    /** @scenario "The conversation shape travels with the source, not with Genie" */
    it("names its own agent and provenance rather than inheriting Genie's", () => {
      const request = mapGenieEventsToTraceRequest({
        events: [conversationEvent("copilot_conversation")],
        origin: {
          ...ORIGIN,
          sourceType: "copilot_studio",
          profile: OTHER_PROFILE,
        },
      });

      const attrs = attributesOf(request);
      expect(attrs["gen_ai.request.model"]).toBe("microsoft/copilot-studio");
      expect(attrs["langwatch.source"]).toBe("copilot_studio");
    });
  });

  describe("when the batch carries a Genie question instead", () => {
    /** @scenario "The conversation shape travels with the source, not with Genie" */
    it("leaves another source's events alone", () => {
      const request = mapGenieEventsToTraceRequest({
        events: [conversationEvent("genie_query")],
        origin: {
          ...ORIGIN,
          sourceType: "copilot_studio",
          profile: OTHER_PROFILE,
        },
      });

      expect(request).toBeNull();
    });
  });
});

describe("given Genie's own profile", () => {
  describe("when a question is mapped", () => {
    it("produces exactly what it produced before profiles existed", () => {
      const request = mapGenieEventsToTraceRequest({
        events: [conversationEvent("genie_query")],
        origin: ORIGIN,
      });

      const scopeSpan = (request as any).resourceSpans[0].scopeSpans[0];
      expect(scopeSpan.scope.name).toBe("langwatch.ingestion.databricks_genie");

      const attrs = attributesOf(request);
      expect(attrs["gen_ai.request.model"]).toBe("databricks/genie");
      expect(attrs["langwatch.source"]).toBe("databricks_genie");
    });
  });

  describe("when the event names the author's directory id", () => {
    it("still carries the author through for the identity stack to resolve", () => {
      const event = conversationEvent("genie_query");
      const request = mapGenieEventsToTraceRequest({
        events: [
          {
            ...event,
            extra: { ...event.extra, actorUserId: "entra-object-id" },
          },
        ],
        origin: ORIGIN,
      });

      expect(attributesOf(request)["langwatch.user.id"]).toBe("entra-object-id");
    });
  });
});

describe("given the set of agents a profile may name", () => {
  describe("when the set is read back", () => {
    /**
     * That none of these resolves to a price is pinned against the real
     * pricing table in genieTraceMapper.unit.test.ts, which is the assertion
     * that matters. This one only fixes the membership, so that adding an
     * agent is a deliberate edit here rather than a quiet one elsewhere.
     */
    it("is exactly the agents we have decided on", () => {
      expect([...KNOWN_AGENT_IDENTITIES]).toEqual(["databricks/genie", "microsoft/copilot-studio"]);
    });
  });
});
