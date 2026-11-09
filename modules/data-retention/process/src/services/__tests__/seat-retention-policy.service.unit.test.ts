/**
 * @vitest-environment node
 * A Growth Seat activation sets the retention the buyer picked at upgrade.
 * @see specs/billing/retention-at-upgrade.feature
 */
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  type RetentionCategory,
  retentionCategories,
  type RetentionPolicy,
} from "@langwatch/data-retention-contract";
import { describe, expect, it } from "vitest";

import { SeatRetentionPolicyService } from "../seat-retention-policy.service.ts";

const ORGANIZATION_ID = "org_acme";

type Row = { category: RetentionCategory; retentionDays: number };

function organizationRules(existing: Row[] = []) {
  const rows = new Map<RetentionCategory, number>(
    existing.map((row) => [row.category, row.retentionDays]),
  );
  const asPolicy = ([category, retentionDays]: [RetentionCategory, number]): RetentionPolicy => ({
    id: `policy-${category}`,
    organizationId: ORGANIZATION_ID,
    scopeType: "ORGANIZATION",
    scopeId: ORGANIZATION_ID,
    category,
    retentionDays,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  return {
    rows,
    rules: {
      listOrganizationRules: async () => [...rows.entries()].map(asPolicy),
      setForScope: async (input: { category: RetentionCategory; retentionDays: number }) => {
        rows.set(input.category, input.retentionDays);
        return asPolicy([input.category, input.retentionDays]);
      },
    },
  };
}

describe("SeatRetentionPolicyService", () => {
  describe("when the checkout carried a Growth retention pick", () => {
    /** @scenario "The paid activation sets the picked retention on the organization" */
    it("sets every category of the organization to the pick, over an existing value", async () => {
      const store = organizationRules([{ category: "traces", retentionDays: 49 }]);
      const service = SeatRetentionPolicyService.create({ rules: store.rules });

      await service.provisionMissing({ organizationId: ORGANIZATION_ID, retentionDays: 182 });

      for (const category of retentionCategories) {
        expect(store.rows.get(category)).toBe(182);
      }
    });
  });

  describe("when the checkout carried a value that is not a Growth option", () => {
    /** @scenario "A retention that is not a Growth option is ignored" */
    it("provisions the platform default for the categories that have none", async () => {
      const store = organizationRules([{ category: "traces", retentionDays: 63 }]);
      const service = SeatRetentionPolicyService.create({ rules: store.rules });

      await service.provisionMissing({ organizationId: ORGANIZATION_ID, retentionDays: 40 });

      expect(store.rows.get("traces")).toBe(63);
      expect(store.rows.get("scenarios")).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
      expect(store.rows.get("experiments")).toBe(PLATFORM_DEFAULT_RETENTION_DAYS);
    });
  });
});
