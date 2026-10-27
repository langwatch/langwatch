/**
 * @vitest-environment jsdom
 *
 * The history read is scoped to the conversation it was asked for — `keepPreviousData` used to
 * keep answering after New chat switched away from both, leaking the old conversation's state.
 * @see specs/langy/langy-navigation-persistence.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyMessages } from "../../../behavior/data/use-langy-messages.ts";

type RefetchInterval = (query: { state: { data: unknown } }) => number | false;

const seams = vi.hoisted(() => ({
  refetchInterval: null as RefetchInterval | null,
  store: {
    confirmConversation: () => undefined,
    unconfirmedConversations: {} as Record<string, true>,
  },
}));

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

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1" } }),
}));

// The panel's own query seam. `keepPreviousData` is what the real hook asks
// for, so the stub does what react-query does: hand back the last payload
// whatever the key now is.
vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    langy: {
      messages: {
        useQuery: (_input: unknown, options: { refetchInterval: RefetchInterval }) => {
          seams.refetchInterval = options.refetchInterval;
          return {
            data: previousConversation,
            isLoading: false,
            isFetching: true,
            isError: true,
            isSuccess: false,
            error: new Error("conversation not found"),
            refetch: vi.fn(),
          };
        },
      },
    },
  },
}));

// The real store is callable with a selector AND carries getState; the hook uses both.
vi.mock("../../../../../behavior/langy.store.ts", () => {
  const useLangyStore = <T,>(selector: (state: typeof seams.store) => T): T =>
    selector(seams.store);
  useLangyStore.getState = () => seams.store;
  return { useLangyStore };
});

beforeEach(() => {
  seams.refetchInterval = null;
  seams.store.unconfirmedConversations = {};
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

  describe("when the open conversation was just minted and its read 404'd (#7987)", () => {
    it("re-reads about every second while it stays unconfirmed", () => {
      seams.store.unconfirmedConversations = { langyconv_new: true };
      renderHook(() => useLangyMessages("langyconv_new"));

      expect(seams.refetchInterval?.({ state: { data: undefined } })).toBe(1_000);
    });

    it("does not poll a confirmed conversation", () => {
      renderHook(() => useLangyMessages("langyconv_1"));

      expect(seams.refetchInterval?.({ state: { data: undefined } })).toBe(false);
    });
  });
});
