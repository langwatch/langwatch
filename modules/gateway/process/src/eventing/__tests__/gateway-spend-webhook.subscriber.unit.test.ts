import type { WebhookApi, WebhookSpendDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { GATEWAY_SPEND_EVENT_VERSION_LATEST } from "../gateway-spend-commands.process.ts";
import { gatewaySpendWebhookSubscriber } from "../gateway-spend-webhook.subscriber.ts";
import { gatewaySpendConfirmedEventSchema } from "../gateway-spend.intent.ts";

const OCCURRED_AT = Date.UTC(2026, 8, 25, 12, 0, 0);

const confirmed = gatewaySpendConfirmedEventSchema.parse({
  id: "evt-physical-1",
  aggregateId: "req-1",
  aggregateType: "gateway_spend",
  tenantId: "project-1",
  createdAt: OCCURRED_AT,
  occurredAt: OCCURRED_AT,
  type: "lw.gateway.spend.confirmed",
  version: GATEWAY_SPEND_EVENT_VERSION_LATEST,
  idempotencyKey: "project-1:req-1:confirmed",
  data: {
    gateway_request_id: "req-1",
    occurred_at: OCCURRED_AT,
    tenantId: "project-1",
    usage: { input_tokens: 12, output_tokens: 34 },
    cost_nano_usd: 4_262_500,
    rate_version: "rates-1",
  },
});

describe("gateway spend's webhook subscriber", () => {
  describe("when a confirmed spend event reaches it", () => {
    /** @scenario "Each committed spend step is handed to webhook delivery under its own event id" */
    it("asks webhook delivery once, named by the event's idempotency key", async () => {
      const requests: WebhookSpendDeliveryRequest[] = [];
      const webhooks: Pick<WebhookApi, "requestSpendDelivery"> = {
        requestSpendDelivery: async (input) => {
          requests.push(input);
        },
      };

      await gatewaySpendWebhookSubscriber(webhooks).handler(confirmed, {
        tenantId: "project-1",
        aggregateId: "req-1",
        state: undefined,
      });

      expect(requests).toEqual([
        {
          sourceEventId: "project-1:req-1:confirmed",
          spend: { type: "lw.gateway.spend.confirmed", data: confirmed.data },
        },
      ]);
    });
  });
});
