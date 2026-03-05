import { describe, expect, it, vi } from "vitest";
import { PlanProviderService, type PlanProvider } from "../plan-provider";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";

describe("PlanProvider wiring patterns", () => {
  describe("when wiring SaaS adapter", () => {
    it("bridges named params to positional-arg SaaS provider", async () => {
      const mockSaasProvider = {
        getActivePlan: vi.fn().mockResolvedValue(FREE_PLAN),
      };
      // This mirrors the adapter in presets.ts for SaaS mode
      const planProvider = PlanProviderService.create({
        getActivePlan: ({ organizationId, user }) =>
          mockSaasProvider.getActivePlan(organizationId, user),
      });

      const user = { id: "u1", email: "a@b.com" };
      const result = await planProvider.getActivePlan({
        organizationId: "org_1",
        user,
      });

      expect(result).toBe(FREE_PLAN);
      expect(mockSaasProvider.getActivePlan).toHaveBeenCalledWith("org_1", user);
    });

    it("forwards impersonator to SaaS provider", async () => {
      const mockSaasProvider = {
        getActivePlan: vi.fn().mockResolvedValue(FREE_PLAN),
      };
      const planProvider = PlanProviderService.create({
        getActivePlan: ({ organizationId, user }) =>
          mockSaasProvider.getActivePlan(organizationId, user),
      });

      const user = {
        id: "u1",
        email: "test@example.com",
        impersonator: { email: "admin@example.com" },
      };
      await planProvider.getActivePlan({ organizationId: "org_1", user });

      expect(mockSaasProvider.getActivePlan).toHaveBeenCalledWith("org_1", user);
    });
  });

  describe("when wiring license adapter", () => {
    it("bridges named params to license handler (ignores user)", async () => {
      const mockLicenseHandler = {
        getActivePlan: vi.fn().mockResolvedValue(FREE_PLAN),
      };
      // This mirrors the adapter in presets.ts for self-hosted mode
      const planProvider = PlanProviderService.create({
        getActivePlan: ({ organizationId }) =>
          mockLicenseHandler.getActivePlan(organizationId),
      });

      const result = await planProvider.getActivePlan({
        organizationId: "org_1",
        user: { id: "u1" },
      });

      expect(result).toBe(FREE_PLAN);
      expect(mockLicenseHandler.getActivePlan).toHaveBeenCalledWith("org_1");
    });
  });

  describe("when overriding with a custom provider", () => {
    it("uses the custom implementation", async () => {
      const customPlan: PlanInfo = {
        ...FREE_PLAN,
        type: "CUSTOM",
        name: "Custom",
        maxMessagesPerMonth: 999,
      };
      const planProvider = PlanProviderService.create({
        getActivePlan: async () => customPlan,
      });

      const result = await planProvider.getActivePlan({
        organizationId: "org_1",
      });

      expect(result).toBe(customPlan);
    });
  });

  describe("when source throws", () => {
    it("propagates errors from SaaS adapter unchanged", async () => {
      const error = new Error("stripe timeout");
      const planProvider = PlanProviderService.create({
        getActivePlan: ({ organizationId, user }) => {
          throw error;
        },
      });

      await expect(
        planProvider.getActivePlan({ organizationId: "org_1" })
      ).rejects.toBe(error);
    });

    it("propagates errors from license adapter unchanged", async () => {
      const error = new Error("license validation failed");
      const planProvider = PlanProviderService.create({
        getActivePlan: ({ organizationId }) => {
          throw error;
        },
      });

      await expect(
        planProvider.getActivePlan({ organizationId: "org_1" })
      ).rejects.toBe(error);
    });
  });
});
