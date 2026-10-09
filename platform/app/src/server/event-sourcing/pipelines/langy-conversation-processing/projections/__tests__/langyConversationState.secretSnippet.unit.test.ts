/**
 * The secret never reaches the conversation store
 * (specs/langy/langy-secret-snippet.feature).
 *
 * The events here are the ones a turn records when Langy shows a key through
 * the secret snippet card: the tool call with its input, the tool's answer,
 * and the assistant message with the tool part in it, exactly as the worker
 * shapes them. The real fold projection reads them, and neither the events
 * nor the state it folds carries the value the card showed.
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  type LangyConversationStateData,
} from "@langwatch/langy";
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { StateProjectionStore } from "../../../../projections/stateProjection.types";
import type { LangyConversationProcessingEvent } from "../../schemas/events";
import { LangyConversationStateFoldProjection } from "../langyConversationState.foldProjection";

const noopStore: StateProjectionStore<LangyConversationStateData> = {
  store: async () => {},
  load: async () => null,
};

const fold = new LangyConversationStateFoldProjection({ store: noopStore });

const TENANT = createTenantId("project-1");
const CONVERSATION = "conv-secret";
const TURN = "turn-1";
const SECRET = "vk-lw-01HZX9NABCDEFGHJKMNPQRSTVW";
const TEMPLATE =
  'export OPENAI_BASE_URL="https://gateway.acme.example/v1"\nexport OPENAI_API_KEY="{{secret}}"';

/** The tool call's input, as the worker's `secret_snippet` tool declares it. */
const SNIPPET_INPUT = {
  revealId: "rvl_abc123",
  template: TEMPLATE,
  preview: "vk-lw-01HZX9N",
};

/** The tool's answer to the model, pinned by the worker's own test. */
const SNIPPET_ANSWER =
  "The secret snippet card is shown to the user, with the key filled in. Never print the key yourself.";

function event(
  typeKey: keyof typeof LANGY_CONVERSATION_EVENT_TYPES,
  data: Record<string, unknown>,
  occurredAt: number,
): LangyConversationProcessingEvent {
  return {
    id: `event-${occurredAt}`,
    aggregateId: CONVERSATION,
    aggregateType: "langy_conversation",
    tenantId: TENANT,
    createdAt: occurredAt,
    occurredAt,
    type: LANGY_CONVERSATION_EVENT_TYPES[typeKey],
    version: LANGY_CONVERSATION_EVENT_VERSIONS[typeKey],
    data: { conversationId: CONVERSATION, ...data },
  } as unknown as LangyConversationProcessingEvent;
}

/** The turn as recorded: the ask, the tool call, its answer, the reply. */
function secretSnippetTurn(): LangyConversationProcessingEvent[] {
  return [
    event(
      "CONVERSATION_STARTED",
      { userId: "alice", title: "Guided onboarding" },
      1000,
    ),
    event(
      "MESSAGE_RECORDED",
      {
        userId: "alice",
        messageId: "m1",
        role: "user",
        parts: [{ type: "text", text: "Guided onboarding kickoff" }],
      },
      1100,
    ),
    event("AGENT_TURN_ACCEPTED", { turnId: TURN }, 1200),
    event(
      "TOOL_CALL_INITIATED",
      {
        turnId: TURN,
        toolCallId: "tc-1",
        toolName: "secret_snippet",
        input: SNIPPET_INPUT,
      },
      1300,
    ),
    event(
      "TOOL_CALL_SUCCEEDED",
      {
        turnId: TURN,
        toolCallId: "tc-1",
        toolName: "secret_snippet",
        output: SNIPPET_ANSWER,
        durationMs: 5,
      },
      1400,
    ),
    event(
      "MESSAGE_RECORDED",
      {
        userId: "alice",
        messageId: "m2",
        role: "assistant",
        turnId: TURN,
        parts: [
          {
            type: "text",
            text: "Your key production-app is live. Point your app at the gateway with it and every call gets budgets, routing and tracing for free:",
          },
          {
            type: "tool-secret_snippet",
            toolCallId: "tc-1",
            state: "output-available",
            input: SNIPPET_INPUT,
            output: SNIPPET_ANSWER,
          },
          {
            type: "text",
            text: "That's it from me. I will leave you to save the key somewhere safe, and let me know if there is anything I can help with.",
          },
        ],
      },
      1500,
    ),
  ];
}

describe("the conversation store after a secret snippet turn", () => {
  describe("given the events a secret snippet turn records", () => {
    const events = secretSnippetTurn();

    /** @scenario "The secret is never in the conversation store" */
    it("carries the reveal id, the template and the preview, and never the secret", () => {
      const serialized = JSON.stringify(events);
      expect(serialized).toContain("rvl_abc123");
      expect(serialized).toContain("{{secret}}");
      expect(serialized).toContain("vk-lw-01HZX9N");
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toMatch(/vk-lw-[0-9A-Z]{26}/);
    });

    describe("when the fold projection reads them", () => {
      it("folds a state that carries no secret either", () => {
        const state = events.reduce(
          (acc, next) => fold.apply(acc, next),
          fold.init(),
        );
        expect(state.ConversationId).toBe(CONVERSATION);
        expect(state.MessageCount).toBeGreaterThanOrEqual(2);
        const serialized = JSON.stringify(state);
        expect(serialized).not.toContain(SECRET);
        expect(serialized).not.toMatch(/vk-lw-[0-9A-Z]{26}/);
      });
    });
  });
});
