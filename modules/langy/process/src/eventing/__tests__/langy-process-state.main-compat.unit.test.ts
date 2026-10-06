import { describe, expect, it } from "vitest";

import { langyConversationProcessStateSchema } from "../langy-conversation-process.schemas.ts";
import { langySessionKeyReapStateSchema } from "../langy-session-key-reap.process.ts";

describe("process state stored by the main release", () => {
  it("parses a conversation process state as main stored it", () => {
    expect(
      langyConversationProcessStateSchema.parse({
        currentTurnId: null,
        turnStatus: "idle",
        titleSource: "derived",
        autoTitleRequested: false,
        archived: false,
        pendingHandoffTurnId: null,
      }),
    ).toEqual({
      currentTurnId: null,
      turnStatus: "idle",
      titleSource: "derived",
      autoTitleRequested: false,
      archived: false,
      pendingHandoffTurnId: null,
    });
  });
  it("parses a session key reap state as main stored it", () => {
    expect(langySessionKeyReapStateSchema.parse({ lastReapAt: null })).toEqual({
      lastReapAt: null,
    });
  });
});
