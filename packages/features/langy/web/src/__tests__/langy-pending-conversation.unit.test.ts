import { beforeEach, describe, expect, it } from "vitest";
import { useLangyStore } from "../langy.store";

/**
 * The id a panel-open warm mints is held as `pendingConversationId` so the
 * first send adopts the conversation whose worker is already booting. It is
 * spent by that send: the create path reads it whenever no conversation is
 * active, so an id left behind would send the NEXT new chat's first message
 * into the previous conversation.
 */
describe("langyStore pending conversation id", () => {
  beforeEach(() => {
    useLangyStore.setState({
      activeConversationId: null,
      pendingConversationId: null,
      unconfirmedConversations: {},
    });
  });

  describe("when a turn begins on the warmed conversation", () => {
    /** @scenario The first message adopts the warmed conversation */
    it("retires the pending id", () => {
      const store = useLangyStore.getState();
      store.setPendingConversationId("conv-warmed");
      store.beginTurn({ conversationId: "conv-warmed", turnId: "turn-1" });

      expect(useLangyStore.getState().activeConversationId).toBe("conv-warmed");
      expect(useLangyStore.getState().pendingConversationId).toBeNull();
    });
  });

  describe("when the server minted its own conversation instead", () => {
    it("retires the pending id all the same", () => {
      const store = useLangyStore.getState();
      store.setPendingConversationId("conv-warmed");
      store.beginTurn({ conversationId: "conv-server", turnId: "turn-1" });

      expect(useLangyStore.getState().pendingConversationId).toBeNull();
    });
  });

  describe("when the user starts a new chat", () => {
    it("drops the id the previous chat was holding", () => {
      const store = useLangyStore.getState();
      store.setPendingConversationId("conv-warmed");
      store.startNewConversation();

      expect(useLangyStore.getState().pendingConversationId).toBeNull();
    });
  });

  describe("when adoptConversation runs", () => {
    it("retires the pending id, as it always did", () => {
      const store = useLangyStore.getState();
      store.setPendingConversationId("conv-warmed");
      store.adoptConversation("conv-warmed");

      expect(useLangyStore.getState().activeConversationId).toBe("conv-warmed");
      expect(useLangyStore.getState().pendingConversationId).toBeNull();
    });
  });
});
