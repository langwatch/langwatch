import type { WebhookApi, WebhookSpendDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { GATEWAY_SPEND_EVENT_VERSION_LATEST } from "../gateway-spend-commands.process.ts";
import { gatewaySpendWebhookSubscriber } from "../gateway-spend-webhook.subscriber.ts";
import { gatewaySpendSettledEventSchema } from "../gateway-spend.intent.ts";

const OCCURRED_AT = Date.UTC(2026, 8, 25, 12, 0, 0);

const settled = gatewaySpendSettledEventSchema.parse({
  id: "evt-physical-2",
  aggregateId: "req-2",
  aggregateType: "gateway_spend",
  tenantId: "project-1",
  createdAt: OCCURRED_AT,
  occurredAt: OCCURRED_AT,
  type: "lw.gateway.spend.settled",
  version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
  idempotencyKey: "project-1:req-2:settled",
  data: {
    gateway_request_id: "req-2",
    occurred_at: OCCURRED_AT,
    tenantId: "project-1",
    reason: "grace_elapsed",
  },
});

describe("gateway spend's webhook subscriber redelivery", () => {
  it("names one delivery when the same spend event is handled twice", async () => {
    // webhook_delivery collapses on sourceEventId, its command's idempotency key.
    const pending = new Map<string, WebhookSpendDeliveryRequest>();
    const webhooks: Pick<WebhookApi, "requestSpendDelivery"> = {
      requestSpendDelivery: async (input) => {
        pending.set(input.sourceEventId, input);
      },
    };
    const subscriber = gatewaySpendWebhookSubscriber(webhooks);
    const context = { tenantId: "project-1", aggregateId: "req-2", state: undefined };

    await subscriber.handler(settled, context);
    await subscriber.handler(settled, context);

    expect([...pending.keys()]).toEqual(["project-1:req-2:settled"]);
  });
});
