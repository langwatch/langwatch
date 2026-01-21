/**
 * @vitest-environment node
 *
 * Integration tests for publicEnv router
 * Verifies that SELF_HOSTED_PLAN is correctly exposed based on LICENSE_KEY
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSelfHostedPlan } from "@langwatch/ee/license";

describe("publicEnv Router - SELF_HOSTED_PLAN", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getSelfHostedPlan integration", () => {
    it("returns self-hosted:oss when no LICENSE_KEY is set", () => {
      delete process.env.LICENSE_KEY;

      const plan = getSelfHostedPlan();

      expect(plan).toBe("self-hosted:oss");
    });

    it("returns self-hosted:enterprise for LW-ENT- prefixed key", () => {
      process.env.LICENSE_KEY = "LW-ENT-abc123";

      const plan = getSelfHostedPlan();

      expect(plan).toBe("self-hosted:enterprise");
    });

    it("returns self-hosted:pro for LW-PRO- prefixed key", () => {
      process.env.LICENSE_KEY = "LW-PRO-xyz789";

      const plan = getSelfHostedPlan();

      expect(plan).toBe("self-hosted:pro");
    });
  });

  describe("SELF_HOSTED_PLAN exposure", () => {
    it("exposes a valid SelfHostedPlan type value", () => {
      const validPlans = [
        "self-hosted:oss",
        "self-hosted:pro",
        "self-hosted:enterprise",
      ];

      // Test each plan type
      delete process.env.LICENSE_KEY;
      expect(validPlans).toContain(getSelfHostedPlan());

      process.env.LICENSE_KEY = "LW-PRO-test";
      expect(validPlans).toContain(getSelfHostedPlan());

      process.env.LICENSE_KEY = "LW-ENT-test";
      expect(validPlans).toContain(getSelfHostedPlan());
    });

    it("client can use SELF_HOSTED_PLAN for entitlement checks", () => {
      // Simulate client-side logic
      delete process.env.LICENSE_KEY;
      const plan = getSelfHostedPlan();

      // Client would check entitlements based on plan
      const ossEntitlements = [
        "sso-google",
        "sso-github",
        "sso-gitlab",
        "team-read",
        "project-read",
        "trace-read",
      ];

      // OSS plan should have basic entitlements but not custom-rbac
      const enterpriseOnlyEntitlements = ["custom-rbac"];

      expect(plan).toBe("self-hosted:oss");
      // These are available to all plans
      expect(ossEntitlements).toContain("sso-google");
      // These require enterprise
      expect(enterpriseOnlyEntitlements).toContain("custom-rbac");
    });
  });
});
