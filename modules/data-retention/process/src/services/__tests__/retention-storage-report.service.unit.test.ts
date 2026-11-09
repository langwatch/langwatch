/**
 * The daily measurement of storage kept past the 90 days Growth includes, handed to billing.
 * @see specs/billing/retention-storage-billing.feature
 */
import type {
  BillingApi,
  RetentionStorageOutcome,
  RetentionStorageReport,
} from "@langwatch/enterprise-billing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryDataRetentionDirectoryRepository } from "../../repositories/memory/memory.data-retention-directory.repository.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryStorageMeterRepository } from "../../repositories/memory/memory.storage-meter.repository.ts";
import { longestRetentionDays } from "../../rules/retention-storage.rules.ts";
import { RetentionStorageReportService } from "../retention-storage-report.service.ts";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 15, 12);

/** Billing that answers every call with `line` and remembers what it was told. */
function recordingBilling({
  line = "kept",
  failFor = [],
}: {
  line?: RetentionStorageOutcome["line"];
  failFor?: string[];
} = {}): { billing: BillingApi; calls: RetentionStorageReport[] } {
  const calls: RetentionStorageReport[] = [];
  const billing = createApiFixture<BillingApi>({
    recordRetentionStorage: async (input: RetentionStorageReport) => {
      if (failFor.includes(input.organizationId)) throw new Error("billing is down");
      calls.push(input);
      return {
        line,
        reportedGbMonths: input.bytesAboveIncluded === undefined ? null : 1,
      };
    },
  });
  return { billing, calls };
}

async function setup({
  line,
  failFor,
  organizations = ["organization-1"],
}: {
  line?: RetentionStorageOutcome["line"];
  failFor?: string[];
  organizations?: string[];
} = {}) {
  const policies = MemoryDataRetentionRepository.create();
  for (const organizationId of organizations) {
    await policies.upsertForScope({
      organizationId,
      scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
      category: "traces",
      retentionDays: 182,
    });
  }
  const meter = MemoryStorageMeterRepository.create();
  const directory = MemoryDataRetentionDirectoryRepository.create({
    scopeProjects: [
      { id: "project-a", teamId: "team-1" },
      { id: "project-b", teamId: "team-1" },
    ],
  });
  const { billing, calls } = recordingBilling({
    ...(line ? { line } : {}),
    ...(failFor ? { failFor } : {}),
  });
  const service = RetentionStorageReportService.create({
    policies,
    directory,
    meter,
    billing,
    now: () => NOW,
  });
  return { service, meter, calls };
}

describe("longestRetentionDays()", () => {
  it("answers the longest rule, 0 when one keeps forever, 91 without rules", () => {
    expect(longestRetentionDays([{ retentionDays: 35 }, { retentionDays: 182 }])).toBe(182);
    expect(longestRetentionDays([{ retentionDays: 371 }, { retentionDays: 0 }])).toBe(0);
    expect(longestRetentionDays([])).toBe(91);
  });
});

describe("RetentionStorageReportService", () => {
  describe("when the daily report runs for an organization keeping 182 days", () => {
    /** @scenario "The report measures only rows older than 91 days, across every project" */
    it("tells billing the bytes of rows older than 91 days, summed across its projects", async () => {
      const { service, meter, calls } = await setup();
      meter.recordAt({ tenantId: "project-a", bytes: 1_000, atMs: NOW - 120 * DAY_MS });
      meter.recordAt({ tenantId: "project-a", bytes: 5_000, atMs: NOW - 10 * DAY_MS });
      meter.recordAt({ tenantId: "project-b", bytes: 2_000, atMs: NOW - 100 * DAY_MS });
      meter.recordAt({ tenantId: "project-b", bytes: 7_000, atMs: NOW });

      const outcome = await service.reportAll();

      expect(outcome).toEqual({ measured: 1, unbilled: 0, failed: 0 });
      expect(calls).toEqual([
        { organizationId: "organization-1", longestRetentionDays: 182 },
        {
          organizationId: "organization-1",
          longestRetentionDays: 182,
          bytesAboveIncluded: 3_000,
          measuredAt: NOW,
        },
      ]);
    });
  });

  describe("when billing has no storage line to bill", () => {
    it("measures nothing", async () => {
      const { service, calls } = await setup({ line: "skipped" });

      const outcome = await service.reportAll();

      expect(outcome).toEqual({ measured: 0, unbilled: 1, failed: 0 });
      expect(calls).toHaveLength(1);
    });
  });

  describe("when one organization's report fails", () => {
    /** @scenario "One organization failing does not stop the daily report" */
    it("reports the other and counts the failure", async () => {
      const { service, calls } = await setup({
        organizations: ["organization-1", "organization-2"],
        failFor: ["organization-1"],
      });

      const outcome = await service.reportAll();

      expect(outcome).toEqual({ measured: 1, unbilled: 0, failed: 1 });
      expect(calls.every((call) => call.organizationId === "organization-2")).toBe(true);
    });
  });
});
