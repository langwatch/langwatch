import { USAGE_THRESHOLD_CROSSED_EVENT_TYPE } from "@langwatch/entitlement-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordUsageWarningCommand } from "../usage.commands.ts";
import type { RecordUsageWarningCommandData } from "../usage.events.ts";

const NOW = Date.UTC(2026, 9, 15);

const warning = (occurredAt: number): RecordUsageWarningCommandData => ({
  tenantId: "org_1",
  organizationId: "org_1",
  month: "2026-10",
  occurredAt,
  crossedThreshold: 90,
  currentMonthMessagesCount: 920,
  maxMonthlyUsageLimit: 1000,
  projectCounts: [{ projectId: "project_1", count: 920 }],
});

async function record(data: RecordUsageWarningCommandData) {
  const [event] = await new RecordUsageWarningCommand().handle({
    tenantId: createTenantId(data.tenantId),
    aggregateId: data.organizationId,
    type: RecordUsageWarningCommand.schema.type,
    data,
  });
  return event;
}

describe("RecordUsageWarningCommand", () => {
  describe("when the 90% threshold is recorded", () => {
    it("records the threshold-crossed fact with each project's count", async () => {
      const event = await record(warning(NOW));

      expect(event?.type).toBe(USAGE_THRESHOLD_CROSSED_EVENT_TYPE);
      expect(event?.data).toEqual({
        organizationId: "org_1",
        month: "2026-10",
        occurredAt: NOW,
        crossedThreshold: 90,
        currentMonthMessagesCount: 920,
        maxMonthlyUsageLimit: 1000,
        projectCounts: [{ projectId: "project_1", count: 920 }],
      });
    });
  });

  describe("when the same threshold is recorded again in the month", () => {
    /** @scenario "Asking twice in a month records the threshold once" */
    it("keys both by organization, month and threshold, so the store keeps one", async () => {
      const first = await record(warning(NOW));
      const second = await record(warning(NOW + 3_600_000));

      expect(first?.idempotencyKey).toBe("org_1:2026-10:90");
      expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
    });
  });
});
