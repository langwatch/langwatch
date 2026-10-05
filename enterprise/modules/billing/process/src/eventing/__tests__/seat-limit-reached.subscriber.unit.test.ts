// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * Billing's peer subscriber on organization's seat-limit-reached event (ARCHITECTURE §9).
 * @see specs/licensing/resource-limit-notifications.feature
 */
import type { ResourceLimitNotifierInput } from "@langwatch/enterprise-billing-contract";
import { createTenantId } from "@langwatch/eventing";
import { SEAT_LIMIT_REACHED_EVENT_TYPE } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { seatLimitReachedSubscriber } from "../seat-limit-reached.subscriber.ts";

describe("billing's seat-limit-reached subscriber", () => {
  /** @scenario "Organization's seat-limit event tells billing" */
  it("tells billing the limit type, current and max", async () => {
    const told: ResourceLimitNotifierInput[] = [];
    const subscriber = seatLimitReachedSubscriber({
      alerts: { notifyResourceLimitReached: async (input) => void told.push(input) },
    });

    await subscriber.handle(
      subscriber.data.parse({
        tenantId: "org_acme",
        organizationId: "org_acme",
        limitType: "members",
        current: 5,
        max: 5,
        occurredAt: Date.UTC(2026, 8, 28, 12),
      }),
      {
        tenantId: createTenantId("org_acme"),
        aggregateId: "org_acme",
        occurredAt: 1_000,
        eventId: "evt_1",
      },
    );

    expect(subscriber.eventType).toBe(SEAT_LIMIT_REACHED_EVENT_TYPE);
    expect(told).toEqual([
      { organizationId: "org_acme", limitType: "members", current: 5, max: 5 },
    ]);
  });
});
