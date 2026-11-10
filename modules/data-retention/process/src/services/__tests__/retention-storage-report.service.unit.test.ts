/**
 * The daily measurement of storage kept past the 90 days Growth includes, handed to billing.
 * @see specs/billing/retention-storage-billing.feature
 */
import {
  type BillingApi,
  type RetentionStorageOutcome,
  type RetentionStorageReport,
} from "@langwatch/enterprise-billing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryDataRetentionDirectoryRepository } from "../../repositories/memory/memory.data-retention-directory.repository.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryStorageMeterRepository } from "../../repositories/memory/memory.storage-meter.repository.ts";
import {
  longestRetentionDays,
  retentionStorageDayOf,
} from "../../rules/retention-storage.rules.ts";
import { RetentionStorageReportService } from "../retention-storage-report.service.ts";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 15, 12);
const TODAY = "2026-11-15";

/** Billing that answers every call with `line` and remembers what it was told. */
function recordingBilling({ line = "kept" }: { line?: RetentionStorageOutcome["line"] } = {}): {
  billing: BillingApi;
  calls: RetentionStorageReport[];
} {
  const calls: RetentionStorageReport[] = [];
  const billing = createApiFixture<BillingApi>({
    recordRetentionStorage: async (input: RetentionStorageReport) => {
      calls.push(input);
      return { line, reportedGbMonths: input.bytesAboveIncluded === undefined ? null : 1 };
    },
  });
  return { billing, calls };
}

async function setup({ line }: { line?: RetentionStorageOutcome["line"] } = {}) {
  const policies = MemoryDataRetentionRepository.create();
  await policies.upsertForScope({
    organizationId: "organization-1",
    scope: { scopeType: "ORGANIZATION", scopeId: "organization-1" },
    category: "traces",
    retentionDays: 182,
  });
  const meter = MemoryStorageMeterRepository.create();
  const directory = MemoryDataRetentionDirectoryRepository.create({
    scopeProjects: [
      { id: "project-a", teamId: "team-1" },
      { id: "project-b", teamId: "team-1" },
    ],
  });
  const { billing, calls } = recordingBilling(line ? { line } : {});
  const service = RetentionStorageReportService.create({ policies, directory, meter, billing });
  return { service, meter, calls };
}

describe("longestRetentionDays()", () => {
  it("answers the longest rule, 0 when one keeps forever, 91 without rules", () => {
    expect(longestRetentionDays([{ retentionDays: 35 }, { retentionDays: 182 }])).toBe(182);
    expect(longestRetentionDays([{ retentionDays: 371 }, { retentionDays: 0 }])).toBe(0);
    expect(longestRetentionDays([])).toBe(91);
  });
});

describe("retentionStorageDayOf()", () => {
  it("answers the UTC day and the days in its month", () => {
    expect(retentionStorageDayOf(NOW)).toEqual({ day: TODAY, daysInMonth: 30 });
    expect(retentionStorageDayOf(Date.UTC(2026, 1, 28, 23, 59))).toEqual({
      day: "2026-02-28",
      daysInMonth: 28,
    });
  });
});

describe("RetentionStorageReportService", () => {
  describe("when an organization keeping 182 days is measured", () => {
    /** @scenario "The report measures only rows older than 91 days, across every project" */
    it("records the bytes of rows older than 91 days, summed across its projects", async () => {
      const { service, meter, calls } = await setup();
      meter.recordAt({ tenantId: "project-a", bytes: 1_000_000_000, atMs: NOW - 120 * DAY_MS });
      meter.recordAt({ tenantId: "project-a", bytes: 5_000, atMs: NOW - 10 * DAY_MS });
      meter.recordAt({ tenantId: "project-b", bytes: 2_000_000_000, atMs: NOW - 100 * DAY_MS });
      meter.recordAt({ tenantId: "project-b", bytes: 7_000, atMs: NOW });

      const measured = await service.measure({
        organizationId: "organization-1",
        day: TODAY,
        measuredAt: NOW,
      });

      expect(measured).toEqual([
        {
          organizationId: "organization-1",
          day: TODAY,
          longestRetentionDays: 182,
          bytesAboveIncluded: 3_000_000_000,
          gbBeyondIncluded: 3,
          dailyShareGb: 0.1,
          identifier: `retention-storage:organization-1:${TODAY}`,
          measuredAt: NOW,
        },
      ]);
      // Measuring only aligns the line; the share goes to the meter from the event.
      expect(calls).toEqual([{ organizationId: "organization-1", longestRetentionDays: 182 }]);
    });
  });

  describe("when billing has no storage line to bill", () => {
    it("measures nothing", async () => {
      const { service, calls } = await setup({ line: "skipped" });

      const measured = await service.measure({
        organizationId: "organization-1",
        day: TODAY,
        measuredAt: NOW,
      });

      expect(measured).toEqual([]);
      expect(calls).toHaveLength(1);
    });
  });

  describe("when the day and the measuring instant disagree", () => {
    it("refuses to measure", async () => {
      const { service, calls } = await setup();

      await expect(
        service.measure({ organizationId: "organization-1", day: "2026-11-14", measuredAt: NOW }),
      ).rejects.toThrow("cannot stand for 2026-11-14");
      expect(calls).toEqual([]);
    });
  });

  describe("when a recorded measurement is billed", () => {
    it("hands billing the bytes and the instant the share is named by", async () => {
      const { service, calls } = await setup();

      await service.bill({
        organizationId: "organization-1",
        day: TODAY,
        longestRetentionDays: 182,
        bytesAboveIncluded: 3_000,
        gbBeyondIncluded: 0.000003,
        dailyShareGb: 0.0000001,
        identifier: `retention-storage:organization-1:${TODAY}`,
        measuredAt: NOW,
      });

      expect(calls).toEqual([
        {
          organizationId: "organization-1",
          longestRetentionDays: 182,
          bytesAboveIncluded: 3_000,
          measuredAt: NOW,
        },
      ]);
    });
  });
});
