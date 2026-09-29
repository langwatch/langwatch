import { createTenantId } from "@langwatch/eventing";
import type {
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import type { WebhookGatewayEventDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import {
  RecordBudgetCrossingCommand,
  RecordVkLifecycleCommand,
} from "../gateway-governance-events.intent.ts";
import { gatewayGovernanceWebhookSubscriber } from "../gateway-governance-webhook.subscriber.ts";

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
  spent_usd: "20.010000",
  on_breach: "block",
  occurred_at: 1_000,
};

const lifecycle: RecordVkLifecycleCommandData = {
  tenantId: "project-1",
  organization_id: "org-1",
  virtual_key_id: "key-1",
  action: "rotated",
  name: "Production key",
  display_prefix: "lw_vk_",
  reason: null,
  occurred_at: 1_000,
};

function recordCrossing(data: RecordBudgetCrossingCommandData) {
  return new RecordBudgetCrossingCommand().handle({
    type: "lw.governance.record_budget_crossing",
    tenantId: createTenantId("project-1"),
    aggregateId: `budget:${data.budget_id}`,
    data,
  });
}

describe("gateway governance facts", () => {
  describe("when the same bucket crosses twice inside one period", () => {
    /** @scenario "A crossing fires once per bucket per period" */
    it("keys both appends alike, and a new period mints a new key", async () => {
      const [once] = await recordCrossing(crossing);
      const [twice] = await recordCrossing({ ...crossing, spent_usd: "25.000000" });
      const [nextPeriod] = await recordCrossing({ ...crossing, period_started_at_ms: 86_400_000 });

      expect(once).toMatchObject({
        aggregateType: "governance_subject",
        aggregateId: "budget:budget-1",
        type: "lw.governance.budget_crossing",
        version: "2026-07-31",
        idempotencyKey: "project-1:budget:budget-1:project-1:breached:0",
      });
      expect(twice?.idempotencyKey).toBe(once?.idempotencyKey);
      expect(nextPeriod?.idempotencyKey).not.toBe(once?.idempotencyKey);
    });
  });

  describe("when a key changes state", () => {
    /** @scenario "Governance facts keep main's stored identity" */
    it("keys the lifecycle append on its subject, action and instant", async () => {
      const [event] = await new RecordVkLifecycleCommand().handle({
        type: "lw.governance.record_vk_lifecycle",
        tenantId: createTenantId("project-1"),
        aggregateId: "vk:key-1",
        data: lifecycle,
      });

      expect(event).toMatchObject({
        aggregateId: "vk:key-1",
        type: "lw.governance.vk_lifecycle",
        idempotencyKey: "project-1:vk:key-1:rotated:1000",
      });
    });
  });

  describe("when a recorded crossing reaches the webhook subscriber", () => {
    /** @scenario "A recorded crossing is handed to webhook delivery under its own key" */
    it("asks webhook delivery once, named by the event's idempotency key", async () => {
      const requests: WebhookGatewayEventDeliveryRequest[] = [];
      const [event] = await recordCrossing(crossing);
      if (!event) throw new Error("the command appended nothing");

      await gatewayGovernanceWebhookSubscriber({
        requestGatewayEventDelivery: async (input) => {
          requests.push(input);
        },
      }).handler(event, {
        tenantId: "project-1",
        aggregateId: "budget:budget-1",
        state: undefined,
      });

      expect(requests).toEqual([
        {
          sourceEventId: "project-1:budget:budget-1:project-1:breached:0",
          governance: { type: "lw.governance.budget_crossing", data: crossing },
        },
      ]);
    });
  });
});
