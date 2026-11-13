/** Spec: enterprise/modules/governance/specs/agent-registry.feature */
import type { IntentContext } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WebhookApi, WebhookDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { requestAgentRegistryDelivery } from "../agent-registry-delivery.intent.ts";
import { AGENT_REGISTRY_DELIVERY_PROCESS_NAME } from "../agent-registry-delivery.process.ts";

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
