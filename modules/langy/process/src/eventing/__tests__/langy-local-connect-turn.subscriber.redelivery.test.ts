/**
 * Redelivery of a folded turn end starts the owed connect turn once: the debt is settled on the
 * first delivery, and the turn start carries the direct start's own idempotency key.
 * @see specs/langy/langy-local-control.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { LangyMemoryStore } from "../../repositories/memory/langy-memory.store.ts";
import { LangyLocalPresenceMemoryRepository } from "../../repositories/memory/memory.langy-local-presence.repository.ts";
import { createLocalConnectTurnSubscriber } from "../langy-local-connect-turn.subscriber.ts";
import { agentRespondedEvent, CONVERSATION_ID, PROJECT_ID, T0 } from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

describe("createLocalConnectTurnSubscriber redelivery", () => {
  it("starts one connect turn when the same turn end is handled twice", async () => {
    const presence = LangyLocalPresenceMemoryRepository.create(LangyMemoryStore.create());
    await presence.register({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      userId: "user_1",
      requestId: "lcr_1",
      instanceId: "lci_lcr_1",
      hostname: "rogerio-mbp",
      connectedAt: T0,
      lastSeenAt: T0,
      workspace: { root: "/Users/dev/acme-app", name: "acme-app", os: "darwin" },
    });
    await presence.oweConnectTurn({
      conversationId: CONVERSATION_ID,
      projectId: PROJECT_ID,
      userId: "user_1",
      requestId: "lcr_1",
    });
    const started: string[] = [];
    const subscriber = createLocalConnectTurnSubscriber({
      presence: () => presence,
      conversations: {
        read: async () => ({ cursor: { acceptedAt: T0, eventId: "evt_2" }, status: "idle" }),
      },
      turns: {
        async start({ idempotencyKey }) {
          started.push(idempotencyKey);
        },
      },
    });
    const turnEnded = agentRespondedEvent({ id: "evt_2", occurredAt: T0, turnId: "turn_2" });

    await subscriber.handle(turnEnded, context);
    await subscriber.handle(turnEnded, context);

    expect(started).toEqual(["local-connect:lcr_1"]);
  });
});
