/**
 * @vitest-environment node
 * The delivery process manager the worker mounts, over one memory process store: an endpoint
 * with a coalescing delay ships its partial batch when the endpoint stream's wake fires.
 */
import {
  buildIntentHandlers,
  buildProcessDefinition,
  buildProcessManager,
  InMemoryProcessStore,
  OutboxDispatcherService,
  ProcessManagerService,
  type ProcessEventEnvelope,
} from "@langwatch/eventing";
import {
  WEBHOOK_SPEND_DELIVERY_REQUESTED_EVENT_TYPE,
  type WebhookSpendDeliveryRequest,
} from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { MemoryWebhookDispatchChannel } from "../../channels/memory/memory.webhook-dispatch.channel.ts";
import { MemoryWebhookRepositories } from "../../repositories/memory/memory.webhook.repositories.ts";
import { WEBHOOK_DELIVERY_PROCESS_NAME } from "../../rules/webhook-delivery-contract.rules.ts";
import { WebhookDeliveryService } from "../webhook-delivery.service.ts";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";
const REQUEST_ID = "gateway-request-1";
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);

const attribution = {
  organization_id: ORGANIZATION_ID,
  virtual_key_id: "virtual-key-1",
  principal_user_id: "user-1",
  end_user_id: "",
  model: "gpt-5-mini",
  model_provider_id: "provider-1",
  trace_id: "trace-1",
  request_type: "chat",
  labels: [],
  metadata: "",
};

const admitted: WebhookSpendDeliveryRequest = {
  sourceEventId: `${PROJECT_ID}:${REQUEST_ID}:admitted`,
  spend: {
    type: "lw.gateway.spend.admitted",
    data: {
      ...attribution,
      gateway_request_id: REQUEST_ID,
      occurred_at: T0,
      tenantId: PROJECT_ID,
      outcome_carries_attribution: false,
    },
  },
};

const confirmed: WebhookSpendDeliveryRequest = {
  sourceEventId: `${PROJECT_ID}:${REQUEST_ID}:confirmed`,
  spend: {
    type: "lw.gateway.spend.confirmed",
    data: {
      ...attribution,
      gateway_request_id: REQUEST_ID,
      occurred_at: T0 + 1_000,
      tenantId: PROJECT_ID,
      admitted_at: T0,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation_1h_tokens: 0,
        reasoning_tokens: 0,
        input_audio_tokens: 0,
        output_audio_tokens: 0,
        input_chars: 0,
        audio_ms: 0,
        input_image_tokens: 0,
        output_image_tokens: 0,
        image_count: 0,
      },
      cost_nano_usd: 4_262_500,
      rate_version: "rates-1",
      duration_ms: 1_000,
    },
  },
};

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
      channel: receiver,
      allowInsecureLocal: false,
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
