/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  hasEntitlement,
  hasEntitlementForCurrentPlan,
  requireEntitlement,
  requireEntitlementForCurrentPlan,
} from "../hasEntitlement";

describe("Entitlement Checking", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("hasEntitlement", () => {
    it("returns true for enterprise plan with custom-rbac", () => {
      const result = hasEntitlement("self-hosted:enterprise", "custom-rbac");
      expect(result).toBe(true);
    });

    it("returns false for OSS plan with custom-rbac", () => {
      const result = hasEntitlement("self-hosted:oss", "custom-rbac");
      expect(result).toBe(false);
    });

    it("returns true for OSS plan with sso-google", () => {
      const result = hasEntitlement("self-hosted:oss", "sso-google");
      expect(result).toBe(true);
    });

    it("returns false for pro plan with custom-rbac", () => {
      const result = hasEntitlement("self-hosted:pro", "custom-rbac");
      expect(result).toBe(false);
    });
  });

  describe("hasEntitlementForCurrentPlan", () => {
    it("returns true for enterprise plan with custom-rbac", () => {
      process.env.LICENSE_KEY = "LW-ENT-test";

      const result = hasEntitlementForCurrentPlan("custom-rbac");

      expect(result).toBe(true);
    });

    it("returns false for OSS plan with custom-rbac", () => {
      delete process.env.LICENSE_KEY;

      const result = hasEntitlementForCurrentPlan("custom-rbac");

      expect(result).toBe(false);
    });
  });

  describe("requireEntitlement", () => {
    it("does not throw for enterprise plan with custom-rbac", () => {
      expect(() => {
        requireEntitlement("self-hosted:enterprise", "custom-rbac");
      }).not.toThrow();
    });

    it("throws FORBIDDEN for OSS plan with custom-rbac", () => {
      expect(() => {
        requireEntitlement("self-hosted:oss", "custom-rbac");
      }).toThrow(TRPCError);

      try {
        requireEntitlement("self-hosted:oss", "custom-rbac");
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("FORBIDDEN");
        expect((error as TRPCError).message).toContain("custom-rbac");
      }
    });
  });

  describe("requireEntitlementForCurrentPlan", () => {
    it("does not throw for enterprise plan with custom-rbac", () => {
      process.env.LICENSE_KEY = "LW-ENT-test";

      expect(() => {
        requireEntitlementForCurrentPlan("custom-rbac");
      }).not.toThrow();
    });

    it("throws FORBIDDEN for OSS plan with custom-rbac", () => {
      delete process.env.LICENSE_KEY;

      expect(() => {
        requireEntitlementForCurrentPlan("custom-rbac");
      }).toThrow(TRPCError);
    });
  });
});
