/**
 * @vitest-environment node
 * The storage read behind the upgrade dialog's price for a longer retention.
 * @see specs/billing/retention-at-upgrade.feature
 */
import type { RetentionPolicy } from "@langwatch/data-retention-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryDataRetentionDirectoryRepository } from "../../repositories/memory/memory.data-retention-directory.repository.ts";
import { OrganizationStorageEstimateService } from "../organization-storage-estimate.service.ts";

const ORGANIZATION_ID = "org_acme";
const NOW = Date.parse("2026-11-09T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function tracesRule(retentionDays: number): RetentionPolicy {
  return {
    id: "policy-traces",
    organizationId: ORGANIZATION_ID,
    scopeType: "ORGANIZATION",
    scopeId: ORGANIZATION_ID,
    category: "traces",
    retentionDays,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function estimateService({
  bytesByProject,
  createdDaysAgo,
  rules = [],
}: {
  bytesByProject: Record<string, number>;
  createdDaysAgo: number;
  rules?: RetentionPolicy[];
}) {
  const directory = MemoryDataRetentionDirectoryRepository.create({
    scopeProjects: Object.keys(bytesByProject).map((id) => ({ id, teamId: "team_1" })),
    organizationCreatedAt: Temporal.Instant.fromEpochMilliseconds(NOW - createdDaysAgo * DAY_MS),
  });
  return OrganizationStorageEstimateService.create({
    directory,
    meter: {
      getTotalStorageBytesForTenants: async ({ tenantIds }) =>
        tenantIds.reduce((sum, id) => sum + (bytesByProject[id] ?? 0), 0),
    },
    retention: {
      listOrganizationRules: async () => rules,
      getPlatformDefaultRetentionDays: () => 49,
    },
    now: () => NOW,
  });
}

describe("OrganizationStorageEstimateService", () => {
  describe("given an organization younger than its retention", () => {
    /** @scenario "The storage estimate covers the organization's age when it is young" */
    it("covers the days since it was created", async () => {
      const service = estimateService({ bytesByProject: { p1: 10e9 }, createdDaysAgo: 10 });

      const estimate = await service.getEstimate({ organizationId: ORGANIZATION_ID });

      expect(estimate.coveredDays).toBe(10);
    });
  });

  describe("given an organization older than its traces retention", () => {
    it("covers the organization's own traces retention", async () => {
      const service = estimateService({
        bytesByProject: { p1: 1e9 },
        createdDaysAgo: 400,
        rules: [tracesRule(63)],
      });

      const estimate = await service.getEstimate({ organizationId: ORGANIZATION_ID });

      expect(estimate.coveredDays).toBe(63);
    });
  });

  describe("given an organization with two projects", () => {
    /** @scenario "The storage estimate sums every project in the organization" */
    it("sums the bytes of both", async () => {
      const service = estimateService({
        bytesByProject: { p1: 3e9, p2: 4e9 },
        createdDaysAgo: 100,
      });

      const estimate = await service.getEstimate({ organizationId: ORGANIZATION_ID });

      expect(estimate).toEqual({ totalBytes: 7e9, coveredDays: 49 });
    });
  });
});
