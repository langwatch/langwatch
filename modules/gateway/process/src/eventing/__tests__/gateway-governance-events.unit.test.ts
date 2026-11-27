import { createTenantId } from "@langwatch/eventing";
import type {
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import {
  RecordBudgetCrossingCommand,
  RecordUnbudgetedSpendCommand,
  RecordVkFirstRequestCommand,
  RecordVkLifecycleCommand,
} from "../gateway-governance-events.intent.ts";

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

  describe("when a key's first request is recorded at two instants", () => {
    /** @scenario "Two batches that both see an unused key record its first request once" */
    it("keys both appends on the key alone, under the key's governed subject", async () => {
      const record = (occurredAt: number) =>
        new RecordVkFirstRequestCommand().handle({
          type: "lw.governance.record_vk_first_request",
          tenantId: createTenantId("project-1"),
          aggregateId: "vk:key-1",
          data: {
            tenantId: "project-1",
            organization_id: "org-1",
            virtual_key_id: "key-1",
            occurred_at: occurredAt,
          },
        });
      const [once] = await record(1_000);
      const [twice] = await record(61_000);

      expect(once).toMatchObject({
        aggregateType: "governance_subject",
        aggregateId: "vk:key-1",
        type: "lw.governance.vk_first_request",
        version: "2026-07-31",
        idempotencyKey: "project-1:vk_first_request:key-1",
      });
      expect(twice?.idempotencyKey).toBe(once?.idempotencyKey);
    });
  });

  describe("when an organization's unbudgeted spend is recorded twice in a week", () => {
    /** @scenario "Every sweep of one ISO week records the organization's unbudgeted spend under one key" */
    it("keys both appends on the organization and ISO week alone, and a new week mints a new key", async () => {
      const record = (isoWeek: string, occurredAt: number) =>
        new RecordUnbudgetedSpendCommand().handle({
          type: "lw.governance.record_unbudgeted_spend",
          tenantId: createTenantId("project-1"),
          aggregateId: "org:org-1",
          data: {
            tenantId: "project-1",
            organization_id: "org-1",
            iso_week: isoWeek,
            keys: [{ virtual_key_id: "key-1", name: "CI key", spent_usd: "12.5" }],
            key_count: 1,
            total_spent_usd: "12.5",
            occurred_at: occurredAt,
          },
        });
      const [once] = await record("2026-W48", 1_000);
      const [twice] = await record("2026-W48", 21_601_000);
      const [nextWeek] = await record("2026-W49", 604_801_000);

      expect(once).toMatchObject({
        aggregateType: "governance_subject",
        aggregateId: "org:org-1",
        type: "lw.governance.unbudgeted_spend",
        version: "2026-07-31",
        idempotencyKey: "org-1:unbudgeted:2026-W48",
      });
      expect(twice?.idempotencyKey).toBe(once?.idempotencyKey);
      expect(nextWeek?.idempotencyKey).toBe("org-1:unbudgeted:2026-W49");
    });
  });
});
