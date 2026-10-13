/**
 * @vitest-environment node
 * A Langy event delivered twice asks notification for one push.
 * Spec: specs/langy/langy-notifications.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import type { RequestWebPushDeliveryCommand } from "@langwatch/notification-contract";
import { describe, expect, it } from "vitest";

import { createLangyWebPushSubscriber } from "../langy-web-push.subscriber.ts";
import {
  agentRespondedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  T0,
  USER_ID,
} from "./langyEventFixtures.ts";

/** Notification's queue as far as a producer sees it: one push per idempotency key. */
class KeyedPushQueue {
  readonly pushes = new Map<string, RequestWebPushDeliveryCommand>();

  async requestWebPushDelivery(input: RequestWebPushDeliveryCommand): Promise<{ queued: number }> {
    if (this.pushes.has(input.idempotencyKey)) return { queued: 0 };
    this.pushes.set(input.idempotencyKey, input);
    return { queued: 1 };
  }
}

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

describe("given a long turn's finish delivered twice", () => {
  /** @scenario "A redelivered Langy event asks for the same push" */
  it("leaves one push queued for the owner", async () => {
    const queue = new KeyedPushQueue();
    const subscriber = createLangyWebPushSubscriber({
      conversations: { find: async () => ({ ownerUserId: USER_ID, title: "Weekly costs" }) },
      turnStartedAt: async () => T0 - 90_000,
      users: { getNotificationPreference: async ({ topic }) => ({ topic, choice: "enabled" }) },
      projects: { findSummaryById: async () => ({ name: "ACME", slug: "acme-x1y2" }) },
      notifications: queue,
    });
    const finished = agentRespondedEvent({
      id: "evt_done",
      occurredAt: T0,
      turnId: "turn-1",
      outcome: "completed",
    });

    await subscriber.handle(finished, context);
    await subscriber.handle(finished, context);

    expect([...queue.pushes.keys()]).toEqual(["langy:evt_done"]);
  });
});
