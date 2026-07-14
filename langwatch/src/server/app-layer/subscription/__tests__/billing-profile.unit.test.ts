import { describe, expect, it } from "vitest";
import {
  deriveBillingProfile,
  deriveCapabilities,
} from "../billing-profile";

const seatPlan = {
  type: "GROWTH_SEAT_USD_MONTHLY",
  free: false,
  planSource: "subscription" as const,
};
const enterpriseLicense = {
  type: "ENTERPRISE",
  free: false,
  planSource: "license" as const,
};
const growthLicense = {
  type: "GROWTH",
  free: false,
  planSource: "license" as const,
};
const tieredPlan = {
  type: "LAUNCH",
  free: false,
  planSource: "subscription" as const,
};
const freePlan = { type: "FREE", free: true, planSource: "free" as const };

describe("deriveBillingProfile()", () => {
  describe("when the winning source is a seat-event subscription", () => {
    /** @scenario Seat-event subscription resolves member policy purchase_seat */
    it("resolves member policy purchase_seat", () => {
      expect(
        deriveBillingProfile({ plan: seatPlan, isSaaS: true }).memberPolicy,
      ).toBe("purchase_seat");
    });

    it("meters events", () => {
      expect(
        deriveBillingProfile({ plan: seatPlan, isSaaS: true }).meterUnit,
      ).toBe("events");
    });

    it("hides usage limits", () => {
      expect(
        deriveBillingProfile({ plan: seatPlan, isSaaS: true })
          .showUsageLimits,
      ).toBe(false);
    });

    it("is not legacy tiered", () => {
      expect(
        deriveBillingProfile({ plan: seatPlan, isSaaS: true }).isLegacyTiered,
      ).toBe(false);
    });
  });

  describe("when the winning source is an ENTERPRISE license", () => {
    /** @scenario ENTERPRISE license resolves member policy hard_cap */
    it("resolves member policy hard_cap on SaaS", () => {
      expect(
        deriveBillingProfile({ plan: enterpriseLicense, isSaaS: true })
          .memberPolicy,
      ).toBe("hard_cap");
    });
  });

  describe("when the winning source is a non-ENTERPRISE license", () => {
    /** @scenario Non-ENTERPRISE license on SaaS resolves member policy upgrade */
    it("resolves member policy upgrade on SaaS", () => {
      expect(
        deriveBillingProfile({ plan: growthLicense, isSaaS: true })
          .memberPolicy,
      ).toBe("upgrade");
    });

    /** @scenario Any license on self-hosted resolves member policy hard_cap */
    it("resolves member policy hard_cap on self-hosted", () => {
      expect(
        deriveBillingProfile({ plan: growthLicense, isSaaS: false })
          .memberPolicy,
      ).toBe("hard_cap");
    });
  });

  describe("when the winning source is a legacy tiered subscription", () => {
    /** @scenario Legacy tiered paid subscription resolves member policy upgrade */
    it("resolves member policy upgrade", () => {
      expect(
        deriveBillingProfile({ plan: tieredPlan, isSaaS: true }).memberPolicy,
      ).toBe("upgrade");
    });

    it("meters traces", () => {
      expect(
        deriveBillingProfile({ plan: tieredPlan, isSaaS: true }).meterUnit,
      ).toBe("traces");
    });

    it("shows usage limits", () => {
      expect(
        deriveBillingProfile({ plan: tieredPlan, isSaaS: true })
          .showUsageLimits,
      ).toBe(true);
    });

    it("is legacy tiered", () => {
      expect(
        deriveBillingProfile({ plan: tieredPlan, isSaaS: true })
          .isLegacyTiered,
      ).toBe(true);
    });
  });

  describe("when the organization is free", () => {
    /** @scenario Free organization resolves member policy upgrade */
    it("resolves member policy upgrade", () => {
      expect(
        deriveBillingProfile({ plan: freePlan, isSaaS: true }).memberPolicy,
      ).toBe("upgrade");
    });

    it("resolves member policy hard_cap on self-hosted", () => {
      expect(
        deriveBillingProfile({ plan: freePlan, isSaaS: false }).memberPolicy,
      ).toBe("hard_cap");
    });
  });
});

describe("deriveCapabilities()", () => {
  describe("when the winning plan is ENTERPRISE", () => {
    /** @scenario Enterprise plan resolves with enterprise capabilities enabled */
    it("enables enterprise capabilities", () => {
      const capabilities = deriveCapabilities({ plan: enterpriseLicense });
      expect(capabilities).toEqual({
        rbac: true,
        scim: true,
        sso: true,
        groups: true,
        customRoles: true,
      });
    });
  });

  describe("when the winning plan is a growth seat subscription", () => {
    /** @scenario Growth plan resolves with enterprise capabilities disabled */
    it("disables rbac", () => {
      expect(deriveCapabilities({ plan: seatPlan }).rbac).toBe(false);
    });
  });
});
