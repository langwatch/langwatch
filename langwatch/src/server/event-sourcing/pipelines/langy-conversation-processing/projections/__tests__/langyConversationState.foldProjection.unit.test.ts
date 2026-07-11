import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_STATUS,
  LANGY_TITLE_SOURCE,
} from "../../schemas/constants";
import type { LangyConversationProcessingEvent } from "../../schemas/events";
import {
  LangyConversationStateFoldProjection,
  type LangyConversationStateData,
} from "../langyConversationState.foldProjection";

const noopStore: FoldProjectionStore<LangyConversationStateData> = {
  store: async () => {},
  get: async () => null,
};

const fold = new LangyConversationStateFoldProjection({ store: noopStore });

const TENANT = createTenantId("project-1");
const CONVERSATION = "conv-1";

function event(
  typeKey: keyof typeof LANGY_CONVERSATION_EVENT_TYPES,
  version: string,
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
    version,
    data: { conversationId: CONVERSATION, ...data },
  } as unknown as LangyConversationProcessingEvent;
}

const messageSent = (
  data: Record<string, unknown>,
  occurredAt: number,
): LangyConversationProcessingEvent =>
  event(
    "MESSAGE_SENT",
    LANGY_CONVERSATION_EVENT_VERSIONS.MESSAGE_SENT,
    { userId: "alice", messageId: "m1", role: "user", parts: [], ...data },
    occurredAt,
  );

describe("LangyConversationStateFoldProjection", () => {
  describe("given a fresh conversation", () => {
    describe("when the first message is sent", () => {
      it("sets the owner, title, active status, and a message count of 1", () => {
        const state = fold.apply(
          fold.init(),
          messageSent({ title: "why are traces failing?" }, 1000),
        );

        expect(state.ConversationId).toBe(CONVERSATION);
        expect(state.UserId).toBe("alice");
        expect(state.Title).toBe("why are traces failing?");
        expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.ACTIVE);
        expect(state.MessageCount).toBe(1);
        expect(state.LastActivityAt).toBe(1000);
      });
    });
  });

  describe("given a conversation already owned by alice", () => {
    const owned = fold.apply(
      fold.init(),
      messageSent({ userId: "alice", title: "first" }, 1000),
    );

    describe("when a later message arrives from a different user", () => {
      it("keeps the original owner and title but still counts the message", () => {
        const state = fold.apply(
          owned,
          messageSent(
            { userId: "mallory", messageId: "m2", title: "hijack" },
            2000,
          ),
        );

        expect(state.UserId).toBe("alice");
        expect(state.Title).toBe("first");
        expect(state.MessageCount).toBe(2);
      });
    });
  });

  describe("given an agent turn is in progress", () => {
    const started = fold.apply(
      fold.apply(fold.init(), messageSent({}, 1000)),
      event(
        "AGENT_TURN_STARTED",
        LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_STARTED,
        { turnId: "turn-1" },
        1500,
      ),
    );

    it("marks the conversation running and records the current turn", () => {
      expect(started.Status).toBe(LANGY_CONVERSATION_STATUS.RUNNING);
      expect(started.CurrentTurnId).toBe("turn-1");
    });

    describe("when the turn is finalized as completed", () => {
      it("appends the assistant message, returns to idle, and clears the turn", () => {
        const state = fold.apply(
          started,
          event(
            "TURN_FINALIZED",
            LANGY_CONVERSATION_EVENT_VERSIONS.TURN_FINALIZED,
            {
              turnId: "turn-1",
              messageId: "a1",
              role: "assistant",
              parts: [],
              outcome: "completed",
            },
            2000,
          ),
        );

        expect(state.MessageCount).toBe(2);
        expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.IDLE);
        expect(state.CurrentTurnId).toBeNull();
        expect(state.LastError).toBeNull();
      });
    });

    describe("when the turn is finalized as failed", () => {
      it("records the failure status and error", () => {
        const state = fold.apply(
          started,
          event(
            "TURN_FINALIZED",
            LANGY_CONVERSATION_EVENT_VERSIONS.TURN_FINALIZED,
            {
              turnId: "turn-1",
              messageId: "a1",
              role: "assistant",
              parts: [],
              outcome: "failed",
              error: "model timeout",
            },
            2000,
          ),
        );

        expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.FAILED);
        expect(state.LastError).toBe("model timeout");
      });
    });
  });

  describe("given an archived conversation", () => {
    const archived = fold.apply(
      fold.apply(fold.init(), messageSent({}, 1000)),
      event(
        "ARCHIVED",
        LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED,
        {},
        3000,
      ),
    );

    it("flips status to archived and stamps ArchivedAt", () => {
      expect(archived.Status).toBe(LANGY_CONVERSATION_STATUS.ARCHIVED);
      expect(archived.ArchivedAt).toBe(3000);
    });

    describe("when a stray later message arrives", () => {
      it("stays archived (a late event cannot un-archive)", () => {
        const state = fold.apply(
          archived,
          messageSent({ messageId: "m9" }, 4000),
        );
        expect(state.Status).toBe(LANGY_CONVERSATION_STATUS.ARCHIVED);
      });
    });
  });

  describe("given a conversation the owner renames and shares", () => {
    it("applies the metadata update without touching other fields", () => {
      const base = fold.apply(fold.init(), messageSent({ title: "old" }, 1000));
      const state = fold.apply(
        base,
        event(
          "METADATA_UPDATED",
          LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
          { title: "new name", isShared: true, sharedById: "alice" },
          2000,
        ),
      );

      expect(state.Title).toBe("new name");
      expect(state.IsShared).toBe(true);
      expect(state.SharedById).toBe("alice");
      expect(state.SharedAt).toBe(2000);
      expect(state.MessageCount).toBe(1);
    });
  });

  describe("given the title's source is tracked on the fold", () => {
    const titleGenerated = (
      data: Record<string, unknown>,
      occurredAt: number,
    ): LangyConversationProcessingEvent =>
      event(
        "TITLE_GENERATED",
        LANGY_CONVERSATION_EVENT_VERSIONS.TITLE_GENERATED,
        { title: "Generated Title", source: "auto", model: "openai/gpt-5-mini", ...data },
        occurredAt,
      );

    describe("when the first message derives a placeholder title", () => {
      it("records the title source as derived", () => {
        const state = fold.apply(
          fold.init(),
          messageSent({ title: "why are traces failing?" }, 1000),
        );
        expect(state.TitleSource).toBe(LANGY_TITLE_SOURCE.DERIVED);
      });
    });

    describe("when the first message carries no title text", () => {
      it("leaves the title unset but still derived-eligible", () => {
        const state = fold.apply(
          fold.init(),
          messageSent({ title: null }, 1000),
        );
        expect(state.Title).toBeNull();
        expect(state.TitleSource).toBe(LANGY_TITLE_SOURCE.DERIVED);
      });
    });

    describe("when a title is generated over a derived placeholder", () => {
      it("replaces the title and marks the source auto", () => {
        const derived = fold.apply(
          fold.init(),
          messageSent({ title: "placeholder" }, 1000),
        );
        const state = fold.apply(derived, titleGenerated({}, 2000));
        expect(state.Title).toBe("Generated Title");
        expect(state.TitleSource).toBe(LANGY_TITLE_SOURCE.AUTO);
        // A title is metadata, not activity — no count/activity change.
        expect(state.MessageCount).toBe(1);
        expect(state.LastActivityAt).toBe(1000);
      });
    });

    describe("when the owner renames by hand", () => {
      it("marks the source user (sticky)", () => {
        const base = fold.apply(
          fold.init(),
          messageSent({ title: "placeholder" }, 1000),
        );
        const state = fold.apply(
          base,
          event(
            "METADATA_UPDATED",
            LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
            { title: "My Own Name" },
            2000,
          ),
        );
        expect(state.Title).toBe("My Own Name");
        expect(state.TitleSource).toBe(LANGY_TITLE_SOURCE.USER);
      });
    });

    describe("when a title is generated after a manual rename", () => {
      it("never overrides the user's title", () => {
        const renamed = fold.apply(
          fold.apply(fold.init(), messageSent({ title: "placeholder" }, 1000)),
          event(
            "METADATA_UPDATED",
            LANGY_CONVERSATION_EVENT_VERSIONS.METADATA_UPDATED,
            { title: "My Own Name" },
            2000,
          ),
        );
        const state = fold.apply(renamed, titleGenerated({}, 3000));
        expect(state.Title).toBe("My Own Name");
        expect(state.TitleSource).toBe(LANGY_TITLE_SOURCE.USER);
      });
    });

    describe("when a later message arrives after an auto title", () => {
      it("does not demote the source back to derived", () => {
        const auto = fold.apply(
          fold.apply(fold.init(), messageSent({ title: "placeholder" }, 1000)),
          titleGenerated({}, 2000),
        );
        const state = fold.apply(
          auto,
          messageSent({ messageId: "m2", title: "another" }, 3000),
        );
        expect(state.Title).toBe("Generated Title");
        expect(state.TitleSource).toBe(LANGY_TITLE_SOURCE.AUTO);
      });
    });
  });

  describe("given a tool call during a turn (a durable transition)", () => {
    it("bumps activity without adding a message or a heartbeat field", () => {
      const base = fold.apply(fold.init(), messageSent({}, 1000));
      const state = fold.apply(
        base,
        event(
          "TOOL_CALL_STARTED",
          LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_STARTED,
          { turnId: "turn-1", toolCallId: "tc-1", toolName: "search_traces" },
          1200,
        ),
      );

      expect(state.LastActivityAt).toBe(1200);
      expect(state.MessageCount).toBe(1);
      expect(state).not.toHaveProperty("LastHeartbeatAt");
    });
  });

  describe("given an agent turn in progress that hands off on shutdown (ADR-048)", () => {
    const started = fold.apply(
      fold.apply(fold.init(), messageSent({}, 1000)),
      event(
        "AGENT_TURN_STARTED",
        LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_STARTED,
        { turnId: "turn-1" },
        1500,
      ),
    );

    const handedOff = fold.apply(
      started,
      event(
        "CONVERSATION_HANDOFF_PENDING",
        LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_PENDING,
        { turnId: "turn-1", token: "opaque-resume-token" },
        1800,
      ),
    );

    describe("when the turn checkpoints and hands off", () => {
      it("stores the pending token, clears the in-flight turn, and returns to idle", () => {
        expect(handedOff.PendingHandoffToken).toBe("opaque-resume-token");
        expect(handedOff.PendingHandoffTurnId).toBe("turn-1");
        expect(handedOff.CurrentTurnId).toBeNull();
        expect(handedOff.Status).toBe(LANGY_CONVERSATION_STATUS.IDLE);
      });

      it("does not record the turn as failed (a handoff is not a failure)", () => {
        expect(handedOff.Status).not.toBe(LANGY_CONVERSATION_STATUS.FAILED);
        expect(handedOff.LastError).toBeNull();
      });
    });

    describe("when the next turn consumes the pending handoff", () => {
      const consumed = fold.apply(
        handedOff,
        event(
          "CONVERSATION_HANDOFF_CONSUMED",
          LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED,
          { turnId: "turn-1" },
          2000,
        ),
      );

      it("clears the pending token", () => {
        expect(consumed.PendingHandoffToken).toBeNull();
        expect(consumed.PendingHandoffTurnId).toBeNull();
      });

      it("consuming again is a no-op on an already-cleared fold (idempotent)", () => {
        const consumedTwice = fold.apply(
          consumed,
          event(
            "CONVERSATION_HANDOFF_CONSUMED",
            LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_HANDOFF_CONSUMED,
            { turnId: "turn-1" },
            2100,
          ),
        );
        expect(consumedTwice.PendingHandoffToken).toBeNull();
        expect(consumedTwice.PendingHandoffTurnId).toBeNull();
      });
    });

    it("a fresh conversation has no pending handoff", () => {
      const init = fold.init();
      expect(init.PendingHandoffToken).toBeNull();
      expect(init.PendingHandoffTurnId).toBeNull();
    });
  });
});
