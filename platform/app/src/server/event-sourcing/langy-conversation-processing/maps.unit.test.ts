import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "@langwatch/langy";
import { describe, expect, it } from "vitest";
import { langyConversationEvents } from "./events";
import { langyAnalyticsEventRecords, langyMessageRecords } from "./maps";

describe("the analytics map", () => {
  it("declares a handler for every event the pipeline declares", () => {
    expect(Object.keys(langyAnalyticsEventRecords).sort()).toEqual(
      Object.keys(langyConversationEvents).sort(),
    );
  });

  it("derives a record from the dimensions a payload supplies", () => {
    const record = langyAnalyticsEventRecords.toolCallSucceeded({
      conversationId: "conv-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      toolName: "bash",
      durationMs: 42,
      occurredAt: 1_000,
    });

    expect(record).toEqual({
      eventId: expect.any(String),
      eventType: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
      eventVersion: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
      aggregateId: "conv-1",
      turnId: "turn-1",
      userId: null,
      role: null,
      toolName: "bash",
      outcome: null,
      model: null,
      durationMs: 42,
      occurredAt: 1_000,
      acceptedAt: 1_000,
    });
  });

  it("carries the terminal outcome the payload reports", () => {
    const record = langyAnalyticsEventRecords.agentResponded({
      conversationId: "conv-1",
      turnId: "turn-1",
      role: "assistant",
      outcome: "stopped",
      occurredAt: 1_000,
    });

    expect(record.outcome).toBe("stopped");
    expect(record.role).toBe("assistant");
  });

  it("derives the same eventId for the same payload on a retry", () => {
    const args = {
      conversationId: "conv-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      toolName: "bash",
      occurredAt: 1_000,
    };

    const first = langyAnalyticsEventRecords.toolCallInitiated({ ...args });
    const retried = langyAnalyticsEventRecords.toolCallInitiated({ ...args });

    expect(retried.eventId).toBe(first.eventId);
  });

  /**
   * Two parallel tool calls landing in the same millisecond share
   * `(aggregateId, type, occurredAt)` — the whole ClickHouse sort key, absent
   * the payload hash. Without folding the payload in, `replacing` would keep
   * whichever write landed last and silently drop the other tool call.
   */
  it("gives two distinct same-millisecond events of the same type different eventIds", () => {
    const first = langyAnalyticsEventRecords.toolCallInitiated({
      conversationId: "conv-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      toolName: "bash",
      occurredAt: 1_000,
    });
    const second = langyAnalyticsEventRecords.toolCallInitiated({
      conversationId: "conv-1",
      turnId: "turn-1",
      toolCallId: "call-2",
      toolName: "bash",
      occurredAt: 1_000,
    });

    expect(second.eventId).not.toBe(first.eventId);
  });
});

describe("the message map", () => {
  it("declares only the three message-bearing events", () => {
    expect(Object.keys(langyMessageRecords).sort()).toEqual(
      ["agentResponded", "messageImported", "messageRecorded"].sort(),
    );
  });

  it("builds the row from the payload's own message identity", () => {
    const record = langyMessageRecords.messageRecorded({
      conversationId: "conv-1",
      userId: "user-1",
      messageId: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
      occurredAt: 1_000,
    });

    expect(record).toEqual({
      ConversationId: "conv-1",
      MessageId: "msg-1",
      Role: "user",
      Parts: [{ type: "text", text: "hello" }],
      SourceEventId: "msg-1",
      OccurredAt: 1_000,
      AcceptedAt: 1_000,
      CreatedAt: 1_000,
      UpdatedAt: 1_000,
    });
  });
});
