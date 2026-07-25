/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { TenantId } from "../../../domain/tenantId";
import { orderEvents } from "../../../projections/stateProjectionExecutor";
import { AcceptAgentTurnCommand } from "../commands";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";

const TENANT = "project-1";
const CONVERSATION = "conv-1";
const TURN = "turn-1";

function command() {
  return {
    tenantId: TENANT as TenantId,
    aggregateId: CONVERSATION,
    data: {
      tenantId: TENANT,
      occurredAt: 1_700_000_000_000,
      conversationId: CONVERSATION,
      turnId: TURN,
      questionParts: [{ type: "text", text: "hello" }],
      conversationStart: {
        userId: "user-1",
        title: "hello",
        runToken: "run-token",
      },
      userMessage: {
        userId: "user-1",
        messageId: "message-1",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
        title: "hello",
      },
      consumeHandoffTurnId: "turn-0",
    },
  };
}

describe("AcceptAgentTurn command", () => {
  it("emits the whole turn boundary as one ordered event batch", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);
    const events = new AcceptAgentTurnCommand().handle(command() as never);
    now.mockRestore();

    const expectedOrder = [
      LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
      LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
      LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
    ];
    expect(events.map((event) => event.type)).toEqual(expectedOrder);
    // State projections sort by (createdAt, eventId), not array position or
    // occurredAt. The monotonic KSUID sequence must preserve this command's
    // boundary order even when every event is created in the same millisecond.
    expect(new Set(events.map((event) => event.createdAt)).size).toBe(1);
    expect(orderEvents(events).map((event) => event.type)).toEqual(
      expectedOrder,
    );
    expect(events[0]?.data).toEqual(
      expect.objectContaining({
        conversationId: CONVERSATION,
        userId: "user-1",
      }),
    );
    expect(events[1]?.data).toEqual(
      expect.objectContaining({ messageId: "message-1", role: "user" }),
    );
    expect(events[2]?.data).toEqual({
      conversationId: CONVERSATION,
      turnId: TURN,
      questionParts: [{ type: "text", text: "hello" }],
    });
    expect(events[3]?.data).toEqual({
      conversationId: CONVERSATION,
      turnId: "turn-0",
    });
  });

  it("reuses every storage idempotency slot when the command is redelivered", () => {
    const first = new AcceptAgentTurnCommand().handle(command() as never);
    const replay = new AcceptAgentTurnCommand().handle(command() as never);

    expect(replay.map((event) => event.idempotencyKey)).toEqual(
      first.map((event) => event.idempotencyKey),
    );
    expect(new Set(first.map((event) => event.idempotencyKey)).size).toBe(4);
  });
});
