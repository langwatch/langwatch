import { applyPlanTypeEntitlements } from "@langwatch/enterprise-licensing-contract";
import type { UsageThresholdCrossedEventData } from "@langwatch/entitlement-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { coreBaselinePlan } from "../../rules/plan-baseline.rules.ts";
import { EntitlementService } from "../../services/entitlement.service.ts";
import {
  USAGE_UNKNOWN,
  UsageService,
  type ProjectUsageCounts,
} from "../../services/usage-enforcement.service.ts";
import { UsageWarningService } from "../../services/usage-warning.service.ts";

function warningsOver(counts: ProjectUsageCounts) {
  const recorded: UsageThresholdCrossedEventData[] = [];
  const counted: string[][] = [];
  const tenancy = {
    findProjectIds: async () => ["project-1", "project-2"],
    findMeteredOrganizationIds: async () => ["org-1"],
  };
  const plans = EntitlementService.create({
    baseline: coreBaselinePlan({ isSaas: false }),
    license: { resolve: async () => ({ granted: false }) },
    enrichers: [{ enrich: applyPlanTypeEntitlements }],
  });
  const counter = UsageService.create({
    organizations: {
      getProjectIds: () => tenancy.findProjectIds(),
      getPricingModel: async () => ({ pricingModel: null }),
    },
    traceCounter: {
      getCountByProjects: async () => {
        throw new Error("a free plan off Cloud is metered in events");
      },
    },
    eventCounter: {
      getCountByProjects: async ({ projectIds }) => {
        counted.push(projectIds);
        return counts;
      },
    },
    planResolver: (organizationId) => plans.getActivePlan({ organizationId }),
    deployment: { isSaas: false },
  });
  const warnings = UsageWarningService.create({
    record: async (data) => {
      recorded.push(data);
    },
    counter,
    plans,
    tenancy,
    isSaas: false,
    logger: createTestLogger().logger,
  });
  return { warnings, recorded, counted };
}

const COUNTS = [
  { projectId: "project-1", count: 600 },
  { projectId: "project-2", count: 300 },
];

describe("the usage-limit warning entitlement composes", () => {
  describe("when the reading crosses a threshold", () => {
    /**
     * @scenario "Entitlement records a crossed warning threshold as its own event"
     * @scenario "Asking for a warning records it rather than sending it"
     */
    it("records the decided threshold with each project's count, without a notification id", async () => {
      const { warnings, recorded, counted } = warningsOver(COUNTS);

      await expect(
        warnings.sendWarning({
          organizationId: "org-1",
          currentMonthMessagesCount: 900,
          maxMonthlyUsageLimit: 1000,
        }),
      ).resolves.toEqual({ sent: true });

      expect(recorded).toEqual([
        {
          organizationId: "org-1",
          month: expect.stringMatching(/^\d{4}-\d{2}$/),
          occurredAt: expect.any(Number),
          currentMonthMessagesCount: 900,
          maxMonthlyUsageLimit: 1000,
          crossedThreshold: 90,
          projectCounts: COUNTS,
        },
      ]);
      expect(counted).toEqual([["project-1", "project-2"]]);
    });
  });

  describe("when the reading is below every threshold", () => {
    /** @scenario "A reading below every warning threshold records nothing and counts nothing" */
    it("neither counts nor records", async () => {
      const { warnings, recorded, counted } = warningsOver(COUNTS);

      await expect(
        warnings.sendWarning({
          organizationId: "org-1",
          currentMonthMessagesCount: 100,
          maxMonthlyUsageLimit: 1000,
        }),
      ).resolves.toEqual({ sent: false });

      expect(recorded).toEqual([]);
      expect(counted).toEqual([]);
    });
  });

  describe("when the per-project usage cannot be counted", () => {
    /** @scenario "A warning whose per-project counts are unknown is not recorded" */
    it("reports nothing sent and records nothing", async () => {
      const { warnings, recorded } = warningsOver(USAGE_UNKNOWN);

      await expect(
        warnings.sendWarning({
          organizationId: "org-1",
          currentMonthMessagesCount: 900,
          maxMonthlyUsageLimit: 1000,
        }),
      ).resolves.toEqual({ sent: false });

      expect(recorded).toEqual([]);
    });
  });
});
