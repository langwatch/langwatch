import {
  buildIntentHandlers,
  buildProcessDefinition,
  buildProcessManager,
  InMemoryProcessStore,
  OutboxDispatcherService,
  ProcessManagerService,
} from "@langwatch/eventing";
/**
 * @vitest-environment node
 * Main's governance delivery process, mounted in webhook under its stored name, over one
 * memory process store and the memory endpoint repository.
 */
import type { RecordVkLifecycleCommandData } from "@langwatch/gateway-contract";
import { WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_TYPE } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { MemoryWebhookDispatchChannel } from "../../channels/memory/memory.webhook-dispatch.channel.ts";
import { MemoryWebhookRepositories } from "../../repositories/memory/memory.webhook.repositories.ts";
import { GOVERNANCE_EVENTS_PROCESS_NAME } from "../../rules/webhook-delivery-contract.rules.ts";
import { WebhookDeliveryService } from "../webhook-delivery.service.ts";
import { WebhookGovernanceDeliveryService } from "../webhook-governance-delivery.service.ts";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";

const created: RecordVkLifecycleCommandData = {
  tenantId: PROJECT_ID,
  organization_id: ORGANIZATION_ID,
  virtual_key_id: "vk-1",
  action: "created",
  name: "Production key",
  display_prefix: "lw_vk_",
  reason: null,
  occurred_at: 1_753_800_000_000,
};

function worker() {
  const store = InMemoryProcessStore.createForTesting();
  const { endpoints } = MemoryWebhookRepositories.create();
  const receiver = MemoryWebhookDispatchChannel.create();
  let clock = Date.now();
  const applier = WebhookGovernanceDeliveryService.create({
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
  const { config } = buildProcessManager({ name: GOVERNANCE_EVENTS_PROCESS_NAME, applier });
  const manager = new ProcessManagerService({ definition: buildProcessDefinition(config), store });
  const outbox = new OutboxDispatcherService({
    store,
    handlers: buildIntentHandlers(config),
    processNames: [GOVERNANCE_EVENTS_PROCESS_NAME],
  });

  return {
    store,
    endpoints,
    receiver,
    async consume(data: RecordVkLifecycleCommandData) {
      await manager.handleEvent({
        envelope: {
          eventId: `vk-1:${data.action}`,
          eventType: WEBHOOK_GOVERNANCE_DELIVERY_REQUESTED_EVENT_TYPE,
          occurredAt: data.occurred_at,
          tenantId: PROJECT_ID,
          projectId: PROJECT_ID,
          processKey: `vk:${data.virtual_key_id}`,
          payload: {
            sourceEventId: `${PROJECT_ID}:vk:vk-1:${data.action}:${data.occurred_at}`,
            tenantId: PROJECT_ID,
            governance: { type: "lw.governance.vk_lifecycle", data },
          },
        },
        now: clock,
      });
    },
    async drain() {
      for (let pass = 0; pass < 4; pass++) {
        clock += 1_000;
        await outbox.runOnce({ now: clock, limit: 50 });
      }
    },
  };
}

describe("given endpoints subscribed to spend only, lifecycle only, and the gateway family", () => {
  describe("when a key lifecycle fact is delivered", () => {
    /** @scenario "Governance events only reach endpoints subscribed to their types" */
    it("sends it once to the lifecycle and family endpoints and never to the spend-only one", async () => {
      const delivery = worker();
      const subscribe = (enabledEvents: string[], host: string) =>
        delivery.endpoints.create({
          organizationId: ORGANIZATION_ID,
          url: `https://${host}.example.com/hooks`,
          enabledEvents,
          maxBatchDelayMs: 0,
        });
      const spendOnly = await subscribe(["gateway.request.completed"], "spend");
      const lifecycleOnly = await subscribe(["gateway.virtual_key.created"], "lifecycle");
      const family = await subscribe(["gateway.*"], "family");

      await delivery.consume(created);
      await delivery.consume(created);
      await delivery.drain();

      const sentTo = async (endpointId: string) =>
        (await delivery.endpoints.getDeliveries({ organizationId: ORGANIZATION_ID, endpointId }))
          .deliveries.length;
      expect(await sentTo(spendOnly.endpoint.id)).toBe(0);
      expect(await sentTo(lifecycleOnly.endpoint.id)).toBe(1);
      expect(await sentTo(family.endpoint.id)).toBe(1);
      const messages = await delivery.store.findMessagesByRef({
        ref: {
          processName: GOVERNANCE_EVENTS_PROCESS_NAME,
          projectId: PROJECT_ID,
          processKey: `endpoint:${family.endpoint.id}`,
        },
      });
      expect(messages.map((message) => message.messageKey)).toEqual([
        `send:${family.endpoint.id}:vk-1:created:1753800000000`,
      ]);
    });
  });
});
