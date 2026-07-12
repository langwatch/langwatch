import { describe, expect, it, vi } from "vitest";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_STATUS,
  LANGY_TITLE_GENERATION,
  LANGY_TITLE_SOURCE,
} from "../../schemas/constants";
import type { LangyConversationProcessingEvent } from "../../schemas/events";
import type { LangyConversationStateData } from "../../projections/langyConversationState.foldProjection";
import {
  createLangyTitleGenerationReactor,
  type LangyTitleGenerator,
} from "../langyTitleGeneration.reactor";

const TENANT = "project-1";
const CONVERSATION = "conv-1";

function finalized(
  outcome: "completed" | "failed" = "completed",
): LangyConversationProcessingEvent {
  return {
    id: "e1",
    aggregateId: CONVERSATION,
    aggregateType: "langy_conversation",
    tenantId: TENANT,
    createdAt: 1,
    occurredAt: 1,
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
    data: {
      conversationId: CONVERSATION,
      turnId: "t1",
      messageId: "m1",
      role: "assistant",
      parts: [],
      outcome,
    },
  } as unknown as LangyConversationProcessingEvent;
}

function messageSent(): LangyConversationProcessingEvent {
  return {
    id: "e2",
    aggregateId: CONVERSATION,
    aggregateType: "langy_conversation",
    tenantId: TENANT,
    createdAt: 1,
    occurredAt: 1,
    type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_CONTINUED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_CONTINUED,
    data: { conversationId: CONVERSATION, userId: "alice", messageId: "m1", role: "user", parts: [] },
  } as unknown as LangyConversationProcessingEvent;
}

function state(
  o: Partial<LangyConversationStateData> = {},
): LangyConversationStateData {
  return {
    ConversationId: CONVERSATION,
    UserId: "alice",
    Title: "placeholder",
    TitleSource: LANGY_TITLE_SOURCE.DERIVED,
    Status: LANGY_CONVERSATION_STATUS.IDLE,
    IsShared: false,
    SharedAt: null,
    SharedById: null,
    MessageCount: 2,
    LastActivityAt: 1,
    CurrentTurnId: null,
    LastError: null,
    PendingHandoffToken: null,
    PendingHandoffTurnId: null,
    ArchivedAt: null,
    CreatedAt: 1,
    UpdatedAt: 1,
    LastEventOccurredAt: 1,
    ...o,
  };
}

function ctx(
  foldState: LangyConversationStateData,
  isReplay = false,
): ReactorContext<LangyConversationStateData> {
  return { tenantId: TENANT, aggregateId: CONVERSATION, foldState, isReplay };
}

function makeReactor(generate?: LangyTitleGenerator) {
  const saveTitle = vi.fn(async () => {});
  const handle = createLangyTitleGenerationReactor({ saveTitle });
  if (generate) handle.setGenerator(generate);
  return { ...handle, saveTitle };
}

describe("langyTitleGeneration reactor", () => {
  describe("shouldReact throttle", () => {
    describe("given a first finalized turn with a derived placeholder title", () => {
      it("reacts (the first auto title replaces the placeholder)", () => {
        const { reactor } = makeReactor();
        expect(
          reactor.shouldReact!(
            finalized(),
            ctx(state({ TitleSource: LANGY_TITLE_SOURCE.DERIVED })),
          ),
        ).toBe(true);
      });
    });

    describe("given the event is not a finalized turn", () => {
      it("does not react", () => {
        const { reactor } = makeReactor();
        expect(reactor.shouldReact!(messageSent(), ctx(state()))).toBe(false);
      });
    });

    describe("given the turn failed", () => {
      it("does not react", () => {
        const { reactor } = makeReactor();
        expect(reactor.shouldReact!(finalized("failed"), ctx(state()))).toBe(
          false,
        );
      });
    });

    describe("given the user renamed the conversation", () => {
      it("does not react (a manual title is sticky)", () => {
        const { reactor } = makeReactor();
        expect(
          reactor.shouldReact!(
            finalized(),
            ctx(state({ TitleSource: LANGY_TITLE_SOURCE.USER })),
          ),
        ).toBe(false);
      });
    });

    describe("given the conversation is archived", () => {
      it("does not react", () => {
        const { reactor } = makeReactor();
        expect(
          reactor.shouldReact!(
            finalized(),
            ctx(state({ Status: LANGY_CONVERSATION_STATUS.ARCHIVED })),
          ),
        ).toBe(false);
      });
    });

    describe("given an already-auto title on an in-between turn", () => {
      it("does not react (throttled between the every-N-turns beats)", () => {
        const { reactor } = makeReactor();
        // MessageCount 4 → turn 2; 2 % 3 !== 0.
        expect(
          reactor.shouldReact!(
            finalized(),
            ctx(state({ TitleSource: LANGY_TITLE_SOURCE.AUTO, MessageCount: 4 })),
          ),
        ).toBe(false);
      });
    });

    describe("given an already-auto title on an every-N-turns beat", () => {
      it("reacts (a periodic refinement)", () => {
        const { reactor } = makeReactor();
        // MessageCount 6 → turn 3; 3 % 3 === 0.
        const messageCount = LANGY_TITLE_GENERATION.REGENERATE_EVERY_N_TURNS * 2;
        expect(
          reactor.shouldReact!(
            finalized(),
            ctx(
              state({
                TitleSource: LANGY_TITLE_SOURCE.AUTO,
                MessageCount: messageCount,
              }),
            ),
          ),
        ).toBe(true);
      });
    });
  });

  describe("handle", () => {
    describe("when the generator returns a title", () => {
      it("dispatches GenerateConversationTitle with the title and model", async () => {
        const generate = vi.fn(async () => ({
          title: "Fixing Trace Ingestion",
          model: "openai/gpt-5-mini",
        }));
        const { reactor, saveTitle } = makeReactor(generate);

        await reactor.handle(finalized(), ctx(state()));

        expect(generate).toHaveBeenCalledWith({
          projectId: TENANT,
          conversationId: CONVERSATION,
        });
        expect(saveTitle).toHaveBeenCalledWith({
          projectId: TENANT,
          conversationId: CONVERSATION,
          title: "Fixing Trace Ingestion",
          model: "openai/gpt-5-mini",
        });
      });
    });

    describe("when the event is a replay", () => {
      it("does not generate or dispatch", async () => {
        const generate = vi.fn(async () => ({ title: "x", model: "m" }));
        const { reactor, saveTitle } = makeReactor(generate);

        await reactor.handle(finalized(), ctx(state(), true));

        expect(generate).not.toHaveBeenCalled();
        expect(saveTitle).not.toHaveBeenCalled();
      });
    });

    describe("when the generator returns null", () => {
      it("does not dispatch (leaves the title unchanged)", async () => {
        const generate = vi.fn(async () => null);
        const { reactor, saveTitle } = makeReactor(generate);

        await reactor.handle(finalized(), ctx(state()));

        expect(saveTitle).not.toHaveBeenCalled();
      });
    });

    describe("when the generator throws", () => {
      it("swallows the error and never breaks the turn", async () => {
        const generate = vi.fn(async () => {
          throw new Error("model exploded");
        });
        const { reactor, saveTitle } = makeReactor(generate);

        await expect(
          reactor.handle(finalized(), ctx(state())),
        ).resolves.toBeUndefined();
        expect(saveTitle).not.toHaveBeenCalled();
      });
    });

    describe("when the user renamed after the predicate captured its snapshot", () => {
      it("re-checks the fresh fold and skips generation", async () => {
        const generate = vi.fn(async () => ({ title: "x", model: "m" }));
        const { reactor, saveTitle } = makeReactor(generate);

        await reactor.handle(
          finalized(),
          ctx(state({ TitleSource: LANGY_TITLE_SOURCE.USER })),
        );

        expect(generate).not.toHaveBeenCalled();
        expect(saveTitle).not.toHaveBeenCalled();
      });
    });
  });
});
