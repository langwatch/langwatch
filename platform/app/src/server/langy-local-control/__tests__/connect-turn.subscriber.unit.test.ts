/**
 * The turn a folder is owed when it connected while the turn before still
 * read as in flight: started once that turn's end is folded, exactly once,
 * and not at all when the turn reached the folder or the share ended.
 *
 * @see specs/langy/langy-local-control.feature
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { beforeEach, describe, expect, it } from "vitest";
import { LangyTurnInProgressError } from "~/server/app-layer/langy/errors";
import {
  type AgentStateStore,
  createMemoryStateStore,
} from "~/server/connected-agents/state-store";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import type { ProjectionCursor } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { LocalCallDispatcher } from "../call.dispatcher";
import { createLocalConnectTurnSubscriber } from "../connect-turn.subscriber";
import { type ConnectedWorkspace, LocalWorkspacePresence } from "../presence";

const projectId = "proj_1";
const conversationId = "conv_1";
const context: EventSubscriberContext = {
  tenantId: projectId,
  aggregateId: conversationId,
};

let now = 1_700_000_000_000;
let store: AgentStateStore;
let presence: LocalWorkspacePresence;
/** Every turn the platform started for the folder. */
let startedTurns: { userId: string; text: string; idempotencyKey: string }[];
/** What the next turn start does: the admission row may still be held. */
let turnStartOutcome: "ok" | "in_progress";
/** Where the conversation's fold stands, and what it says. */
let folded: ProjectionCursor;
let status: string;

function workspace(requestId = "lcr_1"): ConnectedWorkspace {
  return {
    conversationId,
    projectId,
    userId: "user_1",
    requestId,
    instanceId: `lci_${requestId}`,
    hostname: "rogerio-mbp",
    connectedAt: now,
    lastSeenAt: now,
    workspace: {
      root: "/Users/dev/acme-app",
      name: "acme-app",
      os: "darwin",
    },
  };
}

/** The end of the turn that read as in flight, as the pipeline delivers it. */
function turnEnded(
  type: string = LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  id = "evt_2",
): LangyConversationProcessingEvent {
  return {
    id,
    aggregateId: conversationId,
    aggregateType: "langy_conversation",
    tenantId: projectId,
    createdAt: now,
    occurredAt: now,
    type,
    version: "1",
    data: { conversationId, turnId: "turn_2", parts: [] },
  } as unknown as LangyConversationProcessingEvent;
}

function subscriber() {
  return createLocalConnectTurnSubscriber({
    presence: () => presence,
    conversations: { read: async () => ({ cursor: folded, status }) },
    turns: {
      async start({ userId, text, idempotencyKey }) {
        if (turnStartOutcome === "in_progress") {
          throw new LangyTurnInProgressError();
        }
        startedTurns.push({ userId, text, idempotencyKey });
      },
    },
  });
}

/** What `afterRegister` leaves behind when the turn start was refused as in flight. */
async function connectWhileTheTurnReadsAsInFlight() {
  await presence.register(workspace());
  await presence.oweConnectTurn({
    conversationId,
    projectId,
    userId: "user_1",
    requestId: "lcr_1",
  });
}

beforeEach(() => {
  now = 1_700_000_000_000;
  store = createMemoryStateStore({ now: () => now });
  presence = new LocalWorkspacePresence({ store, now: () => now });
  startedTurns = [];
  turnStartOutcome = "ok";
  folded = { acceptedAt: now, eventId: "evt_2" };
  status = "idle";
});

describe("given a folder that connected while the turn before still read as in flight", () => {
  beforeEach(connectWhileTheTurnReadsAsInFlight);

  describe("when that turn's end is folded", () => {
    /** @scenario "A folder connected as a turn ends is answered once the turn's end is folded" */
    it("starts the connect turn once, under the key the direct start would have used", async () => {
      // The turn ended, the terminal connected nine seconds later and was
      // refused, and the end reaches the fold only after that.
      folded = { acceptedAt: now - 10_000, eventId: "evt_1" };
      await expect(subscriber().handle(turnEnded(), context)).rejects.toThrow(
        "has not projected",
      );
      expect(startedTurns).toEqual([]);

      folded = { acceptedAt: now, eventId: "evt_2" };
      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([
        {
          userId: "user_1",
          text: "Local folder connected",
          idempotencyKey: "local-connect:lcr_1",
        },
      ]);
      expect(await presence.readOwedConnectTurn(conversationId)).toBeNull();

      // The same end delivered again, and the next turn's end, start nothing.
      await subscriber().handle(turnEnded(), context);
      await subscriber().handle(
        turnEnded(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED, "evt_3"),
        context,
      );
      expect(startedTurns).toHaveLength(1);
    });

    /** @scenario "A folder connected as a turn ends is answered once the turn's end is folded" */
    it("keeps the debt while the ended turn's admission is still held, and pays it on the retry", async () => {
      turnStartOutcome = "in_progress";
      await expect(subscriber().handle(turnEnded(), context)).rejects.toThrow(
        LangyTurnInProgressError,
      );
      expect(startedTurns).toEqual([]);
      expect(await presence.readOwedConnectTurn(conversationId)).not.toBeNull();

      turnStartOutcome = "ok";
      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toHaveLength(1);
      expect(await presence.readOwedConnectTurn(conversationId)).toBeNull();
    });

    it("pays it on a failed turn's end as well", async () => {
      await subscriber().handle(
        turnEnded(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED),
        context,
      );
      expect(startedTurns).toHaveLength(1);
    });
  });

  describe("when the ended turn reached the folder", () => {
    /** @scenario "A folder connected as a turn ends is answered once the turn's end is folded" */
    it("starts nothing: the call it placed settled the debt", async () => {
      const dispatcher = new LocalCallDispatcher({
        store,
        presence,
        now: () => now,
        offlineWaitMs: 0,
        pollIntervalMs: 1,
      });
      await dispatcher.start({
        projectId,
        conversationId,
        turnId: "turn_2",
        call: { tool: "local_ls", params: { path: "." } },
        timeoutMs: 60_000,
      });
      expect(await presence.readOwedConnectTurn(conversationId)).toBeNull();

      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([]);
    });
  });

  describe("when a newer turn is already running as the end is folded", () => {
    it("leaves the debt for that turn's end", async () => {
      status = "running";
      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([]);
      expect(await presence.readOwedConnectTurn(conversationId)).not.toBeNull();
    });
  });

  describe("when the share ended before the turn did", () => {
    /** @scenario "A folder connected as a turn ends is answered once the turn's end is folded" */
    it("is owed nothing", async () => {
      await presence.deregister({ conversationId, instanceId: "lci_lcr_1" });
      expect(await presence.readOwedConnectTurn(conversationId)).toBeNull();

      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([]);
    });

    it("owes nothing to a newer share either, which connected on its own", async () => {
      await presence.register(workspace("lcr_2"));
      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([]);
      expect(await presence.readOwedConnectTurn(conversationId)).toBeNull();
    });
  });
});

describe("given a folder that is owed nothing", () => {
  it("starts nothing when a turn ends", async () => {
    await presence.register(workspace());
    await subscriber().handle(turnEnded(), context);
    expect(startedTurns).toEqual([]);
  });
});
