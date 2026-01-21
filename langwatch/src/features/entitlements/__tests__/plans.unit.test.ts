/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { getEntitlementsForPlan, type Plan } from "../plans";

describe("Plan to Entitlement Mapping", () => {
  describe("exhaustive plan handling", () => {
    it("handles all plan types without throwing", () => {
      const allPlans: Plan[] = [
        "self-hosted:oss",
        "self-hosted:pro",
        "self-hosted:enterprise",
      ];

      for (const plan of allPlans) {
        expect(() => getEntitlementsForPlan(plan)).not.toThrow();
        expect(Array.isArray(getEntitlementsForPlan(plan))).toBe(true);
      }
    });
  });

  describe("OSS plan entitlements", () => {
    it("includes base SSO entitlements", () => {
      const entitlements = getEntitlementsForPlan("self-hosted:oss");

      expect(entitlements).toContain("sso-google");
      expect(entitlements).toContain("sso-github");
      expect(entitlements).toContain("sso-gitlab");
    });

    it("does not include custom-rbac", () => {
      const entitlements = getEntitlementsForPlan("self-hosted:oss");

      expect(entitlements).not.toContain("custom-rbac");
    });
  });

  describe("Pro plan entitlements", () => {
    it("includes base SSO entitlements", () => {
      const entitlements = getEntitlementsForPlan("self-hosted:pro");

      expect(entitlements).toContain("sso-google");
      expect(entitlements).toContain("sso-github");
      expect(entitlements).toContain("sso-gitlab");
    });

    it("does not include custom-rbac", () => {
      const entitlements = getEntitlementsForPlan("self-hosted:pro");

      expect(entitlements).not.toContain("custom-rbac");
    });
  });

  describe("Enterprise plan entitlements", () => {
    it("includes all base SSO entitlements", () => {
      const entitlements = getEntitlementsForPlan("self-hosted:enterprise");

      expect(entitlements).toContain("sso-google");
      expect(entitlements).toContain("sso-github");
      expect(entitlements).toContain("sso-gitlab");
    });

    it("includes custom-rbac", () => {
      const entitlements = getEntitlementsForPlan("self-hosted:enterprise");

      expect(entitlements).toContain("custom-rbac");
    });
  });
});
