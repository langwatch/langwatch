/**
 * @vitest-environment node
 * Redelivery of gateway's facts to webhook's peer subscribers, on a memory-tier worker: the
 * same event handled twice yields one delivery and one requested event per event id.
 * @see modules/webhook/specs/webhook-gateway-events.feature
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
} from "@langwatch/gateway-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE, WebhookApi } from "@langwatch/webhook-contract";
import { describe, expect, it, vi } from "vitest";

import { spendSteps } from "../../__tests__/fixtures/spend-delivery.fixtures.ts";
import { webhookProcessModule } from "../../webhook.module.ts";
import { webhookGatewayEventSubscribers } from "../webhook-gateway-events.subscriber.ts";

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

function worker(eventStore: EventStoreMemory) {
  const eventing = new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });

  return createApp({ role: "worker" })
    .withModules([withMemoryRepositories(webhookProcessModule)])
    .withConfig({
      webhook: {
        allowInsecureLocalUrls: false,
        allowAmbientAwsCredentials: false,
      },
    })
    .withStores(stores())
    .withEventing(eventing)
    .withMember("isSaas", false)
    .withMember("outboundProxy", {})
    .provide({
      entitlement: createApiFixture<EntitlementApi>({
        getActivePlan: async () => entitledPlan,
        requestBound: async () => 10,
      }),
      project: createApiFixture<ProjectApi>({ listIdsByOrganization: async () => [] }),
    });
}

describe("given a memory-tier worker with one active HTTP endpoint and webhook's gateway subscribers", () => {
  describe("when a request's admitted and confirmed spend events each reach the subscribers twice", () => {
    /** @scenario "A redelivered gateway spend event is delivered once" */
    it("records one delivery attempt and one requested event per gateway event", async () => {
      const eventStore = EventStoreMemory.createForTesting();
      const runtime = await worker(eventStore).boot();

      try {
        await runtime.start();
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
          requestId: "gateway-request-redelivered",
          admittedAt: Date.now(),
        });
        if (
          admitted.spend.type !== GATEWAY_SPEND_ADMITTED_EVENT_TYPE ||
          confirmed.spend.type !== GATEWAY_SPEND_CONFIRMED_EVENT_TYPE
        ) {
          throw new Error("the fixture's steps changed type");
        }
        const subscribers = webhookGatewayEventSubscribers((request) =>
          webhooks.requestGatewayEventDelivery(request),
        );
        const context = (eventId: string) => ({
          tenantId: PROJECT_ID,
          aggregateId: "gateway-request-redelivered",
          occurredAt: Date.now(),
          eventId,
        });

        for (let delivery = 0; delivery < 2; delivery++) {
          await subscribers.gatewaySpendAdmittedDelivery.handle(
            admitted.spend.data,
            context("evt-admitted"),
          );
          await subscribers.gatewaySpendConfirmedDelivery.handle(
            confirmed.spend.data,
            context("evt-confirmed"),
          );
        }

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
        const requested = await eventStore.getEvents({
          aggregateId: "gateway-request-redelivered",
          aggregateType: WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE,
          context: { tenantId: createTenantId(PROJECT_ID) },
        });
        expect(requested.map((event) => event.idempotencyKey)).toEqual([
          "evt-admitted",
          "evt-confirmed",
        ]);
      } finally {
        await runtime.stop();
      }
    }, 15_000);
  });
});
