/**
 * @vitest-environment jsdom
 *
 * Snapshot-then-fold-the-tail (ADR-059 §2/§3) driven through the REAL
 * coordinator: the Zustand store, the shared `@langwatch/langy` reducers and
 * the dev log all run for real — only the tRPC boundary
 * (`langy.conversationEventsAfter`, `langy.messages`) and the SSE listener are
 * mocked, which is what makes these integration tests rather than unit tests.
 *
 * What they protect is the contract between a signal's cursor and the local
 * fold's position. The signal carries NO conversation content, so the client
 * has to decide from cursors alone what it is missing, fetch exactly that, and
 * fold it exactly once — whether it is opening cold, was mid-load, dropped a
 * signal, got a whole burst as one signal, or was away entirely.
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  type LangyConversationTurnWireEvent,
  type LangyEventCursor,
} from "@langwatch/langy";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LangyConversationUpdateSignal } from "../../data/langy.dtos";

const PROJECT_ID = "project_test";
const CONVERSATION_ID = "conv_open";
const TURN_ID = "turn-1";

const messagesInvalidate = vi.fn(() => Promise.resolve());
const listInvalidate = vi.fn(() => Promise.resolve());
const listCancel = vi.fn(() => Promise.resolve());
const eventsAfterFetch = vi.fn();

// The callback the coordinator hands the SSE listener — driving it is how a
// test delivers a freshness signal through the real hook logic.
let capturedOnUpdate:
  | ((signals: LangyConversationUpdateSignal[]) => void)
  | null = null;

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: PROJECT_ID } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      langy: {
        messages: { invalidate: messagesInvalidate },
        list: { cancel: listCancel, invalidate: listInvalidate },
        conversationEventsAfter: { fetch: eventsAfterFetch },
      },
    }),
  },
}));

vi.mock("../useLangyConversationUpdateListener", () => ({
  useLangyConversationUpdateListener: (opts: {
    onConversationUpdated: (s: LangyConversationUpdateSignal[]) => void;
  }) => {
    capturedOnUpdate = opts.onConversationUpdated;
  },
}));

import { useLangyStore } from "../../stores/langyStore";
import { useLangyFreshness } from "../useLangyFreshness";

const at = (acceptedAt: number, eventId: string): LangyEventCursor => ({
  acceptedAt,
  eventId,
});

const accepted = (o: {
  id: string;
  createdAt: number;
  turnId?: string;
}): LangyConversationTurnWireEvent => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  data: { conversationId: CONVERSATION_ID, turnId: o.turnId ?? TURN_ID },
});

const toolInitiated = (o: {
  id: string;
  createdAt: number;
  turnId?: string;
  toolCallId?: string;
}): LangyConversationTurnWireEvent => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
  data: {
    conversationId: CONVERSATION_ID,
    turnId: o.turnId ?? TURN_ID,
    toolCallId: o.toolCallId ?? "call-1",
    toolName: "search_traces",
  },
});

const toolSucceeded = (o: {
  id: string;
  createdAt: number;
  turnId?: string;
  toolCallId?: string;
}): LangyConversationTurnWireEvent => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
  data: {
    conversationId: CONVERSATION_ID,
    turnId: o.turnId ?? TURN_ID,
    toolCallId: o.toolCallId ?? "call-1",
    toolName: "search_traces",
    durationMs: 12,
  },
});

const responded = (o: {
  id: string;
  createdAt: number;
  turnId?: string;
  text?: string;
}): LangyConversationTurnWireEvent => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  data: {
    conversationId: CONVERSATION_ID,
    turnId: o.turnId ?? TURN_ID,
    messageId: "msg-1",
    role: "assistant",
    parts: [{ type: "text", text: o.text ?? "here you go" }],
    outcome: "completed",
  },
});

const signalAt = (cursor: LangyEventCursor): LangyConversationUpdateSignal =>
  ({
    event: "langy_conversation_updated",
    conversationId: CONVERSATION_ID,
    cursor,
  }) as LangyConversationUpdateSignal;

const tail = (
  events: LangyConversationTurnWireEvent[],
  cursor: LangyEventCursor,
  truncated = false,
) => ({ events, cursor, truncated });

/** The snapshot read landing: the panel seeds the fold at the projection's position. */
const snapshotLoads = (cursor: LangyEventCursor, currentTurnId?: string) => {
  useLangyStore.getState().seedTurnProjection({ cursor, currentTurnId });
};

const deliverSignal = (cursor: LangyEventCursor) => {
  capturedOnUpdate?.([signalAt(cursor)]);
};

describe("the open conversation's catch-up from the recorded tail", () => {
  beforeEach(() => {
    messagesInvalidate.mockClear();
    listInvalidate.mockClear();
    listCancel.mockClear();
    eventsAfterFetch.mockReset();
    capturedOnUpdate = null;
    // A fresh page load: `scopeAnnounced` is never persisted, and without
    // clearing it a repeated same-scope reset is a deliberate no-op that would
    // leak projection state between tests.
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject(PROJECT_ID);
  });

  describe("given the snapshot has seeded the local fold", () => {
    describe("when a signal reports a position ahead of it", () => {
      /** @scenario Opening a conversation folds only what the snapshot has not seen */
      it("fetches the steps after the snapshot's position and folds just those", async () => {
        snapshotLoads(at(100, "evt_a"));
        eventsAfterFetch.mockResolvedValue(
          tail(
            [
              toolInitiated({ id: "evt_b", createdAt: 200 }),
              responded({ id: "evt_c", createdAt: 300 }),
            ],
            at(300, "evt_c"),
          ),
        );
        renderHook(() => useLangyFreshness(CONVERSATION_ID));

        deliverSignal(at(300, "evt_c"));

        await waitFor(() =>
          expect(useLangyStore.getState().turnProjection.cursor).toEqual(
            at(300, "evt_c"),
          ),
        );
        // The read is bounded BELOW by the snapshot's own position, so the
        // history the snapshot already folded is never asked for — one bounded
        // request, not a replay.
        expect(eventsAfterFetch).toHaveBeenCalledTimes(1);
        expect(eventsAfterFetch).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          after: at(100, "evt_a"),
        });
        const { turn } = useLangyStore.getState().turnProjection;
        expect(turn?.Status).toBe("completed");
        expect(turn?.ToolCalls).toHaveLength(1);
      });

      it("drops a served step the snapshot's position already covers", async () => {
        snapshotLoads(at(200, "evt_b"), TURN_ID);
        eventsAfterFetch.mockResolvedValue(
          tail(
            [
              // Sits AT the snapshot cursor — already folded into the snapshot.
              toolInitiated({ id: "evt_b", createdAt: 200 }),
              responded({ id: "evt_c", createdAt: 300 }),
            ],
            at(300, "evt_c"),
          ),
        );
        renderHook(() => useLangyFreshness(CONVERSATION_ID));

        deliverSignal(at(300, "evt_c"));

        await waitFor(() =>
          expect(useLangyStore.getState().turnProjection.turn?.Status).toBe(
            "completed",
          ),
        );
        expect(
          useLangyStore.getState().turnProjection.turn?.ToolCalls,
        ).toHaveLength(0);
      });
    });
  });

  describe("given the snapshot has not seeded the local fold yet", () => {
    describe("when a step is recorded and signalled mid-load", () => {
      it("re-reads the conversation instead of folding from an unknown position", async () => {
        renderHook(() => useLangyFreshness(CONVERSATION_ID));

        deliverSignal(at(200, "evt_b"));

        await waitFor(() =>
          expect(messagesInvalidate).toHaveBeenCalledWith({
            projectId: PROJECT_ID,
            conversationId: CONVERSATION_ID,
          }),
        );
        // There is no position to fetch "after" yet, so a tail read would be
        // guesswork — the snapshot re-read is what carries the step instead.
        expect(eventsAfterFetch).not.toHaveBeenCalled();
      });

      /** @scenario A step recorded while the snapshot was loading is not lost */
      it("folds that step exactly once from the position the snapshot reports", async () => {
        renderHook(() => useLangyFreshness(CONVERSATION_ID));
        // The step lands (and is signalled) while the snapshot read is still
        // in flight.
        deliverSignal(at(200, "evt_b"));
        await waitFor(() => expect(messagesInvalidate).toHaveBeenCalled());

        // The snapshot resolves at a position taken BEFORE the step.
        snapshotLoads(at(100, "evt_a"), TURN_ID);
        eventsAfterFetch.mockResolvedValue(
          tail([toolInitiated({ id: "evt_b", createdAt: 200 })], at(200, "evt_b")),
        );
        deliverSignal(at(200, "evt_b"));

        await waitFor(() =>
          expect(useLangyStore.getState().turnProjection.cursor).toEqual(
            at(200, "evt_b"),
          ),
        );
        expect(eventsAfterFetch).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          after: at(100, "evt_a"),
        });
        expect(
          useLangyStore.getState().turnProjection.turn?.ToolCalls,
        ).toHaveLength(1);

        // A re-delivery of the same signal is now at-or-behind the fold: no
        // second read, and the folded document is the very same object — the
        // step landed once, not twice.
        const folded = useLangyStore.getState().turnProjection;
        deliverSignal(at(200, "evt_b"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(eventsAfterFetch).toHaveBeenCalledTimes(1);
        expect(useLangyStore.getState().turnProjection).toBe(folded);
      });
    });
  });

  describe("given a live signal never arrived", () => {
    describe("when the next signal does", () => {
      /** @scenario A missed live signal is repaired by the next one */
      it("catches up from its own position, folding the skipped step too", async () => {
        snapshotLoads(at(100, "evt_a"), TURN_ID);
        // evt_b's signal was dropped on the wire; only evt_c's arrives, and it
        // is the local position — not the signalled one — that bounds the read.
        eventsAfterFetch.mockResolvedValue(
          tail(
            [
              toolInitiated({ id: "evt_b", createdAt: 200 }),
              responded({ id: "evt_c", createdAt: 300 }),
            ],
            at(300, "evt_c"),
          ),
        );
        renderHook(() => useLangyFreshness(CONVERSATION_ID));

        deliverSignal(at(300, "evt_c"));

        await waitFor(() =>
          expect(useLangyStore.getState().turnProjection.cursor).toEqual(
            at(300, "evt_c"),
          ),
        );
        expect(eventsAfterFetch).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          after: at(100, "evt_a"),
        });
        const { turn } = useLangyStore.getState().turnProjection;
        expect(turn?.ToolCalls.map((call) => call.toolCallId)).toEqual([
          "call-1",
        ]);
        expect(turn?.Status).toBe("completed");
      });

      it("folds an overlapping re-serve of the same steps only once", async () => {
        snapshotLoads(at(100, "evt_a"), TURN_ID);
        eventsAfterFetch.mockResolvedValueOnce(
          tail(
            [
              toolInitiated({ id: "evt_b", createdAt: 200 }),
              responded({ id: "evt_c", createdAt: 300 }),
            ],
            at(300, "evt_c"),
          ),
        );
        renderHook(() => useLangyFreshness(CONVERSATION_ID));
        deliverSignal(at(300, "evt_c"));
        await waitFor(() =>
          expect(useLangyStore.getState().turnProjection.cursor).toEqual(
            at(300, "evt_c"),
          ),
        );

        // The next tail re-serves the steps already folded alongside the new one.
        eventsAfterFetch.mockResolvedValueOnce(
          tail(
            [
              toolInitiated({ id: "evt_b", createdAt: 200 }),
              responded({ id: "evt_c", createdAt: 300 }),
              toolSucceeded({ id: "evt_d", createdAt: 400 }),
            ],
            at(400, "evt_d"),
          ),
        );
        deliverSignal(at(400, "evt_d"));

        await waitFor(() =>
          expect(useLangyStore.getState().turnProjection.cursor).toEqual(
            at(400, "evt_d"),
          ),
        );
        const { turn } = useLangyStore.getState().turnProjection;
        expect(turn?.ToolCalls).toHaveLength(1);
        expect(turn?.ToolCalls[0]?.status).toBe("succeeded");
        expect(turn?.AnswerParts).toHaveLength(1);
      });
    });
  });

  describe("given several steps were recorded in a quick burst", () => {
    describe("when the burst reaches the tab as a single coalesced signal", () => {
      /** @scenario Coalesced signals still deliver every recorded step */
      it("pages through the tail until every step of the burst is folded", async () => {
        snapshotLoads(at(100, "evt_a"));
        eventsAfterFetch
          .mockResolvedValueOnce(
            tail(
              [
                accepted({ id: "evt_b", createdAt: 200 }),
                toolInitiated({ id: "evt_c", createdAt: 300 }),
              ],
              at(300, "evt_c"),
              true,
            ),
          )
          .mockResolvedValueOnce(
            tail(
              [
                toolSucceeded({ id: "evt_d", createdAt: 400 }),
                responded({ id: "evt_e", createdAt: 500 }),
              ],
              at(500, "evt_e"),
            ),
          );
        renderHook(() => useLangyFreshness(CONVERSATION_ID));

        deliverSignal(at(500, "evt_e"));

        await waitFor(() =>
          expect(useLangyStore.getState().turnProjection.cursor).toEqual(
            at(500, "evt_e"),
          ),
        );
        // One signal, but the truncated first page is resumed from its own
        // cursor rather than abandoned — no step of the burst is left behind.
        expect(eventsAfterFetch).toHaveBeenCalledTimes(2);
        expect(eventsAfterFetch).toHaveBeenLastCalledWith({
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          after: at(300, "evt_c"),
        });
        const { turn } = useLangyStore.getState().turnProjection;
        expect(turn?.ToolCalls).toHaveLength(1);
        expect(turn?.ToolCalls[0]?.status).toBe("succeeded");
        expect(turn?.Status).toBe("completed");
      });
    });
  });

  describe("given the tab was away while Langy finished the turn", () => {
    describe("when it reconnects and the first signal lands", () => {
      /** @scenario Reconnecting after being away catches up in one step */
      it("folds the settled turn in one fetch and hands the composer back", async () => {
        // Away mid-turn: the snapshot named a turn in flight, so this tab is
        // tracking it and the composer is withheld.
        snapshotLoads(at(100, "evt_a"), TURN_ID);
        expect(useLangyStore.getState().turnPhase).toBe("active");
        eventsAfterFetch.mockResolvedValue(
          tail(
            [
              toolSucceeded({ id: "evt_b", createdAt: 200 }),
              responded({ id: "evt_c", createdAt: 300, text: "all done" }),
            ],
            at(300, "evt_c"),
          ),
        );
        renderHook(() => useLangyFreshness(CONVERSATION_ID));

        deliverSignal(at(300, "evt_c"));

        await waitFor(() =>
          expect(useLangyStore.getState().turnPhase).toBe("idle"),
        );
        // One fetch — everything missed while away arrives in a single tail.
        expect(eventsAfterFetch).toHaveBeenCalledTimes(1);
        const { turn } = useLangyStore.getState().turnProjection;
        expect(turn?.Status).toBe("completed");
        expect(turn?.AnswerParts).toEqual([
          { type: "text", text: "all done" },
        ]);
        // The folded terminal is what pulls the completed reply into the
        // message history the thread renders.
        expect(messagesInvalidate).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
        });
        // `Composer.tsx` gates sending on exactly this: canSend requires the
        // turn phase to be idle.
        expect(useLangyStore.getState().turnPhase).toBe("idle");
      });
    });
  });
});
