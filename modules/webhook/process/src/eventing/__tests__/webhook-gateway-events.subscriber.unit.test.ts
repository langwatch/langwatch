import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  type RecordBudgetCrossingCommandData,
} from "@langwatch/gateway-contract";
import type { WebhookGatewayEventDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { spendSteps } from "../../__tests__/fixtures/spend-delivery.fixtures.ts";
import { webhookGatewayEventSubscribers } from "../webhook-gateway-events.subscriber.ts";

const context = (eventId: string) => ({
  tenantId: "project-1",
  aggregateId: "aggregate-1",
  occurredAt: 1_000,
  eventId,
});

function recording() {
  const requests: WebhookGatewayEventDeliveryRequest[] = [];
  const subscribers = webhookGatewayEventSubscribers(async (request) => {
    requests.push(request);
  });
  return { requests, subscribers };
}

const crossing: RecordBudgetCrossingCommandData = {
  tenantId: "project-1",
  organization_id: "org-1",
  budget_id: "budget-1",
  kind: "breached",
  scope_type: "project",
  bucket_scope_id: "project-1",
  end_user_id: null,
  virtual_key_id: null,
  anchor_project_id: "project-1",
  window: "MONTH",
  period_started_at_ms: 0,
  limit_usd: "20.000000",
  spent_usd: "21.000000",
  on_breach: "block",
  occurred_at: 1_000,
};

describe("webhook's peer subscribers on gateway's events", () => {
  describe("when a confirmed spend event reaches its subscriber", () => {
    /** @scenario "Each committed gateway spend step is queued for delivery under its own event id" */
    it("requests delivery once, named by the event id, with the step unchanged", async () => {
      const { requests, subscribers } = recording();
      const { confirmed } = spendSteps({
        organizationId: "org-1",
        projectId: "project-1",
        requestId: "request-1",
        admittedAt: 1_000,
      });
      if (confirmed.spend.type !== GATEWAY_SPEND_CONFIRMED_EVENT_TYPE) throw new Error("fixture");

      await subscribers.gatewaySpendConfirmedDelivery.handle(
        confirmed.spend.data,
        context("evt-confirmed"),
      );

      expect(requests).toEqual([{ sourceEventId: "evt-confirmed", spend: confirmed.spend }]);
    });
  });

  describe("when a budget crossing reaches its subscriber", () => {
    /** @scenario "A recorded governance fact is queued for delivery under its own event id" */
    it("requests delivery once, named by the event id, with the fact unchanged", async () => {
      const { requests, subscribers } = recording();

      await subscribers.gatewayBudgetCrossingDelivery.handle(crossing, context("evt-crossing"));

      expect(requests).toEqual([
        {
          sourceEventId: "evt-crossing",
          governance: { type: GATEWAY_BUDGET_CROSSING_EVENT_TYPE, data: crossing },
        },
      ]);
    });
  });
});
