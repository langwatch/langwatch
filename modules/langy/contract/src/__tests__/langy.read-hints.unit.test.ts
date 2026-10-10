/**
 * The panel follows a turn through read hints, not a poll: the conversation read is
 * invalidated by every durable step a person waits on.
 * Spec: specs/langy/langy-notifications.feature
 */
import { describe, expect, it } from "vitest";

import { LANGY_CONVERSATION_EVENT_TYPES } from "../constants.ts";
import { langyTrpc } from "../langy.trpc.ts";

const hintsOf = (name: keyof typeof langyTrpc.members) =>
  (langyTrpc.members[name].invalidatedBy ?? []).map((hint) =>
    typeof hint === "string" ? hint : hint.event,
  );

describe("the panel's conversation reads", () => {
  /** @scenario "The conversation read refreshes on the turn's durable steps" */
  it("refresh the messages on a turn accepted, a card waiting or answered, a hand-off, and the turn's end", () => {
    expect(hintsOf("messages")).toEqual(
      expect.arrayContaining([
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
        LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED,
        LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED,
        LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      ]),
    );
  });

  it("refresh the waits and the folder state when they change", () => {
    expect(hintsOf("localRecord")).toEqual(
      expect.arrayContaining([
        LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED,
        LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED,
        LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_CONNECTED,
      ]),
    );
    expect(hintsOf("getLocalWorkspace")).toEqual(
      expect.arrayContaining([
        LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_CONNECTED,
        LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_DISCONNECTED,
      ]),
    );
  });
});
