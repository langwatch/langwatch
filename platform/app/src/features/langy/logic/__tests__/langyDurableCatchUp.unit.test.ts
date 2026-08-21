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
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyStore } from "../../stores/langyStore";
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

describe("catchUpConversationFold", () => {
  beforeEach(() => {
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject("project-test");
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
