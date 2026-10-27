import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../memory.billable-events-meter.repository.ts";

const WINDOW = { startDate: "2026-02-01 00:00:00.000", endDate: "2026-03-01 00:00:00.000" };

function at(instant: string): number {
  return Temporal.Instant.from(instant).epochMilliseconds;
}

async function meterWith(
  rows: { organizationId: string; tenantId: string; key: string; instant: string }[],
) {
  const meter = MemoryBillableEventsMeterRepository.create();
  for (const [index, row] of rows.entries()) {
    await meter.insert({
      organizationId: row.organizationId,
      record: {
        organizationId: row.organizationId,
        tenantId: row.tenantId,
        eventId: `event-${index}`,
        eventType: "span",
        deduplicationKey: row.key,
        eventTimestamp: at(row.instant),
      },
    });
  }
  return meter;
}

describe("MemoryBillableEventsMeterRepository.countByProjects", () => {
  describe("given billable events written to the memory meter", () => {
    /** @scenario "The meter counts each named project's distinct events within the month" */
    it("counts each named project's distinct keys in the half-open UTC month only", async () => {
      const meter = await meterWith([
        { organizationId: "org-1", tenantId: "p-1", key: "a", instant: "2026-02-01T00:00:00Z" },
        { organizationId: "org-1", tenantId: "p-1", key: "a", instant: "2026-02-10T00:00:00Z" },
        { organizationId: "org-1", tenantId: "p-1", key: "b", instant: "2026-02-28T23:59:59Z" },
        { organizationId: "org-1", tenantId: "p-2", key: "c", instant: "2026-02-15T00:00:00Z" },
        { organizationId: "org-1", tenantId: "p-1", key: "d", instant: "2026-03-01T00:00:00Z" },
        { organizationId: "org-1", tenantId: "p-1", key: "e", instant: "2026-01-31T23:59:59Z" },
        { organizationId: "org-2", tenantId: "p-1", key: "f", instant: "2026-02-15T00:00:00Z" },
        { organizationId: "org-1", tenantId: "p-9", key: "g", instant: "2026-02-15T00:00:00Z" },
      ]);

      await expect(
        meter.countByProjects({
          organizationId: "org-1",
          projectIds: ["p-1", "p-2"],
          window: WINDOW,
        }),
      ).resolves.toEqual([
        { projectId: "p-1", count: 2 },
        { projectId: "p-2", count: 1 },
      ]);
    });
  });
});
