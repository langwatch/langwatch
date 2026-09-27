/**
 * @vitest-environment node
 * The worker installed over memory stores delivers a gateway request end to end: the
 * delivery process manager, its endpoint stream, health, replay and the outbox all ride
 * the one process store the kernel supplies.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { WebhookApi } from "@langwatch/webhook-contract";
import { describe, expect, it, vi } from "vitest";

import { spendSteps } from "../../__tests__/fixtures/spend-delivery.fixtures.ts";
import { webhookServer } from "../../webhook.server.ts";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";

const entitledPlan: Plan = {
  planSource: "license",
  type: "enterprise",
  name: "Enterprise",
  free: false,
  maxMembers: 10,
  maxMembersLite: 10,
  maxMessagesPerMonth: 10,
  canPublish: true,
  webhookEndpointsEnabled: true,
  prices: { USD: 0, EUR: 0 },
};

function stores() {
  const members: Record<string, unknown> = {
    prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }),
    rateLimiter: { check: async () => ({ allowed: true }) },
    redis: memoryRedisDouble(),
  };

  return {
    order: ["prisma", "rateLimiter", "redis"],
    read: (name: string) => members[name],
  };
}

function worker() {
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });

  return createApp({ role: "worker" })
    .withModules([withMemoryRepositories(webhookServer)])
    .withConfig({ webhook: { allowInsecureLocalUrls: false, allowAmbientAwsCredentials: false } })
    .withStores(stores())
    .withEventing(eventing)
    .withMember("isSaas", false)
    .provide({
      entitlement: createApiFixture<EntitlementApi>({
        getActivePlan: async () => entitledPlan,
        requestBound: async () => 10,
      }),
    });
}

describe("given a memory-tier worker with one active HTTP endpoint", () => {
  describe("when gateway hands over a request's admitted and confirmed spend steps", () => {
    /** @scenario "A memory-tier worker delivers a completed gateway request to its endpoint" */
    it("records one delivery attempt for the endpoint", async () => {
      const runtime = await worker().boot();

      try {
        const webhooks = runtime.service(WebhookApi);
        const { endpoint } = await webhooks.create({
          organizationId: ORGANIZATION_ID,
          url: "https://10.0.0.1/hooks/spend",
          enabledEvents: ["gateway.request.completed"],
          maxBatchDelayMs: 0,
        });
        const { admitted, confirmed } = spendSteps({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          requestId: "gateway-request-1",
          admittedAt: Date.now(),
        });

        await webhooks.requestSpendDelivery(admitted);
        await webhooks.requestSpendDelivery(confirmed);

        // The egress fence refuses the private address: the attempt still reached the last hop.
        await vi.waitFor(
          async () => {
            const log = await webhooks.getDeliveries({
              organizationId: ORGANIZATION_ID,
              endpointId: endpoint.id,
            });
            expect(log.deliveries).toHaveLength(1);
          },
          { timeout: 8_000, interval: 100 },
        );
      } finally {
        await runtime.stop();
      }
    }, 15_000);
  });
});

describe("given a memory-tier worker with one active HTTP endpoint and an emitted envelope", () => {
  describe("when the envelope is replayed to the endpoint", () => {
    /** @scenario "A memory-tier replay is delivered through the worker's endpoint stream" */
    it("records one delivery attempt for the endpoint", async () => {
      const runtime = await worker().boot();

      try {
        const webhooks = runtime.service(WebhookApi);
        const { endpoint } = await webhooks.create({
          organizationId: ORGANIZATION_ID,
          url: "https://10.0.0.1/hooks/spend",
          enabledEvents: ["gateway.request.completed"],
          maxBatchDelayMs: 0,
        });

        await webhooks.appendReplayToEndpointStream({
          organizationId: ORGANIZATION_ID,
          endpoint,
          envelope: {
            id: "evt_replayed",
            type: "gateway.request.completed",
            created: new Date().toISOString(),
            schema_version: "1",
            data: {},
          },
          replayId: "replay-1",
        });

        await vi.waitFor(
          async () => {
            const log = await webhooks.getDeliveries({
              organizationId: ORGANIZATION_ID,
              endpointId: endpoint.id,
            });
            expect(log.deliveries).toHaveLength(1);
          },
          { timeout: 8_000, interval: 100 },
        );
      } finally {
        await runtime.stop();
      }
    }, 15_000);
  });
});

describe("given a memory-tier worker with an endpoint that holds envelopes for a minute", () => {
  describe("when a completed gateway request is still coalescing in its endpoint stream", () => {
    /** @scenario "Endpoint health reads the worker's pending endpoint stream" */
    it("reports the pending envelope as undelivered", async () => {
      const runtime = await worker().boot();

      try {
        const webhooks = runtime.service(WebhookApi);
        const { endpoint } = await webhooks.create({
          organizationId: ORGANIZATION_ID,
          url: "https://10.0.0.1/hooks/spend",
          enabledEvents: ["gateway.request.completed"],
          maxBatchDelayMs: 60_000,
        });
        const { admitted, confirmed } = spendSteps({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          requestId: "gateway-request-held",
          admittedAt: Date.now(),
        });

        await webhooks.requestSpendDelivery(admitted);
        await webhooks.requestSpendDelivery(confirmed);

        await vi.waitFor(
          async () => {
            const health = await webhooks.getHealth({
              organizationId: ORGANIZATION_ID,
              endpointId: endpoint.id,
            });
            expect(health.oldestUndeliveredAgeMs).not.toBeNull();
          },
          { timeout: 8_000, interval: 100 },
        );
      } finally {
        await runtime.stop();
      }
    }, 15_000);
  });
});
