/**
 * A retention rule change asks billing to align the storage line, and survives billing failing.
 * @see specs/billing/retention-storage-billing.feature
 */
import type { BillingApi, RetentionStorageReport } from "@langwatch/enterprise-billing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { createDataRetentionTestApp, retentionTestGraph } from "./data-retention.fixture.ts";

const organizationId = retentionTestGraph.organizationId ?? "";

function change() {
  return {
    scope: { scopeType: "ORGANIZATION" as const, scopeId: organizationId },
    category: "traces" as const,
    retentionDays: 182,
    userId: "user-1",
  };
}

describe("DataRetentionModule storage line", () => {
  describe("when an administrator changes the traces retention to 182 days", () => {
    /** @scenario "A retention rule change aligns the storage line" */
    it("asks billing to align the line for the organization's longest retention", async () => {
      const calls: RetentionStorageReport[] = [];
      const app = createDataRetentionTestApp({
        dependencies: {
          billing: createApiFixture<BillingApi>({
            recordRetentionStorage: async (input: RetentionStorageReport) => {
              calls.push(input);
              return { line: "added", reportedGbMonths: null };
            },
          }),
        },
      });

      await app.changeScopeRetention(change());

      expect(calls).toEqual([{ organizationId, longestRetentionDays: 182 }]);
    });
  });

  describe("when billing cannot be reached", () => {
    /** @scenario "A billing failure does not undo a retention change" */
    it("keeps the saved rule", async () => {
      const app = createDataRetentionTestApp({
        dependencies: {
          billing: createApiFixture<BillingApi>({
            recordRetentionStorage: async () => {
              throw new Error("billing is down");
            },
          }),
        },
      });

      await app.changeScopeRetention(change());

      const rules = await app.listOrganizationRules({ organizationId });
      expect(rules.map((rule) => rule.retentionDays)).toEqual([182]);
    });
  });

  describe("when the plan card asks for the organization's retention", () => {
    it("answers the organization rule's traces days", async () => {
      const app = createDataRetentionTestApp();
      await app.changeScopeRetention(change());

      await expect(app.getOrganizationRetention({ organizationId })).resolves.toEqual({
        retentionDays: 182,
      });
    });
  });
});
