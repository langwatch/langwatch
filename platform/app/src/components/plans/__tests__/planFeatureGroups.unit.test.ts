import { describe, expect, it } from "vitest";
import { Currency } from "~/generated/prisma/client";
import {
  ENTERPRISE_PLAN_FEATURES,
  getGrowthPlanFeatures,
} from "../../subscription/billing-plans";
import { readPlanFeatures, UNGROUPED_LABEL } from "../planFeatureGroups";

describe("readPlanFeatures", () => {
  describe("given the Enterprise tier's bullets", () => {
    it("files every shipped bullet under a named group", () => {
      const { groups } = readPlanFeatures({
        planId: "enterprise",
        features: ENTERPRISE_PLAN_FEATURES,
      });

      expect(groups.map((group) => group.label)).not.toContain(UNGROUPED_LABEL);
      expect(groups.flatMap((group) => group.features).sort()).toEqual(
        [...ENTERPRISE_PLAN_FEATURES].sort(),
      );
    });

    it("leads with what the tier is bought for", () => {
      const { groups } = readPlanFeatures({
        planId: "enterprise",
        features: ENTERPRISE_PLAN_FEATURES,
      });

      expect(groups[0]?.label).toBe("Governance and security");
    });

    it("catches a bullet nobody has classified rather than dropping it", () => {
      const { groups } = readPlanFeatures({
        planId: "enterprise",
        features: [...ENTERPRISE_PLAN_FEATURES, "Something newly sold"],
      });

      const catchAll = groups.find((group) => group.label === UNGROUPED_LABEL);
      expect(catchAll?.features).toEqual(["Something newly sold"]);
    });
  });

  describe("given a tier that inherits the one below it", () => {
    it("lifts the inheritance line out of the bullet list", () => {
      const features = getGrowthPlanFeatures(Currency.EUR);

      const read = readPlanFeatures({ planId: "growth", features });

      expect(read.inherits).toBe("Everything in Free");
      expect(read.groups).toHaveLength(1);
      expect(read.groups[0]?.label).toBeNull();
      expect(read.groups[0]?.features).not.toContain("Everything in Free");
      expect(read.groups[0]?.features).toHaveLength(features.length - 1);
    });
  });

  describe("given a tier that inherits nothing", () => {
    it("keeps every bullet in the list", () => {
      const read = readPlanFeatures({
        planId: "free",
        features: ["All platform features", "Community support"],
      });

      expect(read.inherits).toBeNull();
      expect(read.groups[0]?.features).toEqual([
        "All platform features",
        "Community support",
      ]);
    });
  });
});
