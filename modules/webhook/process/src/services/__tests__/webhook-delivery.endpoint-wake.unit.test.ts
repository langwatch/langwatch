/**
 * @vitest-environment node
 * The delivery process manager the worker mounts, over one memory process store: every instance
 * kind stored under its name (endpoint stream, maintenance claim) reads back on a wake.
 */
import {
  buildIntentHandlers,
  buildProcessDefinition,
  buildProcessManager,
  InMemoryProcessStore,
  OutboxDispatcherService,
  ProcessManagerService,
  type ProcessEventEnvelope,
  type ProcessRef,
} from "@langwatch/eventing";
import {
  WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE,
  type WebhookSpendDeliveryRequest,
} from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { spendSteps } from "../../__tests__/fixtures/spend-delivery.fixtures.ts";
import { MemorySqsWebhookDestinationChannel } from "../../channels/memory/memory.sqs-webhook-destination.channel.ts";
import { MemoryWebhookDispatchChannel } from "../../channels/memory/memory.webhook-dispatch.channel.ts";
import { MemoryWebhookRepositories } from "../../repositories/memory/memory.webhook.repositories.ts";
import {
  MAINTENANCE_PROCESS_KEY,
  MAINTENANCE_TENANT,
  WEBHOOK_DELIVERY_PROCESS_NAME,
} from "../../rules/webhook-delivery-contract.rules.ts";
import { WebhookDeliveryService } from "../webhook-delivery.service.ts";
import { WebhookDestinationDispatchService } from "../webhook-destination-dispatch.service.ts";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";
const REQUEST_ID = "gateway-request-1";
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);

const MAINTENANCE_REF: ProcessRef = {
  processName: WEBHOOK_DELIVERY_PROCESS_NAME,
  projectId: MAINTENANCE_TENANT,
  processKey: MAINTENANCE_PROCESS_KEY,
};

const { admitted, confirmed } = spendSteps({
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  requestId: REQUEST_ID,
  admittedAt: T0,
});

function envelopeOf(request: WebhookSpendDeliveryRequest): ProcessEventEnvelope {
  return {
    eventId: request.sourceEventId,
    eventType: WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE,
    occurredAt: request.spend.data.occurred_at,
    tenantId: PROJECT_ID,
    projectId: PROJECT_ID,
    processKey: REQUEST_ID,
    payload: { ...request, tenantId: PROJECT_ID },
  };
}

function worker() {
  const store = InMemoryProcessStore.createForTesting();
  const { endpoints } = MemoryWebhookRepositories.create();
  const receiver = MemoryWebhookDispatchChannel.create();
  let clock = Date.now();
  const applier = WebhookDeliveryService.create({
    processStore: store,
    endpoints,
    pruneExpiredIdempotencyReceipts: async () => 0,
    dispatch: WebhookDeliveryService.dispatchThrough({
      destinations: WebhookDestinationDispatchService.create({
        egress: receiver,
        allowInsecureLocal: false,
        sqs: MemorySqsWebhookDestinationChannel.create(),
      }),
    }),
    getPlan: async () => ({ webhookEndpointsEnabled: true }),
    now: () => clock,
  }).processManager();
  const { config } = buildProcessManager({ name: WEBHOOK_DELIVERY_PROCESS_NAME, applier });
  const manager = new ProcessManagerService({
    definition: buildProcessDefinition(config),
    store,
  });
  const outbox = new OutboxDispatcherService({
    store,
    handlers: buildIntentHandlers(config),
    processNames: [WEBHOOK_DELIVERY_PROCESS_NAME],
  });

  return {
    endpoints,
    receiver,
    async consume(request: WebhookSpendDeliveryRequest) {
      await manager.handleEvent({ envelope: envelopeOf(request), now: clock });
    },
    async drain() {
      for (let pass = 0; pass < 4; pass++) {
        clock += 1_000;
        await outbox.runOnce({ now: clock, limit: 50 });
      }
    },
    async wakeEndpoint(endpointId: string) {
      const ref = {
        processName: WEBHOOK_DELIVERY_PROCESS_NAME,
        projectId: ORGANIZATION_ID,
        processKey: `endpoint:${endpointId}`,
      };
      const stream = await store.findByRef({ ref });
      if (!stream || stream.nextWakeAt === null)
        throw new Error("the endpoint stream armed no wake");
      clock = Math.max(clock, stream.nextWakeAt);
      return manager.handleWake({
        wake: { ref, revision: stream.revision, wakeAt: stream.nextWakeAt },
        now: clock,
      });
    },
    async claimMaintenance() {
      await store.commit({
        ref: MAINTENANCE_REF,
        tenantId: MAINTENANCE_TENANT,
        sourceEventId: null,
        expectedRevision: 0,
        state: { lastRunMs: clock },
        nextWakeAt: null,
        messages: [],
        now: clock,
      });
    },
    async wakeNow(ref: ProcessRef) {
      const instance = await store.findByRef({ ref });
      if (!instance) throw new Error(`no instance at ${ref.processKey}`);
      return manager.handleWake({
        wake: { ref, revision: instance.revision, wakeAt: clock },
        now: clock,
      });
    },
    findState(ref: ProcessRef) {
      return store.findByRef({ ref }).then((instance) => instance?.state);
    },
  };
}

describe("given an active endpoint that coalesces completed requests", () => {
  describe("when gateway hands over an admitted and a confirmed spend step", () => {
    /** @scenario "The delivery process manager flushes an endpoint stream on its wake" */
    it("ships the buffered envelope when the endpoint stream wakes", async () => {
      const delivery = worker();
      const { endpoint } = await delivery.endpoints.create({
        organizationId: ORGANIZATION_ID,
        url: "https://receiver.example.com/hooks/spend",
        enabledEvents: ["gateway.request.completed"],
        maxBatchDelayMs: 5_000,
      });

      await delivery.consume(admitted);
      await delivery.consume(confirmed);
      await delivery.drain();
      expect(delivery.receiver.sent).toHaveLength(0);

      await expect(delivery.wakeEndpoint(endpoint.id)).resolves.toMatchObject({
        outcome: "committed",
      });
      await delivery.drain();

      const log = await delivery.endpoints.getDeliveries({
        organizationId: ORGANIZATION_ID,
        endpointId: endpoint.id,
      });
      expect(log.deliveries).toHaveLength(1);
      expect(delivery.receiver.sent).toHaveLength(1);
    });
  });
});

describe("given the hourly maintenance claim stored under the delivery process", () => {
  describe("when an operator wakes it from the ops console", () => {
    /** @scenario "An operator wake on the delivery maintenance claim leaves it as it was" */
    it("reads the claim and commits it unchanged", async () => {
      const delivery = worker();
      await delivery.claimMaintenance();
      const claimed = await delivery.findState(MAINTENANCE_REF);

      await expect(delivery.wakeNow(MAINTENANCE_REF)).resolves.toMatchObject({
        outcome: "committed",
      });
      await expect(delivery.findState(MAINTENANCE_REF)).resolves.toEqual(claimed);
    });
  });
});
