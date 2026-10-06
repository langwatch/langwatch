// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * Billing's peer subscriber on usage's limit-reached fact (ARCHITECTURE §9).
 * @see modules/usage/specs/usage.feature
 */
import type { PlanLimitNotifierInput } from "@langwatch/enterprise-billing-contract";
import { createTenantId } from "@langwatch/eventing";
import { USAGE_LIMIT_REACHED_EVENT_TYPE } from "@langwatch/usage-contract";
import { describe, expect, it } from "vitest";

import { planLimitReachedSubscriber } from "../plan-limit-reached.subscriber.ts";

describe("billing's plan-limit-reached subscriber", () => {
  /** @scenario "A reached allowance tells billing to alert" */
  it("tells billing the plan, unit, count and allowance usage decided from", async () => {
    const told: PlanLimitNotifierInput[] = [];
    const subscriber = planLimitReachedSubscriber({
      alerts: { notifyPlanLimitReached: async (input) => void told.push(input) },
    });

    await subscriber.handle(
      subscriber.data.parse({
        organizationId: "org_acme",
        month: "2026-09",
        occurredAt: Date.UTC(2026, 8, 28, 12),
        count: 12_000,
        allowance: 10_000,
        planName: "Free",
        unit: "events",
      }),
      {
        tenantId: createTenantId("org_acme"),
        aggregateId: "org_acme",
        occurredAt: 1_000,
        eventId: "evt_1",
      },
    );

    expect(subscriber.eventType).toBe(USAGE_LIMIT_REACHED_EVENT_TYPE);
    expect(told).toEqual([
      {
        organizationId: "org_acme",
        planName: "Free",
        usageUnit: "events",
        current: 12_000,
        max: 10_000,
      },
    ]);
  });
});
