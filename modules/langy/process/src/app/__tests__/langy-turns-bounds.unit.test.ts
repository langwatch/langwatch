/**
 * `LangyApp.startConversationTurn` — every turn is counted against the
 * project's tier-effective window before it dispatches; an over-limit caller
 * never reaches the engine.
 * @vitest-environment node
 */
import { EventEmitter } from "node:events";

import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GithubApi } from "@langwatch/github-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { ScopedSecrets } from "@langwatch/secrets";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { LangyApp } from "../langy.app.ts";

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

const TIER_PLAN_TYPE: Record<string, string> = {
  "org-free": "FREE",
  "org-enterprise": "ENTERPRISE",
};

/** A real fixed window: each key counts its own checks, refused past the allowance named. */
function windowLimiter(): RateLimiter {
  const used = new Map<string, number>();
  return {
    check: (key, limit) => {
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      const requests = limit?.requests ?? Number.POSITIVE_INFINITY;

      return Promise.resolve(
        count <= requests ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 },
      );
    },
  };
}

function recordingEventing(): EventSourcing {
  const factory = (
    _definition: EventSourcedQueueDefinition<Record<string, unknown>>,
  ): EventSourcedQueueProcessor<Record<string, unknown>> => ({
    async send() {},
    async sendBatch() {},
    async waitUntilReady() {},
    async close() {},
  });
  return new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: "langwatch-test" }),
    queueFactory: factory,
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

async function harness() {
  const app = await LangyApp.create({
    dependencies: {
      presence: fakePresence(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      users: createApiFixture<UserApi>(),
      github: createApiFixture<GithubApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      authz: createApiFixture<AuthzApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async (projectId) =>
          projectId === "project-enterprise" ? "org-enterprise" : "org-free",
      }),
      plans: createApiFixture<EntitlementApi>({
        requestBound: ({ key, organizationId }) =>
          Promise.resolve(resolveRequestBound(key, TIER_PLAN_TYPE[organizationId] ?? "FREE")),
      }),
    },
    members: {
      publicBaseUrl: undefined,
      prisma: undefined!,
      // A throwing double rather than a Redis-less build: the turn paths this
      // suite exercises never reach the member, and a reach is a loud failure.
      redis: createApiFixture<RedisConnection>(),
      eventing: recordingEventing(),
      rateLimiter: windowLimiter(),
    },
    config: { agentUrl: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: noSecrets,
    repositories: MemoryLangyRepositories.create(),
  });

  const dispatched = vi
    .spyOn(app.langyService, "startConversationTurn")
    .mockResolvedValue({ conversationId: "conversation_1", turnId: "turn_1" });

  const startTurn = (projectId: string) =>
    app.startConversationTurn({
      projectId,
      idempotencyKey: `turn-${projectId}-${dispatched.mock.calls.length}`,
      session: { user: { id: "user_1" } },
      requestedConversationId: null,
      messages: [{ role: "user", parts: [] }],
      isRetry: false,
      turnContext: {},
    });

  return { startTurn, dispatched };
}

const FREE_TURNS_PER_MINUTE = resolveRequestBound("langyTurnsPerMinute", "FREE");

describe("LangyApp.startConversationTurn", () => {
  describe("given a free-tier project under its turn ceiling", () => {
    it("dispatches every turn", async () => {
      const { startTurn, dispatched } = await harness();

      for (let index = 0; index < FREE_TURNS_PER_MINUTE; index++) {
        await expect(startTurn("project-free")).resolves.toEqual({
          conversationId: "conversation_1",
          turnId: "turn_1",
        });
      }
      expect(dispatched).toHaveBeenCalledTimes(FREE_TURNS_PER_MINUTE);
    });
  });

  describe("given a free-tier project at its turn ceiling", () => {
    it("refuses the next turn 429 and never dispatches it", async () => {
      const { startTurn, dispatched } = await harness();
      for (let index = 0; index < FREE_TURNS_PER_MINUTE; index++) {
        await startTurn("project-free");
      }
      dispatched.mockClear();

      const refusal = await startTurn("project-free").catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "langy_turns_rate_limited",
        httpStatus: 429,
        retryable: true,
        fault: "customer",
        meta: { retryAfterSeconds: 60 },
      });
      expect(dispatched).not.toHaveBeenCalled();
    });
  });

  describe("given an enterprise project past the free turn ceiling", () => {
    it("dispatches the turn: the ceiling is tier-resolved, not static", async () => {
      const { startTurn, dispatched } = await harness();
      for (let index = 0; index < FREE_TURNS_PER_MINUTE; index++) {
        await startTurn("project-enterprise");
      }

      await expect(startTurn("project-enterprise")).resolves.toEqual({
        conversationId: "conversation_1",
        turnId: "turn_1",
      });
      expect(dispatched).toHaveBeenCalledTimes(FREE_TURNS_PER_MINUTE + 1);
    });
  });
});
