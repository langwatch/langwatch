import { describe, expect, it } from "vitest";
import {
  getPlanManagementUrl,
  getPlanManagementButtonLabel,
  getPlanActionLabel,
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
