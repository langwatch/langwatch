import { describe, expect, it, vi, beforeEach } from "vitest";
import { LicenseEnforcementService } from "../license-enforcement.service";
import type { ILicenseEnforcementRepository } from "../license-enforcement.repository";
import type { PlanProvider } from "../../app-layer/subscription/plan-provider";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { LimitExceededError } from "../errors";
import type { LimitType } from "../types";

/**
 * Unit tests for LicenseEnforcementService.
 *
 * Tests the core business logic:
 * - Limit checking returns correct allowed/denied status
 * - Enforcement throws LimitExceededError when limits exceeded
 * - Override flag bypasses enforcement
 * - All limit types are handled correctly
 *
 * Only the seat levers (members, lite members) remain enforced — workspace
 * structure (projects, teams) and experimentation resources are OSS/uncapped.
 */

describe("LicenseEnforcementService", () => {
  let service: LicenseEnforcementService;
  let mockRepository: ILicenseEnforcementRepository;
  let mockPlanProvider: PlanProvider;

  const basePlan: PlanInfo = {
    planSource: "subscription",
    type: "test",
    name: "Test Plan",
    free: false,
    maxMembers: 5,
    maxMembersLite: 2,
    maxMessagesPerMonth: 10000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };

  beforeEach(() => {
    mockRepository = {
      getMemberCount: vi.fn().mockResolvedValue(0),
      getMembersLiteCount: vi.fn().mockResolvedValue(0),
      getCurrentMonthCost: vi.fn().mockResolvedValue(0),
      getCurrentMonthCostForProjects: vi.fn().mockResolvedValue(0),
    };

    mockPlanProvider = {
      getActivePlan: vi.fn().mockResolvedValue(basePlan),
    };

    service = new LicenseEnforcementService(mockRepository, mockPlanProvider);
  });

  describe("checkLimit", () => {
    it("returns allowed when current count is below max", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(2);

      const result = await service.checkLimit("org-123", "members");

      expect(result).toEqual({
        allowed: true,
        current: 2,
        max: 5,
        limitType: "members",
      });
    });

    it("returns not allowed when current count equals max", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(5);

      const result = await service.checkLimit("org-123", "members");

      expect(result).toEqual({
        allowed: false,
        current: 5,
        max: 5,
        limitType: "members",
      });
    });

    it("returns not allowed when current count exceeds max", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(7);

      const result = await service.checkLimit("org-123", "members");

      expect(result).toEqual({
        allowed: false,
        current: 7,
        max: 5,
        limitType: "members",
      });
    });

    it("bypasses enforcement when plan has overrideAddingLimitations", async () => {
      const overridePlan = { ...basePlan, overrideAddingLimitations: true };
      vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue(overridePlan);
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(100);

      const result = await service.checkLimit("org-123", "members");

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0); // Override returns 0 for current
      expect(mockRepository.getMemberCount).not.toHaveBeenCalled();
    });

    it("passes user to plan provider for resolution", async () => {
      const user = { id: "user-123", email: "test@example.com", name: "Test" };

      await service.checkLimit("org-123", "members", user);

      expect(mockPlanProvider.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org-123",
        user: expect.objectContaining({ id: "user-123" }),
      });
    });

    describe("handles all limit types", () => {
      const limitTypeTests: Array<{
        type: LimitType;
        repoMethod: keyof ILicenseEnforcementRepository;
        planField: keyof PlanInfo;
      }> = [
        { type: "members", repoMethod: "getMemberCount", planField: "maxMembers" },
        { type: "membersLite", repoMethod: "getMembersLiteCount", planField: "maxMembersLite" },
      ];

      it.each(limitTypeTests)(
        "checks $type limit using $repoMethod",
        async ({ type, repoMethod, planField }) => {
          vi.mocked(mockRepository[repoMethod]).mockResolvedValue(1);

          const result = await service.checkLimit("org-123", type);

          expect(mockRepository[repoMethod]).toHaveBeenCalledWith("org-123");
          expect(result.limitType).toBe(type);
          expect(result.max).toBe(basePlan[planField]);
        }
      );
    });
  });

  describe("enforceLimit", () => {
    it("does not throw when limit is not exceeded", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(2);

      await expect(
        service.enforceLimit("org-123", "members")
      ).resolves.toBeUndefined();
    });

    it("throws LimitExceededError when limit is reached", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(5);

      await expect(service.enforceLimit("org-123", "members")).rejects.toThrow(
        LimitExceededError
      );
    });

    it("includes current, max, and members label in LimitExceededError", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(5);

      try {
        await service.enforceLimit("org-123", "members");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LimitExceededError);
        const limitError = error as LimitExceededError;
        expect(limitError.limitType).toBe("members");
        expect(limitError.current).toBe(5);
        expect(limitError.max).toBe(5);
        expect(limitError.message).toContain("maximum number of team members");
      }
    });

    it("passes user to checkLimit for plan resolution", async () => {
      const user = { id: "user-123", email: "test@example.com", name: "Test" };
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(0);

      await service.enforceLimit("org-123", "members", user);

      expect(mockPlanProvider.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org-123",
        user: expect.objectContaining({ id: "user-123" }),
      });
    });

    it("does not throw when overrideAddingLimitations is set", async () => {
      const overridePlan = { ...basePlan, overrideAddingLimitations: true };
      vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue(overridePlan);
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(1000);

      await expect(
        service.enforceLimit("org-123", "members")
      ).resolves.toBeUndefined();
    });
  });

  describe("enforceLimitByOrganization", () => {
    it("delegates to enforceLimit with the provided arguments", async () => {
      const user = { id: "user-123", email: "test@example.com", name: "Test" };
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(0);

      await service.enforceLimitByOrganization({
        organizationId: "org-456",
        limitType: "members",
        user,
      });

      expect(mockPlanProvider.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org-456",
        user: expect.objectContaining({ id: "user-123" }),
      });
      expect(mockRepository.getMemberCount).toHaveBeenCalledWith("org-456");
    });

    it("throws LimitExceededError mentioning members when member limit is reached", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(5);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "members",
        })
      ).rejects.toThrow(/maximum number of team members/);
    });

    it("does not throw when member count is below member limit", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(2);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "members",
        })
      ).resolves.toBeUndefined();
    });

    it("throws LimitExceededError when member count exceeds member limit", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(6);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "members",
        })
      ).rejects.toThrow(LimitExceededError);
    });

    it("does not require user parameter", async () => {
      vi.mocked(mockRepository.getMemberCount).mockResolvedValue(0);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "members",
        })
      ).resolves.toBeUndefined();
    });
  });
});
