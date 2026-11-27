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
        billsStorage: false,
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
        billsStorage: false,
      });
    });
  });

  describe("when the organization is on a Growth seat plan", () => {
    /** @scenario "A project admin without subscription:manage is refused a billed retention by name" */
    it("bills storage on SaaS, and not on a self-hosted deployment", async () => {
      const growth = { free: false, type: "GROWTH_SEAT_USD_ANNUAL" };
      const plan = (isSaas: boolean) =>
        RetentionPlanService.create({
          entitlement: createDataRetentionTestEntitlement(growth),
          isSaas,
        }).getPlan({ organizationId: "org_1", userId: null });

      await expect(plan(true)).resolves.toMatchObject({ billsStorage: true });
      await expect(plan(false)).resolves.toMatchObject({ billsStorage: false });
    });
  });
});
