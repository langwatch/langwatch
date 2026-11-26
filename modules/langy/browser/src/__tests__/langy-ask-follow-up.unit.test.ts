import { LANGY_FOLLOW_UP_WINDOW_MS } from "@langwatch/langy-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyStore } from "../behavior/langy.store.ts";

const BOARD = "dashboard:board-9";
const START = Date.UTC(2026, 10, 25, 9, 0, 0);

/** Asks from `from`, then lets the panel send it so the turn names `conversationId`. */
function askAndStart({
  question,
  from,
  conversationId,
}: {
  question: string;
  from: string;
  conversationId: string;
}) {
  useLangyStore.getState().askLangy(question, from);
  useLangyStore.getState().consumePendingPrompt();
  useLangyStore.getState().adoptConversation(conversationId);
}

describe("askLangy from a board", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    useLangyStore.getState().resetForProject("project-test");
    askAndStart({ question: "Why are costs up?", from: BOARD, conversationId: "conv-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the member asks again from the same board soon after", () => {
    /** @scenario "AC264e Langy follow-ups: a second question from the same board continues the conversation" */
    it("queues the question in the open conversation, keeping its messages", () => {
      vi.setSystemTime(START + 60_000);

      useLangyStore.getState().askLangy("And last week?", BOARD);

      const state = useLangyStore.getState();
      expect(state.activeConversationId).toBe("conv-1");
      expect(state.pendingPrompt).toBe("And last week?");
      expect(state.pendingPromptContinues).toBe(true);
    });

    /** @scenario "AC264e Langy follow-ups: a second question from the same board continues the conversation" */
    it("counts the window from the latest question, so a chat that keeps going stays one", () => {
      vi.setSystemTime(START + LANGY_FOLLOW_UP_WINDOW_MS - 1000);
      useLangyStore.getState().askLangy("And last week?", BOARD);
      useLangyStore.getState().consumePendingPrompt();
      vi.setSystemTime(START + LANGY_FOLLOW_UP_WINDOW_MS + 1000);

      useLangyStore.getState().askLangy("And the week before?", BOARD);

      expect(useLangyStore.getState().activeConversationId).toBe("conv-1");
    });
  });

  describe("when the next question starts a new conversation", () => {
    /** @scenario "AC264f Langy follow-ups: another board, a stale conversation or a new chat starts a new conversation" */
    it.each([
      {
        case: "another board",
        before: () => void 0,
        from: "dashboard:board-2",
      },
      {
        case: "more than 6 hours later",
        before: () => vi.setSystemTime(START + LANGY_FOLLOW_UP_WINDOW_MS + 1),
        from: BOARD,
      },
      {
        case: "a new chat in between",
        before: () => useLangyStore.getState().startNewConversation(),
        from: BOARD,
      },
      {
        case: "another conversation opened in between",
        before: () => useLangyStore.getState().selectConversation("conv-other"),
        from: BOARD,
      },
    ])("starts a fresh conversation after $case", ({ before, from }) => {
      before();

      useLangyStore.getState().askLangy("And last week?", from);

      const state = useLangyStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.pendingPrompt).toBe("And last week?");
      expect(state.pendingPromptContinues).toBe(false);
    });

    /** @scenario "AC264f Langy follow-ups: another board, a stale conversation or a new chat starts a new conversation" */
    it("starts a fresh conversation for a question that names no place", () => {
      useLangyStore.getState().askLangy("And last week?");

      expect(useLangyStore.getState().activeConversationId).toBeNull();
    });
  });
});
