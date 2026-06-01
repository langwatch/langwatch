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
    maxTeams: 5,
    maxProjects: 10,
    maxMessagesPerMonth: 10000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };

  beforeEach(() => {
    mockRepository = {
      getProjectCount: vi.fn().mockResolvedValue(0),
      getTeamCount: vi.fn().mockResolvedValue(0),
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
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(2);

      const result = await service.checkLimit("org-123", "projects");

      expect(result).toEqual({
        allowed: true,
        current: 2,
        max: 10,
        limitType: "projects",
      });
    });

    it("returns not allowed when current count equals max", async () => {
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(10);

      const result = await service.checkLimit("org-123", "projects");

      expect(result).toEqual({
        allowed: false,
        current: 10,
        max: 10,
        limitType: "projects",
      });
    });

    it("returns not allowed when current count exceeds max", async () => {
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(12);

      const result = await service.checkLimit("org-123", "projects");

      expect(result).toEqual({
        allowed: false,
        current: 12,
        max: 10,
        limitType: "projects",
      });
    });

    it("bypasses enforcement when plan has overrideAddingLimitations", async () => {
      const overridePlan = { ...basePlan, overrideAddingLimitations: true };
      vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue(overridePlan);
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(100);

      const result = await service.checkLimit("org-123", "projects");

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0); // Override returns 0 for current
      expect(mockRepository.getProjectCount).not.toHaveBeenCalled();
    });

    it("passes user to plan provider for resolution", async () => {
      const user = { id: "user-123", email: "test@example.com", name: "Test" };

      await service.checkLimit("org-123", "projects", user);

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
        { type: "projects", repoMethod: "getProjectCount", planField: "maxProjects" },
        { type: "members", repoMethod: "getMemberCount", planField: "maxMembers" },
        { type: "teams", repoMethod: "getTeamCount", planField: "maxTeams" },
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
    /** @scenario Allows project creation when under limit */
    it("does not throw when limit is not exceeded", async () => {
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(2);

      await expect(
        service.enforceLimit("org-123", "projects")
      ).resolves.toBeUndefined();
    });

    /** @scenario Blocks project creation when at limit */
    it("throws LimitExceededError when limit is reached", async () => {
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(10);

      await expect(service.enforceLimit("org-123", "projects")).rejects.toThrow(
        LimitExceededError
      );
    });

    /** @scenario Blocks project creation when at limit */
    it("includes current, max, and projects label in LimitExceededError", async () => {
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(10);

      try {
        await service.enforceLimit("org-123", "projects");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LimitExceededError);
        const limitError = error as LimitExceededError;
        expect(limitError.limitType).toBe("projects");
        expect(limitError.current).toBe(10);
        expect(limitError.max).toBe(10);
        expect(limitError.message).toContain("maximum number of projects");
      }
    });

    it("passes user to checkLimit for plan resolution", async () => {
      const user = { id: "user-123", email: "test@example.com", name: "Test" };
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(0);

      await service.enforceLimit("org-123", "projects", user);

      expect(mockPlanProvider.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org-123",
        user: expect.objectContaining({ id: "user-123" }),
      });
    });

    it("does not throw when overrideAddingLimitations is set", async () => {
      const overridePlan = { ...basePlan, overrideAddingLimitations: true };
      vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue(overridePlan);
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(1000);

      await expect(
        service.enforceLimit("org-123", "projects")
      ).resolves.toBeUndefined();
    });
  });

  describe("enforceLimitByOrganization", () => {
    it("delegates to enforceLimit with the provided arguments", async () => {
      const user = { id: "user-123", email: "test@example.com", name: "Test" };
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(0);

      await service.enforceLimitByOrganization({
        organizationId: "org-456",
        limitType: "projects",
        user,
      });

      expect(mockPlanProvider.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org-456",
        user: expect.objectContaining({ id: "user-123" }),
      });
      expect(mockRepository.getProjectCount).toHaveBeenCalledWith("org-456");
    });

    /** @scenario Blocks team creation when at limit */
    it("throws LimitExceededError mentioning teams when team limit is reached", async () => {
      vi.mocked(mockRepository.getTeamCount).mockResolvedValue(5);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "teams",
        })
      ).rejects.toThrow(/maximum number of teams/);
    });

    /** @scenario Allows project creation when under limit */
    it("does not throw when project count is below project limit", async () => {
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(2);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "projects",
        })
      ).resolves.toBeUndefined();
    });

    /** @scenario Blocks project creation when over limit */
    it("throws LimitExceededError when project count exceeds project limit", async () => {
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(11);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "projects",
        })
      ).rejects.toThrow(LimitExceededError);
    });

    it("does not require user parameter", async () => {
      vi.mocked(mockRepository.getProjectCount).mockResolvedValue(0);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "projects",
        })
      ).resolves.toBeUndefined();
    });
  });
});
