/**
 * @vitest-environment node
 * Redelivery of gateway's facts to webhook's peer subscribers, on a memory-tier worker: one
 * fact handled twice, by event id or by idempotency key, yields one delivery and one request.
 * @see modules/webhook/specs/webhook-gateway-events.feature
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
} from "@langwatch/gateway-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

function worker(eventStore: EventStoreMemory) {
  const eventing = new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });

  return createApp({ role: "worker" })
    .withModules([webhookProcessModule])
    .withConfig({
      webhook: {
        allowInsecureLocalUrls: false,
        allowAmbientAwsCredentials: false,
        isSaas: false,
      },
    })
    .withStores(memoryStores())
    .withEventing(eventing)
    .withMember("outboundProxy", {})
    .provide({
      entitlement: createApiFixture<EntitlementApi>({
        getActivePlan: async () => entitledPlan,
        requestBound: async () => 10,
      }),
      project: createApiFixture<ProjectApi>({ listIdsByOrganization: async () => [] }),
    });
}

type Arrival = { eventId: string; idempotencyKey?: string };

/** Hands the admitted and confirmed steps to the subscribers once per arrival; returns the log. */
async function deliverSpendSteps({
  requestId,
  admittedArrivals,
  confirmedArrivals,
}: {
  requestId: string;
  admittedArrivals: Arrival[];
  confirmedArrivals: Arrival[];
}) {
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
      requestId,
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
    const context = (arrival: Arrival) => ({
      tenantId: PROJECT_ID,
      aggregateId: requestId,
      occurredAt: Date.now(),
      ...arrival,
    });

    for (let index = 0; index < admittedArrivals.length; index++) {
      const admittedArrival = admittedArrivals[index];
      const confirmedArrival = confirmedArrivals[index];
      if (!admittedArrival || !confirmedArrival) throw new Error("arrivals must pair up");
      await subscribers.gatewaySpendAdmittedDelivery.handle(
        admitted.spend.data,
        context(admittedArrival),
      );
      await subscribers.gatewaySpendConfirmedDelivery.handle(
        confirmed.spend.data,
        context(confirmedArrival),
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
      aggregateId: requestId,
      aggregateType: WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE,
      context: { tenantId: createTenantId(PROJECT_ID) },
    });
    return requested.map((event) => event.idempotencyKey);
  } finally {
    await runtime.stop();
  }
}

describe("given a memory-tier worker with one active HTTP endpoint and webhook's gateway subscribers", () => {
  describe("when a request's admitted and confirmed spend events each reach the subscribers twice", () => {
    /** @scenario "A redelivered gateway spend event is delivered once" */
    it("records one delivery attempt and one requested event per gateway event", async () => {
      const keys = await deliverSpendSteps({
        requestId: "gateway-request-redelivered",
        admittedArrivals: [{ eventId: "evt-admitted" }, { eventId: "evt-admitted" }],
        confirmedArrivals: [{ eventId: "evt-confirmed" }, { eventId: "evt-confirmed" }],
      });

      expect(keys).toEqual(["evt-admitted", "evt-confirmed"]);
    }, 15_000);
  });

  describe("when each spend fact is appended twice under one idempotency key", () => {
    /** @scenario "A gateway fact appended twice under one idempotency key is delivered once" */
    it("records one delivery attempt and one requested event per fact, keyed by its idempotency key", async () => {
      const keys = await deliverSpendSteps({
        requestId: "gateway-request-reappended",
        admittedArrivals: [
          { eventId: "evt-admitted-1", idempotencyKey: "fact-admitted" },
          { eventId: "evt-admitted-2", idempotencyKey: "fact-admitted" },
        ],
        confirmedArrivals: [
          { eventId: "evt-confirmed-1", idempotencyKey: "fact-confirmed" },
          { eventId: "evt-confirmed-2", idempotencyKey: "fact-confirmed" },
        ],
      });

      expect(keys).toEqual(["fact-admitted", "fact-confirmed"]);
    }, 15_000);
  });
});
