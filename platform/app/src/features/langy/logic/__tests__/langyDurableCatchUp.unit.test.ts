/**
 * The durable catch-up shared by the freshness signal and the history poll:
 * bring the local turn fold to a target cursor by fetching and folding the
 * event tail. Two drivers, one mechanism — which is why a dead SSE
 * connection no longer freezes a mid-turn panel: the poll keeps handing
 * fresher cursors to the same catch-up.
 *
 * @see specs/langy/langy-frontend-realtime.feature
 *      "A tab whose live stream dropped still converges on the turn"
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyStore } from "@langwatch/langy-web";
import { catchUpConversationFold } from "../langyDurableCatchUp";

type Utils = Parameters<typeof catchUpConversationFold>[0]["utils"];

const accepted = (o: { id: string; createdAt: number; turnId?: string }) => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  data: { conversationId: "conv-1", turnId: o.turnId ?? "turn-1" },
});

const responded = (o: { id: string; createdAt: number }) => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  data: {
    conversationId: "conv-1",
    turnId: "turn-1",
    messageId: "m1",
    role: "assistant" as const,
    parts: [],
    outcome: "completed" as const,
  },
});

function utilsWith({
  events = [],
  cursor,
}: {
  events?: unknown[];
  cursor?: { acceptedAt: number; eventId: string };
}) {
  const fetch = vi.fn().mockResolvedValue({
    events,
    cursor: cursor ?? { acceptedAt: 0, eventId: "" },
    truncated: false,
  });
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const utils = {
    langy: {
      messages: { invalidate },
      conversationEventsAfter: { fetch },
    },
  } as unknown as Utils;
  return { utils, fetch, invalidate };
}

/**
 * A server that answers one page per call, each page reporting whether more
 * remains. The last page in the list repeats if the loop asks for more, which
 * is what a run against its own ceiling looks like from the client's side.
 */
function utilsWithPages(
  pages: Array<{
    events?: unknown[];
    cursor: { acceptedAt: number; eventId: string };
    truncated: boolean;
  }>,
) {
  let call = 0;
  const fetch = vi.fn().mockImplementation(() => {
    const page = pages[Math.min(call, pages.length - 1)]!;
    call += 1;
    return Promise.resolve({
      events: page.events ?? [],
      cursor: page.cursor,
      truncated: page.truncated,
    });
  });
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const utils = {
    langy: {
      messages: { invalidate },
      conversationEventsAfter: { fetch },
    },
  } as unknown as Utils;
  return { utils, fetch, invalidate };
}

describe("catchUpConversationFold", () => {
  beforeEach(() => {
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject("project-test");
    // Both callers only reach the catch-up for the conversation that is open,
    // so that is the state under test.
    useLangyStore.setState({ activeConversationId: "conv-1" });
  });

  describe("when the local fold is behind the target cursor", () => {
    /** @scenario A tab whose live stream dropped still converges on the turn */
    it("fetches the tail from the local cursor and folds it, skipping nothing", async () => {
      useLangyStore.getState().seedTurnProjection({
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: "turn-1",
      });
      const tail = [
        accepted({ id: "e2", createdAt: 200 }),
        responded({ id: "e3", createdAt: 300 }),
      ];
      const { utils, fetch } = utilsWith({
        events: tail,
        cursor: { acceptedAt: 300, eventId: "e3" },
      });

      await catchUpConversationFold({
        utils,
        projectId: "p1",
        conversationId: "conv-1",
        targetCursor: { acceptedAt: 300, eventId: "e3" },
      });

      expect(fetch).toHaveBeenCalledWith({
        projectId: "p1",
        conversationId: "conv-1",
        after: { acceptedAt: 100, eventId: "e1" },
      });
      const projection = useLangyStore.getState().turnProjection;
      expect(projection.cursor).toEqual({ acceptedAt: 300, eventId: "e3" });
      expect(projection.turn?.Status).toBe("completed");
    });

    it("invalidates the message history when the folded tail reaches a terminal", async () => {
      useLangyStore.getState().seedTurnProjection({
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: "turn-1",
      });
      const { utils, invalidate } = utilsWith({
        events: [
          accepted({ id: "e2", createdAt: 200 }),
          responded({ id: "e3", createdAt: 300 }),
        ],
        cursor: { acceptedAt: 300, eventId: "e3" },
      });

      await catchUpConversationFold({
        utils,
        projectId: "p1",
        conversationId: "conv-1",
        targetCursor: { acceptedAt: 300, eventId: "e3" },
      });

      expect(invalidate).toHaveBeenCalledWith({
        projectId: "p1",
        conversationId: "conv-1",
      });
    });
  });

  describe("when the durable tail arrives over several pages", () => {
    it("asks for the next page from the cursor the last one ended at", async () => {
      useLangyStore.getState().seedTurnProjection({
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: "turn-1",
      });
      const { utils, fetch } = utilsWithPages([
        {
          events: [accepted({ id: "e2", createdAt: 200 })],
          cursor: { acceptedAt: 200, eventId: "e2" },
          truncated: true,
        },
        {
          events: [responded({ id: "e3", createdAt: 300 })],
          cursor: { acceptedAt: 300, eventId: "e3" },
          truncated: false,
        },
      ]);

      await catchUpConversationFold({
        utils,
        projectId: "p1",
        conversationId: "conv-1",
        targetCursor: { acceptedAt: 300, eventId: "e3" },
      });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenLastCalledWith({
        projectId: "p1",
        conversationId: "conv-1",
        after: { acceptedAt: 200, eventId: "e2" },
      });
      const projection = useLangyStore.getState().turnProjection;
      expect(projection.cursor).toEqual({ acceptedAt: 300, eventId: "e3" });
      expect(projection.turn?.Status).toBe("completed");
    });
  });

  describe("when the user switches conversation while the tail is in flight", () => {
    /** @scenario A tail that lands after a conversation switch is dropped */
    it("drops the tail instead of folding it into the conversation now open", async () => {
      useLangyStore.getState().seedTurnProjection({
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: "turn-1",
      });
      const { utils, fetch } = utilsWith({});
      // The switch resolves before the fetch does, exactly as it would when a
      // click lands while the request is open.
      fetch.mockImplementation(() => {
        useLangyStore.getState().selectConversation("conv-2");
        return Promise.resolve({
          events: [
            accepted({ id: "e2", createdAt: 200 }),
            responded({ id: "e3", createdAt: 300 }),
          ],
          cursor: { acceptedAt: 300, eventId: "e3" },
          truncated: false,
        });
      });

      await catchUpConversationFold({
        utils,
        projectId: "p1",
        conversationId: "conv-1",
        targetCursor: { acceptedAt: 300, eventId: "e3" },
      });

      const projection = useLangyStore.getState().turnProjection;
      expect(projection.turn).toBeNull();
      expect(projection.cursor).toBeNull();
    });
  });

  describe("when the tail is still truncated at the page ceiling", () => {
    it("stops paging and refetches the history instead of staying behind", async () => {
      useLangyStore.getState().seedTurnProjection({
        cursor: { acceptedAt: 100, eventId: "e1" },
        currentTurnId: "turn-1",
      });
      const { utils, fetch, invalidate } = utilsWithPages([
        {
          events: [accepted({ id: "e2", createdAt: 200 })],
          cursor: { acceptedAt: 200, eventId: "e2" },
          truncated: true,
        },
      ]);

      await catchUpConversationFold({
        utils,
        projectId: "p1",
        conversationId: "conv-1",
        targetCursor: { acceptedAt: 900, eventId: "e9" },
      });

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(invalidate).toHaveBeenCalledWith({
        projectId: "p1",
        conversationId: "conv-1",
      });
    });
  });

  describe("when a durable cursor names a freshly minted conversation", () => {
    it("confirms it exists, so a later not-found read stops reading as pending", async () => {
      useLangyStore.setState({ unconfirmedConversations: { "conv-1": true } });
      const { utils } = utilsWith({});

      await catchUpConversationFold({
        utils,
        projectId: "p1",
        conversationId: "conv-1",
        targetCursor: { acceptedAt: 200, eventId: "e2" },
      });

      expect(useLangyStore.getState().unconfirmedConversations["conv-1"]).toBeUndefined();
    });
  });

  describe("when the local fold is already at or ahead of the target", () => {
    it("fetches nothing", async () => {
      useLangyStore.getState().seedTurnProjection({
        cursor: { acceptedAt: 300, eventId: "e3" },
        currentTurnId: "turn-1",
      });
      const { utils, fetch, invalidate } = utilsWith({});

      await catchUpConversationFold({
        utils,
        projectId: "p1",
        conversationId: "conv-1",
        targetCursor: { acceptedAt: 200, eventId: "e2" },
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });
  });

  describe("when the local fold has no cursor yet", () => {
    it("falls back to refetching the history instead of fetching a tail", async () => {
      const { utils, fetch, invalidate } = utilsWith({});

      await catchUpConversationFold({
        utils,
        projectId: "p1",
        conversationId: "conv-1",
        targetCursor: { acceptedAt: 200, eventId: "e2" },
      });

      expect(fetch).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledWith({
        projectId: "p1",
        conversationId: "conv-1",
      });
    });
  });
});
