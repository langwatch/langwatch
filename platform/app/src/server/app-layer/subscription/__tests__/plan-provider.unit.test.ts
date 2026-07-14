import { describe, expect, it, vi } from "vitest";
import {
  PlanProviderService,
  type PlanProvider,
  type PlanProviderUser,
} from "../plan-provider";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";

const STUB_PLAN: PlanInfo = {
  ...FREE_PLAN,
  type: "PRO",
  name: "Pro",
  free: false,
  maxMessagesPerMonth: 100_000,
};

describe("PlanProviderService", () => {
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

      await expect(
        service.getActivePlan({ organizationId: "org_1" })
      ).rejects.toBe(error);
    });
  });

  describe("when used as boundary adapter", () => {
    it("bridges named params to positional-arg SaaS provider", async () => {
      const saasGetActivePlan = vi.fn().mockResolvedValue(STUB_PLAN);

      const service = PlanProviderService.create({
        getActivePlan: ({ organizationId, user }) =>
          saasGetActivePlan(organizationId, user),
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
        getActivePlan: ({ organizationId }) =>
          licenseGetActivePlan(organizationId),
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
