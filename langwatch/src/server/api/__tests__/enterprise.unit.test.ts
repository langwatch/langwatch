import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isEnterpriseTier,
  isCustomRole,
  assertEnterprisePlan,
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
} from "../enterprise";
import { FREE_PLAN } from "../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";

const mockGetActivePlan = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    planProvider: {
      getActivePlan: mockGetActivePlan,
    },
  }),
}));

describe("enterprise", () => {
  describe("isEnterpriseTier", () => {
    it("returns true for ENTERPRISE", () => {
      expect(isEnterpriseTier("ENTERPRISE")).toBe(true);
    });

    describe("when plan type is not ENTERPRISE", () => {
      it.each(["FREE", "OPEN_SOURCE", "PRO", "GROWTH", "STARTER", ""])(
        "returns false for %s",
        (planType) => {
          expect(isEnterpriseTier(planType)).toBe(false);
        },
      );
    });
  });

  describe("isCustomRole", () => {
    it("returns true for custom role strings", () => {
      expect(isCustomRole("custom:abc")).toBe(true);
    });

    describe("when role is not a custom role", () => {
      it.each(["ADMIN", "MEMBER", "VIEWER", ""])(
        "returns false for %s",
        (role) => {
          expect(isCustomRole(role)).toBe(false);
        },
      );
    });
  });

  describe("assertEnterprisePlanType", () => {
    describe("when plan type is ENTERPRISE", () => {
      it("does not throw", () => {
        expect(() =>
          assertEnterprisePlanType({
            planType: "ENTERPRISE",
            errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
          }),
        ).not.toThrow();
      });
    });

    describe("when plan type is not ENTERPRISE", () => {
      it("throws FORBIDDEN with the provided error message", () => {
        expect(() =>
          assertEnterprisePlanType({
            planType: "FREE",
            errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
          }),
        ).toThrow(
          expect.objectContaining({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          }),
        );
      });
    });
  });

  describe("assertEnterprisePlan", () => {
    beforeEach(() => {
      mockGetActivePlan.mockReset();
    });

    describe("when plan is ENTERPRISE", () => {
      it("resolves without throwing", async () => {
        const enterprisePlan: PlanInfo = {
          ...FREE_PLAN,
          type: "ENTERPRISE",
        };
        mockGetActivePlan.mockResolvedValue(enterprisePlan);

        await expect(
          assertEnterprisePlan({
            organizationId: "org-1",
            errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
          }),
        ).resolves.toBeUndefined();
      });
    });

    describe("when plan is not ENTERPRISE", () => {
      it.each(["FREE", "OPEN_SOURCE", "PRO", "GROWTH"])(
        "throws FORBIDDEN for %s plan",
        async (planType) => {
          const plan: PlanInfo = {
            ...FREE_PLAN,
            type: planType,
          };
          mockGetActivePlan.mockResolvedValue(plan);

          await expect(
            assertEnterprisePlan({
              organizationId: "org-1",
              errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });
        },
      );

      it("uses the provided errorMessage", async () => {
        mockGetActivePlan.mockResolvedValue({
          ...FREE_PLAN,
          type: "FREE",
        });

        await expect(
          assertEnterprisePlan({
            organizationId: "org-1",
            errorMessage: ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS,
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS,
        });
      });
    });

    describe("when plan provider fails", () => {
      it("denies access by propagating the error", async () => {
        mockGetActivePlan.mockRejectedValue(
          new Error("Plan provider unavailable"),
        );

        await expect(
          assertEnterprisePlan({
            organizationId: "org-123",
            errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
          }),
        ).rejects.toThrow("Plan provider unavailable");
      });
    });

    it("passes user to planProvider when provided", async () => {
      const enterprisePlan: PlanInfo = {
        ...FREE_PLAN,
        type: "ENTERPRISE",
      };
      mockGetActivePlan.mockResolvedValue(enterprisePlan);

      const user = { id: "user-1", email: "test@example.com", name: "Test" };
      await assertEnterprisePlan({
        organizationId: "org-1",
        user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });

      expect(mockGetActivePlan).toHaveBeenCalledWith({
        organizationId: "org-1",
        user,
      });
    });
  });
});
