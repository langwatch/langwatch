/**
 * @vitest-environment node
 * A person who leaves takes their browsers: notification removes its own rows from
 * user's and identity's facts (§9), and the outbox retry ladder stays inside a day.
 * Spec: modules/notification/specs/web-push.feature
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { USER_ERASED_EVENT_TYPE, userErasedPayloadSchema } from "@langwatch/identity-contract";
import {
  USER_DEACTIVATED_EVENT_TYPE,
  userLifecycleEventDataSchema,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryWebPushGatewayChannel } from "../../channels/memory/memory.web-push-gateway.channel.ts";
import { MemoryWebPushSubscriptionRepository } from "../../repositories/memory/memory.web-push-subscription.repository.ts";
import { MemoryWebPushVapidKeyRepository } from "../../repositories/memory/memory.web-push-vapid-key.repository.ts";
import { WebPushService } from "../../services/web-push.service.ts";
import { buildWebPushPipeline, webPushRetryDelayMs } from "../web-push.pipeline.ts";

const USER_ID = "user_ada";

/** User's and identity's pipelines as their contracts name the events. */
function ownerStandIn() {
  return definePipeline({
    name: "owner_stand_in",
    aggregate: defineAggregate({ type: "user_account" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(USER_DEACTIVATED_EVENT_TYPE),
        data: userLifecycleEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(USER_ERASED_EVENT_TYPE),
        data: userErasedPayloadSchema,
      }),
    ])
    .build();
}

type LeavingFact =
  | {
      type: typeof USER_DEACTIVATED_EVENT_TYPE;
      data: z.infer<typeof userLifecycleEventDataSchema>;
    }
  | { type: typeof USER_ERASED_EVENT_TYPE; data: z.infer<typeof userErasedPayloadSchema> };

async function harness() {
  const subscriptions = MemoryWebPushSubscriptionRepository.create();
  await subscriptions.upsert({
    userId: USER_ID,
    endpoint: "https://fcm.googleapis.com/fcm/send/laptop",
    p256dh: "key",
    auth: "auth",
    userAgent: null,
  });
  const processStore = InMemoryProcessStore.createForTesting();
  const webPush = WebPushService.create({
    subscriptions,
    vapidKeys: MemoryWebPushVapidKeyRepository.create(),
    gateway: MemoryWebPushGatewayChannel.create(),
    settings: { publicBaseUrl: undefined },
    queue: () => undefined,
  });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore,
  });
  const owner = eventing.register(ownerStandIn());
  eventing.register(buildWebPushPipeline({ webPush, processStore }));
  const store = (fact: LeavingFact) =>
    owner.service.storeEvents(
      [
        {
          id: `event-${fact.type}`,
          aggregateId: USER_ID,
          aggregateType: "user_account",
          tenantId: createTenantId(USER_ID),
          version: "2026-10-01",
          createdAt: 10,
          occurredAt: 10,
          ...fact,
        },
      ],
      { tenantId: createTenantId(USER_ID) },
    );
  return { eventing, store, subscriptions };
}

describe("given a person subscribed on a browser", () => {
  describe("when user records the person deactivated", () => {
    /** @scenario "A deactivated person's devices are removed" */
    it("deletes their subscriptions", async () => {
      const { eventing, store, subscriptions } = await harness();

      await store({
        type: USER_DEACTIVATED_EVENT_TYPE,
        data: { tenantId: USER_ID, userId: USER_ID, occurredAt: 10 },
      });

      await vi.waitFor(async () => expect(await subscriptions.findByUser(USER_ID)).toEqual([]));
      await eventing.close();
    });
  });

  describe("when identity records the person erased", () => {
    /** @scenario "An erased person's devices are removed" */
    it("deletes their subscriptions", async () => {
      const { eventing, store, subscriptions } = await harness();

      await store({
        type: USER_ERASED_EVENT_TYPE,
        data: { userId: USER_ID, erasedIdentifierIds: [], actor: { type: "system", id: null } },
      });

      await vi.waitFor(async () => expect(await subscriptions.findByUser(USER_ID)).toEqual([]));
      await eventing.close();
    });
  });
});

describe("the send retry ladder", () => {
  /** @scenario "A busy or failing push service is retried with backoff" */
  it("backs off exponentially and caps at fifteen minutes", () => {
    expect(webPushRetryDelayMs({ attempt: 1 })).toBe(5_000);
    expect(webPushRetryDelayMs({ attempt: 2 })).toBe(10_000);
    expect(webPushRetryDelayMs({ attempt: 20 })).toBe(15 * 60 * 1000);
  });
});
