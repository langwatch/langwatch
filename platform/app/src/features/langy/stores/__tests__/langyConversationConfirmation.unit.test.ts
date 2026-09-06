import { beforeEach, describe, expect, it } from "vitest";
import { useLangyStore } from "../langyStore";

/**
 * A conversation this tab just minted may not be readable yet: the create
 * command is accepted before the read-side projection lands, so the history
 * read's not-found must present as pending until a durable confirmation
 * arrives. The store tracks exactly that window.
 */
describe("langyStore conversation confirmation", () => {
  beforeEach(() => {
    useLangyStore.setState({
      activeConversationId: null,
      unconfirmedConversations: {},
    });
  });

  describe("given a turn dispatched for a conversation this tab was not pointing at", () => {
    it("marks the freshly minted conversation unconfirmed", () => {
      useLangyStore
        .getState()
        .beginTurn({ conversationId: "conv-new", turnId: "turn-1" });
      expect(
        useLangyStore.getState().unconfirmedConversations["conv-new"],
      ).toBe(true);
    });

    describe("when a durable confirmation arrives", () => {
      it("clears the unconfirmed window", () => {
        useLangyStore
          .getState()
          .beginTurn({ conversationId: "conv-new", turnId: "turn-1" });
        useLangyStore.getState().confirmConversation("conv-new");
        expect(
          useLangyStore.getState().unconfirmedConversations["conv-new"],
        ).toBeUndefined();
      });

      it("is idempotent and leaves other conversations' windows alone", () => {
        const store = useLangyStore.getState();
        store.beginTurn({ conversationId: "conv-a", turnId: "turn-1" });
        useLangyStore
          .getState()
          .beginTurn({ conversationId: "conv-b", turnId: "turn-2" });
        useLangyStore.getState().confirmConversation("conv-a");
        const afterFirst = useLangyStore.getState().unconfirmedConversations;
        useLangyStore.getState().confirmConversation("conv-a");
        expect(useLangyStore.getState().unconfirmedConversations).toBe(
          afterFirst,
        );
        expect(
          useLangyStore.getState().unconfirmedConversations["conv-b"],
        ).toBe(true);
      });
    });
  });

  describe("given a turn dispatched for the conversation already open", () => {
    it("does not reopen the unconfirmed window", () => {
      useLangyStore.setState({ activeConversationId: "conv-known" });
      useLangyStore
        .getState()
        .beginTurn({ conversationId: "conv-known", turnId: "turn-2" });
      expect(
        useLangyStore.getState().unconfirmedConversations["conv-known"],
      ).toBeUndefined();
    });
  });

  describe("given a conversation that was never marked", () => {
    it("confirming it changes nothing", () => {
      const before = useLangyStore.getState().unconfirmedConversations;
      useLangyStore.getState().confirmConversation("conv-unknown");
      expect(useLangyStore.getState().unconfirmedConversations).toBe(before);
    });
  });
});
