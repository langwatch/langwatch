/** Spec: enterprise/modules/governance/specs/agent-registry.feature */
import { InMemoryProcessStore, type IntentContext } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WebhookApi, WebhookDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import {
  OutboxAgentRegistryDelivery,
  requestAgentRegistryDelivery,
} from "../../features/registry/eventing/agent-registry-delivery.intent.ts";
import {
  AGENT_REGISTRY_DELIVERY_PROCESS_KEY,
  AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
  AGENT_REGISTRY_DELIVERY_REQUEST_INTENT,
  type AgentRegistryDeliveryIntent,
} from "../../features/registry/eventing/agent-registry-delivery.process.ts";

const context: IntentContext = {
  processName: AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
  projectId: "org-1",
  processKey: "agent-registry",
  tenantId: "org-1",
  messageKey: "agent-registry:evt-1:hook-1",
  attempt: 1,
};

describe("requestAgentRegistryDelivery()", () => {
  describe("when the worker runs a delivery intent", () => {
    /** @scenario The delivery handler asks the webhook module with the event's idempotency key */
    it("asks requestDelivery once with the event type and the per-endpoint key", async () => {
      const asked: WebhookDeliveryRequest[] = [];
      const webhooks = createApiFixture<WebhookApi>({
        requestDelivery: async (request) => {
          asked.push(request);
          return { deliveryId: "delivery-1" };
        },
      });

      await requestAgentRegistryDelivery(webhooks)(
        {
          organizationId: "org-1",
          eventId: "evt-1",
          eventType: "governance.agent.registered",
          endpointId: "hook-1",
          body: { id: "evt-1" },
        },
        context,
      );

      expect(asked).toEqual([
        {
          organizationId: "org-1",
          destinationId: "hook-1",
          message: {
            type: "governance.agent.registered",
            idempotencyKey: "agent-registry:evt-1:hook-1",
            body: { id: "evt-1" },
          },
          source: { module: "governance", ref: "evt-1" },
        },
      ]);
    });
  });
});

describe("OutboxAgentRegistryDelivery", () => {
  function intentFor(endpointId: string): AgentRegistryDeliveryIntent {
    return {
      organizationId: "org-1",
      eventId: "evt-1",
      eventType: "governance.agent.registered",
      endpointId,
      body: { id: "evt-1", agent: { name: "support-bot" } },
    };
  }

  function withOutbox() {
    const processStore = InMemoryProcessStore.createForTesting();
    const outbox = OutboxAgentRegistryDelivery.create(processStore);
    const recorded = () =>
      processStore.findMessagesByRef({
        ref: {
          processName: AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
          projectId: "org-1",
          processKey: AGENT_REGISTRY_DELIVERY_PROCESS_KEY,
        },
      });
    return { outbox, recorded };
  }

  describe("when the registry records delivery intents", () => {
    /** @scenario Recorded delivery intents land in governance's outbox once per event and endpoint */
    it("appends one requestDelivery message per endpoint, keyed by event and endpoint", async () => {
      const { outbox, recorded } = withOutbox();
      const intents = [intentFor("hook-1"), intentFor("hook-2")];

      await outbox.record(intents);
      await outbox.record(intents);

      const messages = await recorded();
      expect(messages).toHaveLength(2);
      expect(messages.toSorted((a, b) => a.messageKey.localeCompare(b.messageKey))).toMatchObject([
        {
          messageKey: "agent-registry:evt-1:hook-1",
          intentType: AGENT_REGISTRY_DELIVERY_REQUEST_INTENT,
          tenantId: "org-1",
          payload: intentFor("hook-1"),
        },
        {
          messageKey: "agent-registry:evt-1:hook-2",
          intentType: AGENT_REGISTRY_DELIVERY_REQUEST_INTENT,
          tenantId: "org-1",
          payload: intentFor("hook-2"),
        },
      ]);
    });

    /** @scenario Recorded delivery intents land in governance's outbox once per event and endpoint */
    it("appends nothing for an empty batch", async () => {
      const { outbox, recorded } = withOutbox();

      await outbox.record([]);

      expect(await recorded()).toEqual([]);
    });
  });
});
