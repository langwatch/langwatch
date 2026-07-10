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
    maxWorkflows: 3,
    maxPrompts: 5,
    maxEvaluators: 4,
    maxScenarios: 6,
    maxAgents: 10,
    maxExperiments: 3,
    maxOnlineEvaluations: 8,
    maxDatasets: 5,
    maxDashboards: 5,
    maxCustomGraphs: 10,
    maxAutomations: 5,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };

  beforeEach(() => {
    mockRepository = {
      getWorkflowCount: vi.fn().mockResolvedValue(0),
      getPromptCount: vi.fn().mockResolvedValue(0),
      getEvaluatorCount: vi.fn().mockResolvedValue(0),
      getActiveScenarioCount: vi.fn().mockResolvedValue(0),
      getAgentCount: vi.fn().mockResolvedValue(0),
      getExperimentCount: vi.fn().mockResolvedValue(0),
      getOnlineEvaluationCount: vi.fn().mockResolvedValue(0),
      getDatasetCount: vi.fn().mockResolvedValue(0),
      getDashboardCount: vi.fn().mockResolvedValue(0),
      getCustomGraphCount: vi.fn().mockResolvedValue(0),
      getAutomationCount: vi.fn().mockResolvedValue(0),
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
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(2);

      const result = await service.checkLimit("org-123", "workflows");

      expect(result).toEqual({
        allowed: true,
        current: 2,
        max: 3,
        limitType: "workflows",
        resolution: "upgrade",
      });
    });

    it("returns not allowed when current count equals max", async () => {
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(3);

      const result = await service.checkLimit("org-123", "workflows");

      expect(result).toEqual({
        allowed: false,
        current: 3,
        max: 3,
        limitType: "workflows",
        resolution: "upgrade",
      });
    });

    it("returns not allowed when current count exceeds max", async () => {
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(5);

      const result = await service.checkLimit("org-123", "workflows");

      expect(result).toEqual({
        allowed: false,
        current: 5,
        max: 3,
        limitType: "workflows",
        resolution: "upgrade",
      });
    });

    it("bypasses enforcement when plan has overrideAddingLimitations", async () => {
      const overridePlan = { ...basePlan, overrideAddingLimitations: true };
      vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue(overridePlan);
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(100);

      const result = await service.checkLimit("org-123", "workflows");

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0); // Override returns 0 for current
      expect(mockRepository.getWorkflowCount).not.toHaveBeenCalled();
    });

    it("passes user to plan provider for resolution", async () => {
      const user = { id: "user-123", email: "test@example.com", name: "Test" };

      await service.checkLimit("org-123", "workflows", user);

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
        { type: "workflows", repoMethod: "getWorkflowCount", planField: "maxWorkflows" },
        { type: "prompts", repoMethod: "getPromptCount", planField: "maxPrompts" },
        { type: "evaluators", repoMethod: "getEvaluatorCount", planField: "maxEvaluators" },
        { type: "scenarios", repoMethod: "getActiveScenarioCount", planField: "maxScenarios" },
        { type: "projects", repoMethod: "getProjectCount", planField: "maxProjects" },
        { type: "members", repoMethod: "getMemberCount", planField: "maxMembers" },
        { type: "teams", repoMethod: "getTeamCount", planField: "maxTeams" },
        { type: "membersLite", repoMethod: "getMembersLiteCount", planField: "maxMembersLite" },
        { type: "agents", repoMethod: "getAgentCount", planField: "maxAgents" },
        { type: "experiments", repoMethod: "getExperimentCount", planField: "maxExperiments" },
        { type: "onlineEvaluations", repoMethod: "getOnlineEvaluationCount", planField: "maxOnlineEvaluations" },
        { type: "datasets", repoMethod: "getDatasetCount", planField: "maxDatasets" },
        { type: "dashboards", repoMethod: "getDashboardCount", planField: "maxDashboards" },
        { type: "customGraphs", repoMethod: "getCustomGraphCount", planField: "maxCustomGraphs" },
        { type: "automations", repoMethod: "getAutomationCount", planField: "maxAutomations" },
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
    /** @scenario Allows workflow creation when under limit */
    it("does not throw when limit is not exceeded", async () => {
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(2);

      await expect(
        service.enforceLimit("org-123", "workflows")
      ).resolves.toBeUndefined();
    });

    /** @scenario Blocks workflow creation when at limit */
    it("throws LimitExceededError when limit is reached", async () => {
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(3);

      await expect(service.enforceLimit("org-123", "workflows")).rejects.toThrow(
        LimitExceededError
      );
    });

    /** @scenario Blocks prompt creation when at limit */
    it("includes current, max, and prompts label in LimitExceededError", async () => {
      vi.mocked(mockRepository.getPromptCount).mockResolvedValue(5);

      try {
        await service.enforceLimit("org-123", "prompts");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(LimitExceededError);
        const limitError = error as LimitExceededError;
        expect(limitError.limitType).toBe("prompts");
        expect(limitError.current).toBe(5);
        expect(limitError.max).toBe(5);
        expect(limitError.message).toContain("maximum number of prompts");
      }
    });

    it("passes user to checkLimit for plan resolution", async () => {
      const user = { id: "user-123", email: "test@example.com", name: "Test" };
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(0);

      await service.enforceLimit("org-123", "workflows", user);

      expect(mockPlanProvider.getActivePlan).toHaveBeenCalledWith({
        organizationId: "org-123",
        user: expect.objectContaining({ id: "user-123" }),
      });
    });

    it("does not throw when overrideAddingLimitations is set", async () => {
      const overridePlan = { ...basePlan, overrideAddingLimitations: true };
      vi.mocked(mockPlanProvider.getActivePlan).mockResolvedValue(overridePlan);
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(1000);

      await expect(
        service.enforceLimit("org-123", "workflows")
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
      vi.mocked(mockRepository.getWorkflowCount).mockResolvedValue(0);

      await expect(
        service.enforceLimitByOrganization({
          organizationId: "org-123",
          limitType: "workflows",
        })
      ).resolves.toBeUndefined();
    });
  });
});

describe("LicenseEnforcementService — limit resolution (ADR-039)", () => {
  const seatPlan: PlanInfo = {
    planSource: "subscription",
    type: "GROWTH_SEAT_EUR_MONTHLY",
    name: "Growth",
    free: false,
    billing: {
      meterUnit: "events",
      memberPolicy: "purchase_seat",
      showUsageLimits: false,
      isLegacyTiered: false,
    },
    maxMembers: 6,
    maxMembersLite: 9999,
    maxTeams: 9999,
    maxProjects: 99,
    maxMessagesPerMonth: 999999999,
    maxWorkflows: 9999,
    maxPrompts: 9999,
    maxEvaluators: 9999,
    maxScenarios: 9999,
    maxAgents: 9999,
    maxExperiments: 9999,
    maxOnlineEvaluations: 9999,
    maxDatasets: 9999,
    maxDashboards: 9999,
    maxCustomGraphs: 9999,
    maxAutomations: 9999,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };

  function makeService({ plan, memberCount }: { plan: PlanInfo; memberCount: number }) {
    const repository = {
      getMemberCount: vi.fn().mockResolvedValue(memberCount),
      getMembersLiteCount: vi.fn().mockResolvedValue(0),
      getWorkflowCount: vi.fn().mockResolvedValue(0),
      getPromptCount: vi.fn().mockResolvedValue(0),
      getEvaluatorCount: vi.fn().mockResolvedValue(0),
      getActiveScenarioCount: vi.fn().mockResolvedValue(0),
      getAgentCount: vi.fn().mockResolvedValue(0),
      getExperimentCount: vi.fn().mockResolvedValue(0),
      getOnlineEvaluationCount: vi.fn().mockResolvedValue(0),
      getDatasetCount: vi.fn().mockResolvedValue(0),
      getDashboardCount: vi.fn().mockResolvedValue(0),
      getCustomGraphCount: vi.fn().mockResolvedValue(0),
      getAutomationCount: vi.fn().mockResolvedValue(0),
      getProjectCount: vi.fn().mockResolvedValue(0),
      getTeamCount: vi.fn().mockResolvedValue(0),
      getCurrentMonthCost: vi.fn().mockResolvedValue(0),
      getCurrentMonthCostForProjects: vi.fn().mockResolvedValue(0),
    } as unknown as ILicenseEnforcementRepository;
    return new LicenseEnforcementService(repository, {
      getActivePlan: vi.fn().mockResolvedValue(plan),
    });
  }

  describe("when a seat-billed org hits its member cap", () => {
    /** @scenario Admin invite denial carries the resolution */
    it("returns resolution purchase_seat on the members check", async () => {
      const service = makeService({ plan: seatPlan, memberCount: 6 });

      const result = await service.checkLimit("org-1", "members");

      expect(result.allowed).toBe(false);
      expect(result.resolution).toBe("purchase_seat");
    });

    it("throws LimitExceededError carrying the resolution", async () => {
      const service = makeService({ plan: seatPlan, memberCount: 6 });

      await expect(
        service.enforceLimit("org-1", "members"),
      ).rejects.toMatchObject({ resolution: "purchase_seat" });
    });
  });

  describe("when a non-member limit is hit", () => {
    it("resolves upgrade regardless of the billing profile", async () => {
      const service = makeService({ plan: seatPlan, memberCount: 0 });

      const result = await service.checkLimit("org-1", "workflows");

      expect(result.resolution).toBe("upgrade");
    });
  });

  describe("when the plan has no billing profile (raw plan literal)", () => {
    it("defaults the members resolution to upgrade", async () => {
      const service = makeService({
        plan: { ...seatPlan, billing: undefined },
        memberCount: 6,
      });

      const result = await service.checkLimit("org-1", "members");

      expect(result.resolution).toBe("upgrade");
    });
  });
});
