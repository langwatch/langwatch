import { describe, expect, it } from "vitest";
import {
  getPlanManagementUrl,
  getPlanManagementButtonLabel,
  getPlanActionLabel,
  shouldShowPlanLimits,
} from "../usePlanManagementUrl";

/**
 * Pure unit tests for plan management URL utilities.
 * Testing the synchronous helper functions (pure functions).
 * Hook testing would require React testing setup.
 */

describe("getPlanManagementUrl", () => {
  it("returns subscription URL in SaaS mode", () => {
    expect(getPlanManagementUrl(true)).toBe("/settings/subscription");
  });

  it("returns license URL in self-hosted mode", () => {
    expect(getPlanManagementUrl(false)).toBe("/settings/license");
  });
});

describe("getPlanManagementButtonLabel", () => {
  it("returns 'Upgrade plan' in SaaS mode", () => {
    expect(getPlanManagementButtonLabel(true)).toBe("Upgrade plan");
  });

  it("returns 'Upgrade license' in self-hosted mode", () => {
    expect(getPlanManagementButtonLabel(false)).toBe("Upgrade license");
  });
});

describe("getPlanActionLabel", () => {
  describe("when in SaaS mode", () => {
    it("returns 'Upgrade Plan' for free tier", () => {
      expect(
        getPlanActionLabel({ isSaaS: true, isFree: true, isEnterprise: false, hasValidLicense: false })
      ).toBe("Upgrade Plan");
    });

    it("returns 'Manage Subscription' for paid non-enterprise plan", () => {
      expect(
        getPlanActionLabel({ isSaaS: true, isFree: false, isEnterprise: false, hasValidLicense: false })
      ).toBe("Manage Subscription");
    });

    it("returns 'Manage Subscription' for enterprise plan", () => {
      expect(
        getPlanActionLabel({ isSaaS: true, isFree: false, isEnterprise: true, hasValidLicense: false })
      ).toBe("Manage Subscription");
    });
  });

  describe("when self-hosted", () => {
    it("returns 'Manage License' with a valid license", () => {
      expect(
        getPlanActionLabel({ isSaaS: false, isFree: false, isEnterprise: false, hasValidLicense: true })
      ).toBe("Manage License");
    });

    it("returns 'Upgrade License' without a valid license", () => {
      expect(
        getPlanActionLabel({ isSaaS: false, isFree: false, isEnterprise: false, hasValidLicense: false })
      ).toBe("Upgrade License");
    });
  });
});

describe("shouldShowPlanLimits()", () => {
  describe("given a free plan", () => {
    it("returns true for SEAT_EVENT pricing model", () => {
      expect(
        shouldShowPlanLimits({
          isFree: true,
          isEnterprise: false,
          billing: { showUsageLimits: false },
        })
      ).toBe(true);
    });

    it("returns true for TIERED pricing model", () => {
      expect(
        shouldShowPlanLimits({
          isFree: true,
          isEnterprise: false,
          billing: { showUsageLimits: true },
        })
      ).toBe(true);
    });
  });

  describe("given a paid non-enterprise plan", () => {
    describe("when pricing model is TIERED", () => {
      it("returns true", () => {
        expect(
          shouldShowPlanLimits({
            isFree: false,
            isEnterprise: false,
            billing: { showUsageLimits: true },
          })
        ).toBe(true);
      });
    });

    describe("when pricing model is SEAT_EVENT", () => {
      it("returns false", () => {
        expect(
          shouldShowPlanLimits({
            isFree: false,
            isEnterprise: false,
            billing: { showUsageLimits: false },
          })
        ).toBe(false);
      });
    });

    describe("when pricing model is undefined", () => {
      it("returns true", () => {
        expect(
          shouldShowPlanLimits({
            isFree: false,
            isEnterprise: false,
            billing: undefined,
          })
        ).toBe(true);
      });
    });

    describe("when pricing model is null", () => {
      it("returns true", () => {
        expect(
          shouldShowPlanLimits({
            isFree: false,
            isEnterprise: false,
            billing: undefined,
          })
        ).toBe(true);
      });
    });
  });

  describe("given an enterprise plan", () => {
    it("returns false for TIERED pricing model", () => {
      expect(
        shouldShowPlanLimits({
          isFree: false,
          isEnterprise: true,
          billing: { showUsageLimits: true },
        })
      ).toBe(false);
    });

    it("returns false for SEAT_EVENT pricing model", () => {
      expect(
        shouldShowPlanLimits({
          isFree: false,
          isEnterprise: true,
          billing: { showUsageLimits: false },
        })
      ).toBe(false);
    });
  });
});
