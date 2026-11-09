/**
 * The usage page's month: every day of the UTC month and each project that used it.
 * @see ../../../../../../specs/licensing/usage-page.feature
 */

import type { UsageUnit } from "@langwatch/entitlement-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import { MemoryEntitlementDatabase } from "../../repositories/memory/memory.entitlement.database.ts";
import { MemoryTenancyRepository } from "../../repositories/memory/memory.tenancy.repository.ts";
import {
  USAGE_UNKNOWN,
  type ProjectUsageCounts,
  type UsageCounter,
} from "../usage-enforcement.service.ts";
import { UsageMonthBreakdownService } from "../usage-month-breakdown.service.ts";

const ORGANIZATION_ID = "org_1";
const NOW = Temporal.Instant.from("2026-11-06T12:00:00Z");

/** The meter-backed counter as enforcement composes it: its per-project read, its unit. */
function counterOver({
  meter,
  usageUnit,
  projectCounts,
}: {
  meter: MemoryBillableEventsMeterRepository;
  usageUnit: UsageUnit;
  projectCounts?: ProjectUsageCounts;
}): Pick<UsageCounter, "getResolvedUsageUnit" | "getCountByProjects"> {
  return {
    getResolvedUsageUnit: async () => usageUnit,
    getCountByProjects: async ({ organizationId, projectIds }) =>
      projectCounts ??
      meter.countByProjects({
        organizationId,
        projectIds,
        window: { startDate: "2026-11-01 00:00:00.000", endDate: "2026-12-01 00:00:00.000" },
      }),
  };
}

async function meterWith(
  events: { projectId: string; at: string; key: string }[],
): Promise<MemoryBillableEventsMeterRepository> {
  const meter = MemoryBillableEventsMeterRepository.create();
  for (const event of events) {
    await meter.insert({
      organizationId: ORGANIZATION_ID,
      record: {
        organizationId: ORGANIZATION_ID,
        tenantId: event.projectId,
        eventId: event.key,
        eventType: "span",
        deduplicationKey: event.key,
        eventTimestamp: Temporal.Instant.from(event.at).epochMilliseconds,
      },
    });
  }
  return meter;
}

function tenancyWith(): MemoryTenancyRepository {
  const memory = MemoryEntitlementDatabase.create();
  memory.put({
    organizationId: ORGANIZATION_ID,
    memberCount: 1,
    membersLiteCount: 0,
    currentMonthCost: 0,
    projectCosts: { project_support: 0, project_triage: 0, project_archive: 0 },
    projectNames: {
      project_support: "support-agent",
      project_triage: "triage",
      project_archive: "archive",
    },
    spendByUserId: {},
  });
  return MemoryTenancyRepository.create({ memory });
}

const EVENTS = [
  { projectId: "project_support", at: "2026-11-01T09:00:00Z", key: "a" },
  { projectId: "project_support", at: "2026-11-01T10:00:00Z", key: "b" },
  { projectId: "project_triage", at: "2026-11-03T23:59:00Z", key: "c" },
  { projectId: "project_support", at: "2026-11-05T00:01:00Z", key: "d" },
  { projectId: "project_support", at: "2026-10-31T23:59:00Z", key: "last-month" },
];

describe("UsageMonthBreakdownService", () => {
  describe("given an events-metered organization", () => {
    /** @scenario "The month breakdown counts each day and each project of an events-metered organization" */
    it("answers every day of the month and the projects with events, the busiest first", async () => {
      const meter = await meterWith(EVENTS);
      const service = UsageMonthBreakdownService.create({
        counter: counterOver({ meter, usageUnit: "events" }),
        meter,
        tenancy: tenancyWith(),
        now: () => NOW,
      });

      const breakdown = await service.getMonthBreakdown({ organizationId: ORGANIZATION_ID });

      expect(breakdown.resetsOn).toBe("2026-12-01");
      expect(breakdown.days).toHaveLength(30);
      expect(breakdown.days?.filter((day) => day.count > 0)).toEqual([
        { date: "2026-11-01", count: 2 },
        { date: "2026-11-03", count: 1 },
        { date: "2026-11-05", count: 1 },
      ]);
      expect(breakdown.projects).toEqual([
        { projectId: "project_support", name: "support-agent", count: 3 },
        { projectId: "project_triage", name: "triage", count: 1 },
      ]);
    });
  });

  describe("given an organization metered in traces", () => {
    /** @scenario "A trace-metered organization gets no daily series" */
    it("answers no daily series and still each project's count", async () => {
      const meter = await meterWith([]);
      const service = UsageMonthBreakdownService.create({
        counter: counterOver({
          meter,
          usageUnit: "traces",
          projectCounts: [{ projectId: "project_triage", count: 12 }],
        }),
        meter,
        tenancy: tenancyWith(),
        now: () => NOW,
      });

      const breakdown = await service.getMonthBreakdown({ organizationId: ORGANIZATION_ID });

      expect(breakdown.days).toBeNull();
      expect(breakdown.isDailyUnavailable).toBe(false);
      expect(breakdown.projects).toEqual([
        { projectId: "project_triage", name: "triage", count: 12 },
      ]);
    });
  });

  describe("when the counting store cannot answer", () => {
    it("answers null projects rather than an empty month", async () => {
      const meter = await meterWith([]);
      const service = UsageMonthBreakdownService.create({
        counter: counterOver({ meter, usageUnit: "events", projectCounts: USAGE_UNKNOWN }),
        meter,
        tenancy: tenancyWith(),
        now: () => NOW,
      });

      const breakdown = await service.getMonthBreakdown({ organizationId: ORGANIZATION_ID });

      expect(breakdown.projects).toBeNull();
    });

    it("answers no daily series when the daily meter fails, and keeps the projects", async () => {
      const meter = await meterWith(EVENTS);
      const service = UsageMonthBreakdownService.create({
        counter: counterOver({ meter, usageUnit: "events" }),
        meter: {
          countByDay: async () => {
            throw new Error("ClickHouse is unreachable");
          },
        },
        tenancy: tenancyWith(),
        now: () => NOW,
      });

      const breakdown = await service.getMonthBreakdown({ organizationId: ORGANIZATION_ID });

      expect(breakdown.days).toBeNull();
      expect(breakdown.isDailyUnavailable).toBe(true);
      expect(breakdown.projects).toHaveLength(2);
    });

    it("answers null projects when the per-project count rejects, and keeps the days", async () => {
      const meter = await meterWith(EVENTS);
      const service = UsageMonthBreakdownService.create({
        counter: {
          getResolvedUsageUnit: async () => "events",
          getCountByProjects: async () => {
            throw new Error("ClickHouse is unreachable");
          },
        },
        meter,
        tenancy: tenancyWith(),
        now: () => NOW,
      });

      const breakdown = await service.getMonthBreakdown({ organizationId: ORGANIZATION_ID });

      expect(breakdown.projects).toBeNull();
      expect(breakdown.days).toHaveLength(30);
    });

    it("answers null for both halves when the project list cannot be read", async () => {
      const meter = await meterWith(EVENTS);
      const unreachable = async (): Promise<never> => {
        throw new Error("Postgres is unreachable");
      };
      const service = UsageMonthBreakdownService.create({
        counter: counterOver({ meter, usageUnit: "events" }),
        meter,
        tenancy: { findProjectIds: unreachable, findProjectNames: unreachable },
        now: () => NOW,
      });

      const breakdown = await service.getMonthBreakdown({ organizationId: ORGANIZATION_ID });

      expect(breakdown).toEqual({
        resetsOn: "2026-12-01",
        days: null,
        isDailyUnavailable: true,
        projects: null,
      });
    });
  });
});
