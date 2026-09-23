import { EventEmitter } from "node:events";

import { createApiFixture } from "@langwatch/api-fixture";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { langySecrets } from "@langwatch/langy-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it, vi } from "vitest";

import type { LangyRepositories } from "../../repositories/langy-repositories.registry.ts";
import { LangyApp } from "../langy.app.ts";

const CONVERSATION = {
  projectId: "project_1",
  conversationId: "conversation_1",
  userId: "user_1",
};

describe("LangyApp", () => {
  it("calls the matching flat service methods through the real feature factory", async () => {
    const app = await createApp();
    const getPage = vi.spyOn(app.langyService, "getPage").mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const getEventsAfter = vi.spyOn(app.langyService, "getEventsAfter").mockResolvedValue({
      events: [],
      cursor: { acceptedAt: 0, eventId: "" },
      truncated: false,
    });

    await app.listPage({ projectId: "project_1", userId: "user_1", limit: 10 });
    await app.eventsAfter({ ...CONVERSATION, after: { acceptedAt: 0, eventId: "" } });

    expect(getPage).toHaveBeenCalledOnce();
    expect(getEventsAfter).toHaveBeenCalledOnce();
  });

  it("resolves its own handle once and mints an internal credential at construction", async () => {
    const handles: unknown[] = [];
    const secrets = new ScopedSecrets(async (handle, build) => {
      handles.push(handle);
      return build("langy-test-secret");
    });
    const app = await createApp(secrets);
    expect(handles).toEqual([langySecrets.internal]);
    const door = app.internalDoor;
    if (!door.identify) throw new Error("The Langy internal credential has no identify operation");
    expect(
      await door.identify({
        request: new Request("http://local/internal", {
          headers: { authorization: "Bearer langy-test-secret" },
        }),
      }),
    ).toMatchObject({ internal: { secretName: "langy-internal" } });
    expect(() =>
      door.identify?.({
        request: new Request("http://local/internal", {
          headers: { authorization: "Bearer wrong-secret" },
        }),
      }),
    ).toThrow(expect.objectContaining({ code: "unauthorized" }));
    expect(handles).toHaveLength(1);
  });

  it("keeps one service instance behind the application", async () => {
    const app = await createApp();
    expect(app.langyService).toBe(app.langyService);
  });
});

/** Records what a producer enqueued; a producer-only process starts no consumer. */
function recordingQueue() {
  const sent: Record<string, unknown>[] = [];
  const factory = (
    _definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>> => ({
    async send(payload) {
      sent.push(payload);
    },
    async sendBatch(payloads) {
      sent.push(...payloads);
    },
    async waitUntilReady() {},
    async close() {},
  });
  return { sent, factory };
}

/**
 * A real, minimal producer-only `EventSourcing`: no Redis, no ClickHouse,
 * just an in-memory queue recording what the pipeline sends. `EventSourcing`
 * holds private state, so only a real instance satisfies its type.
 */
function producerEventing(): EventSourcing {
  const queue = recordingQueue();
  return new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: "langwatch-test" }),
    queueFactory: queue.factory,
    consumersEnabled: false,
    executionTarget: "api",
    processManagerMode: "producer-only",
  });
}

function fakePresence(): PresenceApi {
  return {
    isEnabledForProject: () => Promise.resolve(true),
    update: () => Promise.resolve(),
    leave: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    publishProjectEvent: () => Promise.resolve(),
    broadcastCursor: () => Promise.resolve(),
    events: async function* () {},
    cursors: async function* () {},
    getTenantEmitter: () => new EventEmitter(),
    cleanupTenantEmitter: () => void 0,
  };
}

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

function createApp(secrets = noSecrets): Promise<LangyApp> {
  return LangyApp.create({
    dependencies: {
      presence: fakePresence(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => "org_1",
      }),
      plans: createApiFixture<EntitlementApi>(),
    },
    members: {
      prisma: undefined!,
      // A throwing double rather than a Redis-less build: the reads this
      // suite exercises never reach the member, and a reach is a loud failure.
      redis: createApiFixture<RedisConnection>(),
      eventing: producerEventing(),
      rateLimiter: { check: async () => ({ allowed: true }) },
    },
    config: { agentUrl: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets,
    repositories: {} as LangyRepositories,
  });
}
