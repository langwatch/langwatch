/**
 * The owed connect turn: started once the ended turn's end is folded, exactly once, and not at
 * all when the turn reached the folder or the share ended.
 * @see specs/langy/langy-local-control.feature
 */
import type { EventSubscriberContext, ProjectionCursor } from "@langwatch/eventing";
import { LangyTurnInProgressError } from "@langwatch/langy-contract";
import { beforeEach, describe, expect, it } from "vitest";

import type { ConnectedWorkspace } from "../../repositories/langy-local-presence.repository.ts";
import { LangyMemoryStore } from "../../repositories/memory/langy-memory.store.ts";
import { LangyLocalPresenceMemoryRepository } from "../../repositories/memory/memory.langy-local-presence.repository.ts";
import { createLocalConnectTurnSubscriber } from "../langy-local-connect-turn.subscriber.ts";
import {
  agentRespondedEvent,
  agentResponseFailedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  T0,
} from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

let presence: LangyLocalPresenceMemoryRepository;
let startedTurns: { userId: string; text: string; idempotencyKey: string }[];
let turnStartOutcome: "ok" | "in_progress";
let folded: ProjectionCursor;
let status: string;

function workspace(requestId = "lcr_1"): ConnectedWorkspace {
  return {
    conversationId: CONVERSATION_ID,
    projectId: PROJECT_ID,
    userId: "user_1",
    requestId,
    instanceId: `lci_${requestId}`,
    hostname: "rogerio-mbp",
    connectedAt: T0,
    lastSeenAt: T0,
    workspace: { root: "/Users/dev/acme-app", name: "acme-app", os: "darwin" },
  };
}

const turnEnded = (id = "evt_2") => agentRespondedEvent({ id, occurredAt: T0, turnId: "turn_2" });

function subscriber() {
  return createLocalConnectTurnSubscriber({
    presence: () => presence,
    conversations: { read: async () => ({ cursor: folded, status }) },
    turns: {
      async start({ userId, text, idempotencyKey }) {
        if (turnStartOutcome === "in_progress") throw new LangyTurnInProgressError();
        startedTurns.push({ userId, text, idempotencyKey });
      },
    },
  });
}

beforeEach(() => {
  presence = LangyLocalPresenceMemoryRepository.create(LangyMemoryStore.create());
  startedTurns = [];
  turnStartOutcome = "ok";
  folded = { acceptedAt: T0, eventId: "evt_2" };
  status = "idle";
});

describe("given a folder that connected while the turn before still read as in flight", () => {
  beforeEach(async () => {
    await presence.register(workspace());
    await presence.oweConnectTurn({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      userId: "user_1",
      requestId: "lcr_1",
    });
  });

  describe("when that turn's end is folded", () => {
    /** @scenario "A folder connected as a turn ends is answered once the turn's end is folded" */
    it("starts the connect turn once, under the key the direct start would have used", async () => {
      folded = { acceptedAt: T0 - 10_000, eventId: "evt_1" };
      await expect(subscriber().handle(turnEnded(), context)).rejects.toThrow("has not projected");
      expect(startedTurns).toEqual([]);

      folded = { acceptedAt: T0, eventId: "evt_2" };
      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([
        {
          userId: "user_1",
          text: "Local folder connected",
          idempotencyKey: "local-connect:lcr_1",
        },
      ]);
      expect(await presence.readOwedConnectTurn(CONVERSATION_ID)).toBeNull();

      await subscriber().handle(turnEnded(), context);
      await subscriber().handle(turnEnded("evt_3"), context);
      expect(startedTurns).toHaveLength(1);
    });

    it("keeps the debt while the ended turn's admission is still held, and pays it on the retry", async () => {
      turnStartOutcome = "in_progress";
      await expect(subscriber().handle(turnEnded(), context)).rejects.toThrow(
        LangyTurnInProgressError,
      );
      expect(await presence.readOwedConnectTurn(CONVERSATION_ID)).not.toBeNull();

      turnStartOutcome = "ok";
      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toHaveLength(1);
      expect(await presence.readOwedConnectTurn(CONVERSATION_ID)).toBeNull();
    });

    it("pays it on a failed turn's end as well", async () => {
      await subscriber().handle(
        agentResponseFailedEvent({ id: "evt_2", occurredAt: T0, turnId: "turn_2" }),
        context,
      );
      expect(startedTurns).toHaveLength(1);
    });
  });

  describe("when the ended turn reached the folder", () => {
    /** @scenario "A folder connected as a turn ends is answered once the turn's end is folded" */
    it("starts nothing: the call it placed settled the debt", async () => {
      // What the call dispatcher does on the turn's first call to the folder.
      await presence.settleOwedConnectTurn(CONVERSATION_ID);

      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([]);
    });
  });

  describe("when a newer turn is already running as the end is folded", () => {
    it("leaves the debt for that turn's end", async () => {
      status = "running";
      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([]);
      expect(await presence.readOwedConnectTurn(CONVERSATION_ID)).not.toBeNull();
    });
  });

  describe("when the share ended before the turn did", () => {
    /** @scenario "A folder connected as a turn ends is answered once the turn's end is folded" */
    it("is owed nothing", async () => {
      await presence.deregister({ conversationId: CONVERSATION_ID, instanceId: "lci_lcr_1" });

      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([]);
    });

    it("owes nothing to a newer share either, which connected on its own", async () => {
      await presence.register(workspace("lcr_2"));
      await subscriber().handle(turnEnded(), context);
      expect(startedTurns).toEqual([]);
      expect(await presence.readOwedConnectTurn(CONVERSATION_ID)).toBeNull();
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
