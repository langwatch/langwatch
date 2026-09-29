import type { WebhookApi, WebhookGatewayEventDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { gatewayVkLifecycleEventSchema } from "../gateway-governance-events.intent.ts";
import { gatewayGovernanceWebhookSubscriber } from "../gateway-governance-webhook.subscriber.ts";

const OCCURRED_AT = Date.UTC(2026, 8, 29, 12, 0, 0);

const revoked = gatewayVkLifecycleEventSchema.parse({
  id: "evt-physical-1",
  aggregateId: "vk:key-1",
  aggregateType: "governance_subject",
  tenantId: "project-1",
  createdAt: OCCURRED_AT,
  occurredAt: OCCURRED_AT,
  type: "lw.governance.vk_lifecycle",
  version: "2026-07-31",
  idempotencyKey: `project-1:vk:key-1:revoked:${OCCURRED_AT}`,
  data: {
    tenantId: "project-1",
    organization_id: "org-1",
    virtual_key_id: "key-1",
    action: "revoked",
    name: "Production key",
    display_prefix: "lw_vk_",
    reason: null,
    occurred_at: OCCURRED_AT,
  },
});

describe("gateway governance webhook subscriber redelivery", () => {
  it("names one delivery when the same governance fact is handled twice", async () => {
    // webhook_delivery collapses on sourceEventId, its command's idempotency key.
    const pending = new Map<string, WebhookGatewayEventDeliveryRequest>();
    const webhooks: Pick<WebhookApi, "requestGatewayEventDelivery"> = {
      requestGatewayEventDelivery: async (input) => {
        pending.set(input.sourceEventId, input);
      },
    };
    const subscriber = gatewayGovernanceWebhookSubscriber(webhooks);
    const context = { tenantId: "project-1", aggregateId: "vk:key-1", state: undefined };

    await subscriber.handler(revoked, context);
    await subscriber.handler(revoked, context);

    expect([...pending.keys()]).toEqual([`project-1:vk:key-1:revoked:${OCCURRED_AT}`]);
  });
});
