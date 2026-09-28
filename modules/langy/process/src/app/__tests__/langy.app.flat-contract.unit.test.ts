import { EventEmitter } from "node:events";

import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { GithubApi } from "@langwatch/github-contract";
import { langySecrets } from "@langwatch/langy-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OnboardingApi } from "@langwatch/onboarding-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { LangyConversationUpdateService } from "../../services/langy-conversation-update.service.ts";
import { LocalControlLongPollService } from "../../services/langy-local-control-long-poll.service.ts";
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

    const caller = { userId: "user_1", name: null, email: null };
    await app.listConversations({ projectId: "project_1", caller, limit: 10 });
    await app.getConversationEventsAfter({
      projectId: CONVERSATION.projectId,
      conversationId: CONVERSATION.conversationId,
      caller,
      after: { acceptedAt: 0, eventId: "" },
    });

    expect(getPage).toHaveBeenCalledOnce();
    expect(getEventsAfter).toHaveBeenCalledOnce();
  });

  it("resolves its own handle once and mints an internal credential at construction", async () => {
    const handles: unknown[] = [];
    const secrets = new ScopedSecrets(async (handle, build) => {
      handles.push(handle);
      return build("langy-test-secret");
    });
    const app = await createApp({ secrets });
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

  /** @scenario "A pod that shuts down retires its long-poll shares before closing the session store" */
  it("closes the long-poll sessions, then the session-state store, when the process shuts down", async () => {
    const owned: { name: string; close: () => void | Promise<void> }[] = [];
    const repositories = MemoryLangyRepositories.create();
    const closed: string[] = [];
    vi.spyOn(repositories.sessionState, "close").mockImplementation(async () => {
      closed.push("session state");
    });
    vi.spyOn(LocalControlLongPollService.prototype, "close").mockImplementation(async () => {
      closed.push("long-poll sessions");
    });
    await createApp({
      repositories,
      resources: { own: (name, close) => owned.push({ name, close }), ownService: () => void 0 },
    });

    for (const resource of [...owned].reverse()) await resource.close();

    expect(closed).toEqual(["long-poll sessions", "session state"]);
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

/** One tenant fabric, publishing the way presence's relays a project event to its listeners. */
function fabricPresence(fabric: EventEmitter): PresenceApi {
  return {
    ...fakePresence(),
    getTenantEmitter: () => fabric,
    publishProjectEvent: async ({ channel, event }) => {
      fabric.emit(channel, { event, timestamp: 0 });
    },
  };
}

async function untilListening(fabric: EventEmitter, count: number): Promise<void> {
  while (fabric.listenerCount("langy_conversation_updated") < count) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

type LangySetupResources = Parameters<typeof LangyApp.create>[0]["resources"];

async function createApp({
  presence = fakePresence(),
  secrets = noSecrets,
  resources = { own: () => void 0, ownService: () => void 0 },
  repositories = MemoryLangyRepositories.create(),
}: {
  presence?: PresenceApi;
  secrets?: ScopedSecrets;
  resources?: LangySetupResources;
  repositories?: ReturnType<typeof MemoryLangyRepositories.create>;
} = {}): Promise<LangyApp> {
  const app = await LangyApp.create({
    dependencies: {
      presence,
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => true }),
      users: createApiFixture<UserApi>(),
      github: createApiFixture<GithubApi>(),
      gateway: createApiFixture<GatewayApi>(),
      secrets: createApiFixture<SecretApi>(),
      experiments: createApiFixture<ExperimentApi>(),
      agents: createApiFixture<AgentApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      authz: createApiFixture<AuthzApi>({ isDemoProject: () => false }),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => "org_1",
      }),
      plans: createApiFixture<EntitlementApi>(),
      onboarding: createApiFixture<OnboardingApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    members: {
      publicBaseUrl: undefined,
      prisma: undefined!,
      // A throwing double rather than a Redis-less build: the reads this
      // suite exercises never reach the member, and a reach is a loud failure.
      redis: createApiFixture<RedisConnection>(),
      rateLimiter: { check: async () => ({ allowed: true }) },
    },
    config: {
      agentUrl: undefined,
      workerCallbackUrl: undefined,
      workerGatewayUrl: undefined,
      mirrorProjectId: undefined,
      gatewayInternalUrl: undefined,
      gatewayPublicUrl: undefined,
      gatewayLegacyUrl: undefined,
    },
    resources,
    secrets,
    repositories,
  });
  const registered = producerEventing().register(
    app.conversationPipeline({ participation: "produce" }),
  );
  app.connectConversationCommands(registered.commands);
  return app;
}

describe("given a private conversation's update published through presence", () => {
  /** @scenario "A private conversation's updates stay with its owner" */
  it("reaches the owner's watch and not another member's in the same project", async () => {
    const fabric = new EventEmitter();
    const presence = fabricPresence(fabric);
    const app = await createApp({ presence });
    const stop = new AbortController();
    const watch = (userId: string) =>
      app.watchConversationUpdates({
        projectId: "project_1",
        caller: { userId, name: null, email: null },
        signal: stop.signal,
      });
    const owner = watch("user_owner")[Symbol.asyncIterator]().next();
    const other = watch("user_other")[Symbol.asyncIterator]().next();
    await untilListening(fabric, 2);

    await LangyConversationUpdateService.create({ presence }).broadcastToTenant(
      "project_1",
      JSON.stringify({
        event: "langy_conversation_updated",
        conversationId: "langyconv_1",
        ownerUserId: "user_owner",
        isShared: false,
      }),
      "langy_conversation_updated",
    );

    await expect(owner).resolves.toMatchObject({
      done: false,
      value: { event: expect.stringContaining("langyconv_1") },
    });
    stop.abort();
    await expect(other).resolves.toEqual({ done: true, value: undefined });
  });
});
