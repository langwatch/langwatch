/**
 * A budget's crossing fires once per BILLED period, not once per calendar
 * month.
 *
 * The gateway-debits process detects a budget crossing (gateway-server's
 * anchored-cycle math) and hands it to the governance webhook envelope
 * builder (governance-server), which is what a receiver dedups on: the
 * envelope's `id` is derived from `(budget_id, bucket_scope_id, kind,
 * period_started_at_ms)`. An anchored budget's period start is the anchor
 * instant walked forward, not the 1st of the month — stamping the calendar
 * start instead would fire a fresh id (and a fresh webhook) on the 1st even
 * though the billed period had not rolled over yet.
 *
 * Composed here, in the composition root, because the anchored-cycle math
 * lives in gateway-server and the envelope builder lives in
 * governance-server — two feature packages that may not import each other.
 */
import { describe, expect, it } from "vitest";
import { GatewayWindow } from "@langwatch/gateway-server";
import {
  GovernanceEventDeliveryProcess,
  type GovernanceBudgetCrossingData,
} from "@langwatch/enterprise-governance-server";

const crossing = (
  overrides: Partial<GovernanceBudgetCrossingData> = {},
): GovernanceBudgetCrossingData => ({
  tenantId: "proj_1",
  organization_id: "org_1",
  budget_id: "budget_1",
  kind: "breached",
  scope_type: "attributed_user",
  bucket_scope_id: "vk_1:user_9",
  virtual_key_id: "vk_1",
  anchor_project_id: null,
  end_user_id: "user_9",
  window: "MONTH",
  period_started_at_ms: 0,
  limit_usd: "100.000000",
  spent_usd: "120.000000",
  on_breach: "block",
  occurred_at: 1_753_800_000_000,
  ...overrides,
});

describe("an anchored budget's crossing envelope", () => {
  describe("given a budget anchored off a day the calendar month does not start on", () => {
    /** @scenario "A breach fires once per anchored period" */
    it("keys the envelope on its own anchored period, not the calendar month", () => {
      const anchor = new Date("2026-06-17T09:00:00.000Z");
      const insidePeriod = new Date("2026-07-01T00:00:00.000Z");

      const periodStart = GatewayWindow.anchoredPeriodStart({
        window: "MONTH",
        anchorAt: anchor,
        now: insidePeriod,
      });
      const nextPeriodStart = GatewayWindow.nextAnchoredResetAt({
        window: "MONTH",
        anchorAt: anchor,
        now: insidePeriod,
      });

      // The anchored period spans the calendar boundary, so its start is the
      // 17th of June, not the 1st of July the calendar would give.
      expect(periodStart.toISOString()).toBe("2026-06-17T09:00:00.000Z");
      expect(nextPeriodStart.toISOString()).toBe("2026-07-17T09:00:00.000Z");

      const first = GovernanceEventDeliveryProcess.budgetCrossingEnvelope(
        crossing({ period_started_at_ms: periodStart.getTime() }),
      );
      // A second crossing inside the same anchored period, at a higher spend,
      // is the SAME event: exactly one webhook, not one per crossing.
      const second = GovernanceEventDeliveryProcess.budgetCrossingEnvelope(
        crossing({ period_started_at_ms: periodStart.getTime(), spent_usd: "150.000000" }),
      );
      expect(second.id).toBe(first.id);

      // The first crossing after the anchored rollover is a NEW event.
      const nextPeriod = GovernanceEventDeliveryProcess.budgetCrossingEnvelope(
        crossing({ period_started_at_ms: nextPeriodStart.getTime() }),
      );
      expect(nextPeriod.id).not.toBe(first.id);
    });
  });
});
