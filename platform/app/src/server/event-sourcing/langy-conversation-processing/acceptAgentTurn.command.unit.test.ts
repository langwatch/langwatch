import { describe, expect, it } from "vitest";
import { acceptAgentTurn, acceptAgentTurnInputSchema } from "./acceptAgentTurn.command";

describe("when a command decides a batch", () => {
  it("orders the resumed handoff's consume after the accepted turn", async () => {
    const input = acceptAgentTurnInputSchema.parse({
      conversationId: "conv-1",
      turnId: "turn-1",
      occurredAt: 1_000,
      consumeHandoffTurnId: "turn-0",
    });

    const events = await acceptAgentTurn(input);

    expect(events.map((event) => event.type)).toEqual([
      "agentTurnAccepted",
      "conversationHandoffConsumed",
    ]);
  });

  it("seeds the conversation and the user message before the turn", async () => {
    const input = acceptAgentTurnInputSchema.parse({
      conversationId: "conv-1",
      turnId: "turn-1",
      occurredAt: 1_000,
      conversationStart: { userId: "user-1" },
      userMessage: {
        userId: "user-1",
        messageId: "msg-1",
        role: "user",
        parts: [],
      },
    });

    const events = await acceptAgentTurn(input);

    expect(events.map((event) => event.type)).toEqual([
      "conversationStarted",
      "messageRecorded",
      "agentTurnAccepted",
    ]);
  });

  it("emits only the accepted turn when neither seed nor handoff apply", async () => {
    const input = acceptAgentTurnInputSchema.parse({
      conversationId: "conv-1",
      turnId: "turn-1",
      occurredAt: 1_000,
    });

    const events = await acceptAgentTurn(input);

    expect(events.map((event) => event.type)).toEqual(["agentTurnAccepted"]);
  });
});
