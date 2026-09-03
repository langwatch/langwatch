import { describe, expect, it, vi } from "vitest";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import {
  type PlanProvider,
  PlanProviderService,
  type PlanProviderUser,
} from "../plan-provider.service";

const STUB_PLAN: PlanInfo = {
  ...FREE_PLAN,
  type: "PRO",
  name: "Pro",
  free: false,
  maxMessagesPerMonth: 100_000,
};

const ENTERPRISE_PLAN: PlanInfo = {
  ...STUB_PLAN,
  type: "ENTERPRISE",
  name: "Enterprise",
};

describe("PlanProviderService", () => {
  describe("when the source answers an enterprise plan", () => {
    /** @scenario An enterprise license signed before the flag existed is entitled */
    it("entitles a plan whose payload never mentioned webhook endpoints", async () => {
      const service = PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue(ENTERPRISE_PLAN),
      });

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan.webhookEndpointsEnabled).toBe(true);
    });

    /** @scenario An enterprise subscription with no license is entitled */
    it("entitles it the same way whichever leg resolved it", async () => {
      const service = PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue({
          ...ENTERPRISE_PLAN,
          planSource: "subscription",
        }),
      });

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan.webhookEndpointsEnabled).toBe(true);
      expect(plan.planSource).toBe("subscription");
    });

    /** @scenario An entitlement switched off in the payload stays off */
    it("leaves an entitlement the plan switched off switched off", async () => {
      const service = PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue({
          ...ENTERPRISE_PLAN,
          webhookEndpointsEnabled: false,
        }),
      });

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan.webhookEndpointsEnabled).toBe(false);
    });

    /** @scenario Impersonation powers are not an entitlement of the enterprise tier */
    it("does not hand it the power to add limitations", async () => {
      const service = PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue(ENTERPRISE_PLAN),
      });

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      // The source said false. Authorization is not a tier entitlement, so
      // resolving an enterprise plan must not turn it on.
      expect(plan.overrideAddingLimitations).toBe(false);
    });
  });

  describe("when the source answers a plan below enterprise", () => {
    /** @scenario A plan below enterprise is not entitled */
    it("adds no entitlement to it", async () => {
      const service = PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue(STUB_PLAN),
      });

      const plan = await service.getActivePlan({ organizationId: "org_1" });

      expect(plan.webhookEndpointsEnabled).toBeUndefined();
    });
  });

  describe("when created with a SaaS-style source", () => {
    it("delegates getActivePlan with organizationId and user", async () => {
      const source: PlanProvider = {
        getActivePlan: vi.fn().mockResolvedValue(STUB_PLAN),
      };
      const service = PlanProviderService.create(source);

      const user: PlanProviderUser = {
        id: "user_1",
        email: "test@example.com",
        name: "Test",
      };
      const result = await service.getActivePlan({
        organizationId: "org_1",
        user,
      });

      expect(result).toBe(STUB_PLAN);
      expect(source.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org_1",
        user,
      });
    });

    it("forwards user with impersonator field", async () => {
      const source: PlanProvider = {
        getActivePlan: vi.fn().mockResolvedValue(STUB_PLAN),
      };
      const service = PlanProviderService.create(source);

      const user: PlanProviderUser = {
        id: "user_1",
        email: "test@example.com",
        impersonator: { email: "admin@example.com" },
      };
      await service.getActivePlan({ organizationId: "org_1", user });

      expect(source.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org_1",
        user,
      });
    });

    it("handles undefined user", async () => {
      const source: PlanProvider = {
        getActivePlan: vi.fn().mockResolvedValue(FREE_PLAN),
      };
      const service = PlanProviderService.create(source);

      const result = await service.getActivePlan({
        organizationId: "org_1",
      });

      expect(result).toBe(FREE_PLAN);
      expect(source.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org_1",
      });
    });
  });

  describe("when source throws an error", () => {
    it("propagates the error unchanged", async () => {
      const error = new Error("plan resolution failed");
      const source: PlanProvider = {
        getActivePlan: vi.fn().mockRejectedValue(error),
      };
      const service = PlanProviderService.create(source);

      await expect(service.getActivePlan({ organizationId: "org_1" })).rejects.toBe(error);
    });
  });

  describe("when used as boundary adapter", () => {
    it("bridges named params to positional-arg SaaS provider", async () => {
      const saasGetActivePlan = vi.fn().mockResolvedValue(STUB_PLAN);

      const service = PlanProviderService.create({
        getActivePlan: ({ organizationId, user }) => saasGetActivePlan(organizationId, user),
      });

      const user: PlanProviderUser = { id: "u1", email: "a@b.com" };
      const result = await service.getActivePlan({
        organizationId: "org_1",
        user,
      });

      expect(result).toBe(STUB_PLAN);
      expect(saasGetActivePlan).toHaveBeenCalledWith("org_1", user);
    });

    it("bridges named params to license handler (no user param)", async () => {
      const licenseGetActivePlan = vi.fn().mockResolvedValue(FREE_PLAN);

      const service = PlanProviderService.create({
        getActivePlan: ({ organizationId }) => licenseGetActivePlan(organizationId),
      });

      const result = await service.getActivePlan({
        organizationId: "org_1",
        user: { id: "u1" },
      });

      expect(result).toBe(FREE_PLAN);
      expect(licenseGetActivePlan).toHaveBeenCalledWith("org_1");
    });
  });
});
