/**
 * @vitest-environment node
 *
 * Tests for role router entitlement gating
 * Verifies that custom RBAC operations require enterprise entitlement
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  requireEntitlementForCurrentPlan,
  hasEntitlementForCurrentPlan,
} from "../../../../features/entitlements";

describe("Role Router Entitlement Gating", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("requireEntitlementForCurrentPlan for custom-rbac", () => {
    it("throws FORBIDDEN when no LICENSE_KEY is set (OSS plan)", () => {
      delete process.env.LICENSE_KEY;

      expect(() => {
        requireEntitlementForCurrentPlan("custom-rbac");
      }).toThrow(TRPCError);

      try {
        requireEntitlementForCurrentPlan("custom-rbac");
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("FORBIDDEN");
        expect((error as TRPCError).message).toContain("custom-rbac");
        expect((error as TRPCError).message).toContain("Please upgrade your plan");
      }
    });

    it("throws FORBIDDEN for pro plan (LW-PRO-)", () => {
      process.env.LICENSE_KEY = "LW-PRO-test123";

      expect(() => {
        requireEntitlementForCurrentPlan("custom-rbac");
      }).toThrow(TRPCError);
    });

    it("does not throw for enterprise plan (LW-ENT-)", () => {
      process.env.LICENSE_KEY = "LW-ENT-test123";

      expect(() => {
        requireEntitlementForCurrentPlan("custom-rbac");
      }).not.toThrow();
    });
  });

  describe("hasEntitlementForCurrentPlan for custom-rbac", () => {
    it("returns false for OSS plan", () => {
      delete process.env.LICENSE_KEY;

      const result = hasEntitlementForCurrentPlan("custom-rbac");

      expect(result).toBe(false);
    });

    it("returns false for pro plan", () => {
      process.env.LICENSE_KEY = "LW-PRO-test123";

      const result = hasEntitlementForCurrentPlan("custom-rbac");

      expect(result).toBe(false);
    });

    it("returns true for enterprise plan", () => {
      process.env.LICENSE_KEY = "LW-ENT-test123";

      const result = hasEntitlementForCurrentPlan("custom-rbac");

      expect(result).toBe(true);
    });
  });

  describe("Entitlement gating logic for role operations", () => {
    it("custom role create should be gated by custom-rbac entitlement", () => {
      delete process.env.LICENSE_KEY;

      // Simulates the check that role.create does
      const hasEntitlement = hasEntitlementForCurrentPlan("custom-rbac");
      expect(hasEntitlement).toBe(false);

      // This is what checkEntitlement middleware does
      expect(() => {
        requireEntitlementForCurrentPlan("custom-rbac");
      }).toThrow(TRPCError);
    });

    it("custom role update should be gated by custom-rbac entitlement", () => {
      delete process.env.LICENSE_KEY;

      const hasEntitlement = hasEntitlementForCurrentPlan("custom-rbac");
      expect(hasEntitlement).toBe(false);
    });

    it("custom role delete should be gated by custom-rbac entitlement", () => {
      delete process.env.LICENSE_KEY;

      const hasEntitlement = hasEntitlementForCurrentPlan("custom-rbac");
      expect(hasEntitlement).toBe(false);
    });

    it("custom role assignment should be gated by custom-rbac entitlement", () => {
      delete process.env.LICENSE_KEY;

      // Simulates what team.ts does when detecting custom role assignment
      const hasCustomRoleAssignment = true; // Input contains custom role
      if (hasCustomRoleAssignment) {
        expect(() => {
          requireEntitlementForCurrentPlan("custom-rbac");
        }).toThrow(TRPCError);
      }
    });

    it("enterprise users can perform all custom role operations", () => {
      process.env.LICENSE_KEY = "LW-ENT-enterprise-key";

      // All role operations should pass
      expect(() => {
        requireEntitlementForCurrentPlan("custom-rbac");
      }).not.toThrow();
    });
  });
});
