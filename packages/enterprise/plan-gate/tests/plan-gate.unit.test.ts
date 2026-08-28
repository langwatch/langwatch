import { beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import {
  assertEnterprisePlan,
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
  isEnterpriseTier,
} from "../src";

const mockGetActivePlan = vi.fn();
const planProvider = { getActivePlan: mockGetActivePlan };

describe("the Enterprise plan gate", () => {
  describe("isEnterpriseTier", () => {
    /** @scenario Plan type matching is case-sensitive */
    it("returns true for ENTERPRISE", () => {
      expect(isEnterpriseTier("ENTERPRISE")).toBe(true);
    });

    describe("when plan type is not ENTERPRISE", () => {
      /** @scenario FREE plan is not recognized as enterprise */
      /** @scenario OPEN_SOURCE plan is not recognized as enterprise */
      it.each(["FREE", "OPEN_SOURCE", "PRO", "GROWTH", "STARTER", ""])(
        "returns false for %s",
        (planType) => {
          expect(isEnterpriseTier(planType)).toBe(false);
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
      /** @scenario Enterprise plan from subscription is recognized */
      /** @scenario Enterprise plan from license is recognized */
      it("resolves without throwing", async () => {
        const enterprisePlan: PlanInfo = {
          ...FREE_PLAN,
          type: "ENTERPRISE",
        };
        mockGetActivePlan.mockResolvedValue(enterprisePlan);

        await expect(
          assertEnterprisePlan({
            planProvider,
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
              planProvider,
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
            planProvider,
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
      /** @scenario Guard fails closed when plan lookup fails */
      it("denies access by propagating the error", async () => {
        mockGetActivePlan.mockRejectedValue(new Error("Plan provider unavailable"));

        await expect(
          assertEnterprisePlan({
            planProvider,
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
        planProvider,
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
