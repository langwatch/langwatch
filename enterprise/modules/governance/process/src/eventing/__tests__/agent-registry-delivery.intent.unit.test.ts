/** Spec: enterprise/modules/governance/specs/agent-registry.feature, cloud-agent-discovery.feature
 */
import { InMemoryProcessStore, type IntentContext } from "@langwatch/eventing";
import type {
  NotificationService,
  RequestWebPushDeliveryCommand,
} from "@langwatch/notification-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WebhookApi, WebhookDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import {
  OutboxAgentRegistryDelivery,
  requestAgentRegistryAlert,
  requestAgentRegistryDelivery,
} from "../../features/registry/eventing/agent-registry-delivery.intent.ts";
import {
  AGENT_REGISTRY_ALERT_INTENT,
  type AgentRegistryAlertIntent,
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

      await outbox.record({ organizationId: "org-1", deliveries: intents, alerts: [] });
      await outbox.record({ organizationId: "org-1", deliveries: intents, alerts: [] });

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

      await outbox.record({ organizationId: "org-1", deliveries: [], alerts: [] });

      expect(await recorded()).toEqual([]);
    });
  });
});

describe("requestAgentRegistryAlert()", () => {
  const alert: AgentRegistryAlertIntent = {
    organizationId: "org-1",
    eventId: "evt-9",
    userId: "admin-1",
    agentId: "agentreg_7",
    agentName: "pricing-bot",
  };

  describe("when the worker runs a shadow alert intent", () => {
    /** @scenario "A new shadow agent alerts each organisation admin once" */
    it("asks for one web push keyed by the event and the admin, on the governance project", async () => {
      const asked: RequestWebPushDeliveryCommand[] = [];
      const notifications = createApiFixture<NotificationService>({
        requestWebPushDelivery: async (command) => {
          asked.push(command);
          return { queued: 1 };
        },
      });

      await requestAgentRegistryAlert({
        notifications,
        governanceProjectId: async (organizationId) => `governance-of-${organizationId}`,
      })(alert, context);

      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({
        userId: "admin-1",
        projectId: "governance-of-org-1",
        idempotencyKey: "agent-registry:evt-9:admin-1",
        message: { url: "/governance/agents" },
      });
      expect(asked[0]?.message.title).toContain("pricing-bot");
    });
  });

  describe("when the registry records alerts beside deliveries", () => {
    /** @scenario "A new shadow agent alerts each organisation admin once" */
    it("appends one alert message per admin, once however often it is recorded", async () => {
      const processStore = InMemoryProcessStore.createForTesting();
      const outbox = OutboxAgentRegistryDelivery.create(processStore);
      const alerts = [alert, { ...alert, userId: "admin-2" }];

      await outbox.record({ organizationId: "org-1", deliveries: [], alerts });
      await outbox.record({ organizationId: "org-1", deliveries: [], alerts });

      const messages = await processStore.findMessagesByRef({
        ref: {
          processName: AGENT_REGISTRY_DELIVERY_PROCESS_NAME,
          projectId: "org-1",
          processKey: AGENT_REGISTRY_DELIVERY_PROCESS_KEY,
        },
      });
      expect(
        messages
          .map((message) => [message.messageKey, message.intentType])
          .toSorted(([a], [b]) => String(a).localeCompare(String(b))),
      ).toEqual([
        ["agent-registry:evt-9:admin-1", AGENT_REGISTRY_ALERT_INTENT],
        ["agent-registry:evt-9:admin-2", AGENT_REGISTRY_ALERT_INTENT],
      ]);
    });
  });
});
