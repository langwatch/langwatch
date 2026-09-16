import { describe, expect, it } from "vitest";

import { langyConversationUpdateSignalSchema } from "../langy.dtos.ts";

/**
 * The client half of the freshness signal contract: the broadcast payload
 * carries server-side fields (ownerUserId/isShared) that must NEVER survive
 * the parse, and (since ADR-059) the cursor that MUST - the schema is the security boundary.
 */
describe("langyConversationUpdateSignalSchema", () => {
  const wirePayload = {
    event: "langy_conversation_updated",
    conversationId: "conv-1",
    cursor: { acceptedAt: 1_752_600_000_000, eventId: "2AAAevt" },
    ownerUserId: "user-1",
    isShared: false,
  };

  it("passes the projection cursor through to the client", () => {
    const parsed = langyConversationUpdateSignalSchema.parse(wirePayload);
    expect(parsed.cursor).toEqual({
      acceptedAt: 1_752_600_000_000,
      eventId: "2AAAevt",
    });
  });

  it("strips the server-side authorization fields", () => {
    const parsed = langyConversationUpdateSignalSchema.parse(wirePayload);
    expect(parsed).not.toHaveProperty("ownerUserId");
    expect(parsed).not.toHaveProperty("isShared");
  });

  it("still parses a signal without a cursor (older server builds)", () => {
    const parsed = langyConversationUpdateSignalSchema.parse({
      event: "langy_conversation_updated",
      conversationId: "conv-1",
    });
    expect(parsed.cursor).toBeUndefined();
  });
});
