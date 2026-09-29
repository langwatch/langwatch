import { createApiFixture } from "@langwatch/api-fixture";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { buildEntitlementInfrastructure } from "../entitlement-composition.build.ts";
import { USAGE_UNKNOWN, type ProjectUsageCounts } from "../entitlement.members.ts";

function warningsOver(counts: ProjectUsageCounts) {
  const sent: Parameters<BillingApi["sendUsageWarning"]>[0][] = [];
  const counted: string[][] = [];
  const billing = createApiFixture<BillingApi>({
    getActiveSubscriptionPlan: async () => {
      throw new Error("off Cloud, no subscription is read");
    },
    getPricingModel: async () => ({ pricingModel: null }),
    countBillableEventsByProjects: async ({ projectIds }) => {
      counted.push(projectIds);
      return counts;
    },
    sendUsageWarning: async (input) => {
      sent.push(input);
      return { sent: true, notificationId: "notification-1" };
    },
  });
  const { warnings } = buildEntitlementInfrastructure({
    logger: createTestLogger().logger,
    isSaas: false,
    processName: "test",
    license: { resolve: async () => ({ granted: false }) },
    billing,
    usage: {
      billing,
      traces: {
        countTracesByProjects: async () => {
          throw new Error("a free plan off Cloud is metered in events");
        },
      },
      organizations: createApiFixture({}),
      projects: { listIdsByOrganization: async () => ["project-1", "project-2"] },
    },
  });
  return { warnings, sent, counted };
}

const COUNTS = [
  { projectId: "project-1", count: 600 },
  { projectId: "project-2", count: 300 },
];

describe("the usage-limit warning entitlement composes", () => {
  describe("when the reading crosses a threshold", () => {
    /** @scenario "Entitlement decides the warning and billing only sends it" */
    it("asks billing to send the decided threshold with each project's count", async () => {
      const { warnings, sent, counted } = warningsOver(COUNTS);

      await expect(
        warnings.sendWarning({
          organizationId: "org-1",
          currentMonthMessagesCount: 900,
          maxMonthlyUsageLimit: 1000,
        }),
      ).resolves.toEqual({ sent: true, notificationId: "notification-1" });

      expect(sent).toEqual([
        {
          organizationId: "org-1",
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
    /** @scenario "A reading below every warning threshold sends nothing and counts nothing" */
    it("neither counts nor asks billing", async () => {
      const { warnings, sent, counted } = warningsOver(COUNTS);

      await expect(
        warnings.sendWarning({
          organizationId: "org-1",
          currentMonthMessagesCount: 100,
          maxMonthlyUsageLimit: 1000,
        }),
      ).resolves.toEqual({ sent: false });

      expect(sent).toEqual([]);
      expect(counted).toEqual([]);
    });
  });

  describe("when the per-project usage cannot be counted", () => {
    /** @scenario "A warning whose per-project usage could not be counted is not sent" */
    it("reports nothing sent and does not ask billing", async () => {
      const { warnings, sent } = warningsOver(USAGE_UNKNOWN);

      await expect(
        warnings.sendWarning({
          organizationId: "org-1",
          currentMonthMessagesCount: 900,
          maxMonthlyUsageLimit: 1000,
        }),
      ).resolves.toEqual({ sent: false });

      expect(sent).toEqual([]);
    });
  });
});
