import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../memory.billable-events-meter.repository.ts";

const WINDOW = { startDate: "2026-02-01 00:00:00.000", endDate: "2026-03-01 00:00:00.000" };

function at(instant: string): number {
  return Temporal.Instant.from(instant).epochMilliseconds;
}

async function meterWith(
  rows: {
    organizationId: string;
    tenantId: string;
    key: string;
    instant: string;
    eventType?: string;
  }[],
) {
  const meter = MemoryBillableEventsMeterRepository.create();
  for (const [index, row] of rows.entries()) {
    await meter.insert({
      organizationId: row.organizationId,
      record: {
        organizationId: row.organizationId,
        tenantId: row.tenantId,
        eventId: `event-${index}`,
        eventType: row.eventType ?? "span",
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

describe("MemoryBillableEventsMeterRepository.countByType", () => {
  describe("given billable events of several types", () => {
    /** @scenario "The meter counts the month's distinct events per event type" */
    it("counts each type's distinct keys in the half-open UTC month only", async () => {
      const meter = await meterWith([
        { organizationId: "org-1", tenantId: "p-1", key: "s1", instant: "2026-02-01T00:00:00Z" },
        { organizationId: "org-1", tenantId: "p-1", key: "s1", instant: "2026-02-02T00:00:00Z" },
        { organizationId: "org-1", tenantId: "p-2", key: "s2", instant: "2026-02-03T00:00:00Z" },
        {
          organizationId: "org-1",
          tenantId: "p-1",
          key: "l1",
          instant: "2026-02-04T00:00:00Z",
          eventType: "log",
        },
        { organizationId: "org-1", tenantId: "p-1", key: "x", instant: "2026-03-01T00:00:00Z" },
        { organizationId: "org-2", tenantId: "p-1", key: "y", instant: "2026-02-15T00:00:00Z" },
        { organizationId: "org-1", tenantId: "p-9", key: "z", instant: "2026-02-15T00:00:00Z" },
      ]);

      await expect(
        meter.countByType({ organizationId: "org-1", projectIds: ["p-1", "p-2"], window: WINDOW }),
      ).resolves.toEqual([
        { eventType: "log", count: 1 },
        { eventType: "span", count: 2 },
      ]);
    });
  });
});

describe("every memory meter read", () => {
  describe("given one metric series wrote five rows in one hour and one in the next", () => {
    /** @scenario "Every meter read counts a metric series once per hour" */
    it("counts the series twice in the total, per project, per day and per type", async () => {
      const metric = "lw.obs.metric.data_point_received";
      const meter = await meterWith([
        ...[1, 2, 3, 4, 5].map((minute) => ({
          organizationId: "org-1",
          tenantId: "p-1",
          key: "p-1:series:2026-02-10T14",
          instant: `2026-02-10T14:0${minute}:00Z`,
          eventType: metric,
        })),
        {
          organizationId: "org-1",
          tenantId: "p-1",
          key: "p-1:series:2026-02-10T15",
          instant: "2026-02-10T15:00:00Z",
          eventType: metric,
        },
      ]);
      const read = { organizationId: "org-1", projectIds: ["p-1"], window: WINDOW };

      await expect(meter.findTotal({ organizationId: "org-1", ...WINDOW })).resolves.toBe(2);
      await expect(meter.countByProjects(read)).resolves.toEqual([{ projectId: "p-1", count: 2 }]);
      await expect(meter.countByDay(read)).resolves.toEqual([{ day: "2026-02-10", count: 2 }]);
      await expect(meter.countByType(read)).resolves.toEqual([{ eventType: metric, count: 2 }]);
    });
  });
});
