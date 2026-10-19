import { describe, expect, it } from "vitest";

import { createDataRetentionTestEntitlement } from "../../app/__tests__/data-retention.fixture.ts";
import { RetentionPlanService } from "../retention-plan.service.ts";

const PAID = { free: false, type: "LAUNCH" };

describe("RetentionPlanService", () => {
  describe("when the organization is on a paid, non-enterprise plan", () => {
    /** @scenario "A self-hosted deployment gets the full retention range on any paid plan" */
    it("is uncapped on a self-hosted deployment", async () => {
      const plans = RetentionPlanService.create({
        entitlement: createDataRetentionTestEntitlement(PAID),
        isSaas: false,
      });
      await expect(plans.getPlan({ organizationId: "org_1", userId: null })).resolves.toEqual({
        free: false,
        uncapped: true,
      });
    });

    it("stays capped on SaaS", async () => {
      const plans = RetentionPlanService.create({
        entitlement: createDataRetentionTestEntitlement(PAID),
        isSaas: true,
      });
      await expect(plans.getPlan({ organizationId: "org_1", userId: null })).resolves.toEqual({
        free: false,
        uncapped: false,
      });
    });
  });
});
