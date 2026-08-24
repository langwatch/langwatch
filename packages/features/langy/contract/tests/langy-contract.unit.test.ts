import { describe, expect, it } from "vitest";
import {
  LANGY_FEATURE_ID,
  langyRelayFrameSchema,
  langyTurnInputSchema,
} from "../src/index";

describe("Langy contract", () => {
  it("identifies the singular feature", () => {
    expect(LANGY_FEATURE_ID).toBe("langy");
  });

  it("rejects unknown relay fields at the wire boundary", () => {
    expect(() =>
      langyRelayFrameSchema.parse({
        conversationId: "conversation_1",
        turnId: "turn_1",
        type: "agent-response",
        payload: {},
        unexpected: true,
      }),
    ).toThrow();
  });

  it("requires a turn message", () => {
    expect(() =>
      langyTurnInputSchema.parse({
        projectId: "project_1",
        userId: "user_1",
        conversationId: "conversation_1",
        turnId: "turn_1",
        idempotencyKey: "request_1",
        messages: [],
      }),
    ).toThrow();
  });
});
