/**
 * @vitest-environment jsdom
 *
 * The history read is scoped to the conversation it was asked for.
 * `keepPreviousData` smooths the switch between two conversations, and it used
 * to keep answering after New chat had switched away from both — so the fresh,
 * empty chat reported the previous conversation's messages, its in-flight turn
 * and its failure.
 *
 * @see specs/langy/langy-navigation-persistence.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  langyMessagesPollInterval,
  useLangyMessages,
} from "../data/useLangyMessages";

const previousConversation = {
  messages: [{ id: "msg_1", role: "assistant", parts: [] }],
  lastError: JSON.stringify({ code: "langy_conversation_not_found" }),
  isTurnInFlight: true,
  inFlightTurnId: "langyturn_1",
  shouldAskFeedback: false,
  eventCursor: null,
  currentTurnId: "langyturn_1",
  lastModel: "openai/gpt-5-mini",
};

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1" } }),
}));

// The panel's own query seam. `keepPreviousData` is what the real hook asks
// for, so the stub does what react-query does: hand back the last payload
// whatever the key now is.
vi.mock("~/utils/api", () => ({
  api: {
    langy: {
      messages: {
        useQuery: () => ({
          data: previousConversation,
          isLoading: false,
          isFetching: true,
          isError: true,
          isSuccess: false,
          error: new Error("conversation not found"),
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("../stores/langyStore", () => {
  const state = {
    confirmConversation: vi.fn(),
    unconfirmedConversations: {} as Record<string, true>,
  };
  // The real store is callable-with-selector AND carries getState; the hook
  // uses both (a subscription for the unconfirmed flag, getState in effects).
  const useLangyStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useLangyStore.getState = () => state;
  return { useLangyStore };
});

describe("useLangyMessages", () => {
  describe("when no conversation is open", () => {
    /** @scenario "A new chat reads nothing from the conversation it left" */
    it("reports nothing from the conversation just left", () => {
      const { result } = renderHook(() => useLangyMessages(null));

      expect(result.current.messages).toEqual([]);
      expect(result.current.lastError).toBeNull();
      expect(result.current.isTurnInFlight).toBe(false);
      expect(result.current.inFlightTurnId).toBeNull();
      expect(result.current.currentTurnId).toBeNull();
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.isFetching).toBe(false);
    });
  });

  describe("when a conversation is open", () => {
    it("reports its payload as it always did", () => {
      const { result } = renderHook(() => useLangyMessages("langyconv_1"));

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.isTurnInFlight).toBe(true);
      expect(result.current.isError).toBe(true);
    });
  });
});

describe("langyMessagesPollInterval", () => {
  describe("while the fold says a turn is in flight", () => {
    it("re-checks on the in-flight cadence", () => {
      expect(langyMessagesPollInterval({ isTurnInFlight: true })).toBe(3_000);
    });
  });

  describe("while a freshly minted conversation has produced no data", () => {
    // The projection row is written by an asynchronous fold, so the first
    // read of a new conversation routinely 404s; the query's retry policy
    // rightly never retries a 404, and without this poll NOTHING re-asks —
    // the panel sat on "conversation not found" until the answer streamed in.
    it("polls on a short interval — the 404 is 'not yet', never settled", () => {
      expect(langyMessagesPollInterval(undefined, true)).toBe(1_000);
    });

    it("stops the moment data lands and the turn is settled", () => {
      expect(langyMessagesPollInterval({ isTurnInFlight: false }, true)).toBe(
        false,
      );
    });
  });

  describe("when the conversation is confirmed and nothing is in flight", () => {
    it("does not poll at all", () => {
      expect(langyMessagesPollInterval(undefined, false)).toBe(false);
      expect(langyMessagesPollInterval({ isTurnInFlight: false }, false)).toBe(
        false,
      );
      expect(langyMessagesPollInterval({ isTurnInFlight: false })).toBe(false);
    });
  });
});
