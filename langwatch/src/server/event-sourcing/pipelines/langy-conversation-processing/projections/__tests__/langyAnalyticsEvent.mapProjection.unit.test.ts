import { describe, expect, it, vi } from "vitest";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
} from "@langwatch/langy";
import {
  LangyConversationHandoffPendingEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyToolCallSucceededEventSchema,
} from "../../schemas/events";
import { LangyAnalyticsEventMapProjection } from "../langyAnalyticsEvent.mapProjection";
import type { LangyConversationProcessingEvent } from "../../schemas/events";

const base = {
  aggregateId: "conversation_1",
  aggregateType: "langy_conversation",
  tenantId: "project_1",
  occurredAt: 1_000,
  createdAt: 1_100,
  metadata: {},
};

function projection() {
  return new LangyAnalyticsEventMapProjection({
    store: { append: vi.fn() },
  });
}

describe("LangyAnalyticsEventMapProjection", () => {
  it("registers and maps every durable Langy event type", () => {
    const subject = projection();
    expect(subject.eventTypes).toEqual(
      LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
    );

    const records = LANGY_CONVERSATION_PROCESSING_EVENT_TYPES.map(
      (type, index) =>
        subject.map({
          ...base,
          id: `event_${index}`,
          type,
          version: "2026-07-10",
          data: { conversationId: "conversation_1", turnId: "turn_1" },
        } as LangyConversationProcessingEvent),
    );
    expect(records).toHaveLength(LANGY_CONVERSATION_PROCESSING_EVENT_TYPES.length);
    expect(records.every((record) => record !== null)).toBe(true);
  });

  it("maps a canonical event envelope and analytics dimensions", () => {
    const event = LangyToolCallSucceededEventSchema.parse({
      ...base,
      id: "event_tool_succeeded",
      type: "lw.langy_conversation.tool_call_succeeded",
      version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
      data: {
        conversationId: "conversation_1",
        turnId: "turn_1",
        toolCallId: "tool_call_1",
        toolName: "bash",
        command: "private command",
        input: { privateInput: "secret input" },
        durationMs: 123,
      },
    });

    expect(projection().map(event)).toEqual({
      eventId: "event_tool_succeeded",
      eventType: "lw.langy_conversation.tool_call_succeeded",
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
      aggregateId: "conversation_1",
      turnId: "turn_1",
      userId: null,
      role: null,
      toolName: "bash",
      outcome: null,
      model: null,
      durationMs: 123,
      occurredAtMs: 1_000,
      acceptedAtMs: 1_100,
    });
  });

  it("never projects conversation content, errors, tokens, or credentials", () => {
    const events = [
      LangyToolCallSucceededEventSchema.parse({
        ...base,
        id: "event_tool",
        type: "lw.langy_conversation.tool_call_succeeded",
        version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
        data: {
          conversationId: "conversation_1",
          turnId: "turn_1",
          toolCallId: "tool_call_1",
          toolName: "bash",
          command: "PRIVATE_COMMAND",
          input: { value: "PRIVATE_INPUT" },
        },
      }),
      LangyConversationHandoffPendingEventSchema.parse({
        ...base,
        id: "event_handoff",
        type: "lw.langy_conversation.conversation_handoff_pending",
        version:
          LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_PENDING,
        data: {
          conversationId: "conversation_1",
          turnId: "turn_1",
          token: "PRIVATE_HANDOFF_TOKEN",
        },
      }),
      LangyConversationMetadataUpdatedEventSchema.parse({
        ...base,
        id: "event_title",
        type: "lw.langy_conversation.conversation_metadata_updated",
        version: LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
        data: {
          conversationId: "conversation_1",
          title: "PRIVATE_TITLE",
        },
      }),
      {
        ...base,
        id: "event_started",
        type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
        version: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED,
        data: {
          conversationId: "conversation_1",
          userId: "user_1",
          title: "PRIVATE_INITIAL_TITLE",
          runToken: "PRIVATE_RUN_TOKEN",
        },
      },
      {
        ...base,
        id: "event_message",
        type: LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
        version: LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_RECORDED,
        data: {
          conversationId: "conversation_1",
          userId: "user_1",
          messageId: "message_1",
          role: "user",
          parts: [{ type: "text", text: "PRIVATE_QUESTION" }],
        },
      },
      {
        ...base,
        id: "event_answer",
        type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
        version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
        data: {
          conversationId: "conversation_1",
          turnId: "turn_1",
          messageId: "message_2",
          role: "assistant",
          parts: [{ type: "text", text: "PRIVATE_ANSWER" }],
          outcome: "failed",
          error: "PRIVATE_ANSWER_ERROR",
        },
      },
      {
        ...base,
        id: "event_plan",
        type: LANGY_CONVERSATION_EVENT_TYPES.PLAN_UPDATED,
        version: LANGY_CONVERSATION_EVENT_VERSIONS.PLAN_UPDATED,
        data: {
          conversationId: "conversation_1",
          turnId: "turn_1",
          items: [{ content: "PRIVATE_PLAN", status: "pending" }],
        },
      },
    ];

    const serialized = JSON.stringify(
      events.map((event) =>
        projection().map(event as LangyConversationProcessingEvent),
      ),
    );
    expect(serialized).not.toContain("PRIVATE_COMMAND");
    expect(serialized).not.toContain("PRIVATE_INPUT");
    expect(serialized).not.toContain("PRIVATE_HANDOFF_TOKEN");
    expect(serialized).not.toContain("PRIVATE_TITLE");
    expect(serialized).not.toContain("PRIVATE_INITIAL_TITLE");
    expect(serialized).not.toContain("PRIVATE_RUN_TOKEN");
    expect(serialized).not.toContain("PRIVATE_QUESTION");
    expect(serialized).not.toContain("PRIVATE_ANSWER");
    expect(serialized).not.toContain("PRIVATE_ANSWER_ERROR");
    expect(serialized).not.toContain("PRIVATE_PLAN");
  });
});
