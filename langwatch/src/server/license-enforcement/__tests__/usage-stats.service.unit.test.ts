import { beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_PLAN } from "../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import type { PlanProvider } from "../../app-layer/subscription/plan-provider";
import type { ILicenseEnforcementRepository } from "../license-enforcement.repository";
import {
  type ITraceUsageService,
  type IUsageUnitResolver,
  UsageStatsService,
} from "../usage-stats.service";

const TEST_PLAN: PlanInfo = {
  ...FREE_PLAN,
  planSource: "subscription",
  type: "PRO",
  name: "Pro",
  free: false,
  maxMessagesPerMonth: 10_000,
};

describe("UsageStatsService", () => {
  let service: UsageStatsService;
  let mockRepository: ILicenseEnforcementRepository;
  let mockTraceUsage: ITraceUsageService;
  let mockPlanProvider: PlanProvider;
  let mockUsageUnitResolver: IUsageUnitResolver;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepository = {
      getProjectCount: vi.fn().mockResolvedValue(2),
      getCurrentMonthCost: vi.fn().mockResolvedValue(0),
      getMemberCount: vi.fn().mockResolvedValue(1),
      getMembersLiteCount: vi.fn().mockResolvedValue(0),
      getTeamCount: vi.fn().mockResolvedValue(1),
      getPromptCount: vi.fn().mockResolvedValue(0),
      getWorkflowCount: vi.fn().mockResolvedValue(0),
      getActiveScenarioCount: vi.fn().mockResolvedValue(0),
      getEvaluatorCount: vi.fn().mockResolvedValue(0),
      getAgentCount: vi.fn().mockResolvedValue(0),
      getExperimentCount: vi.fn().mockResolvedValue(0),
    } as unknown as ILicenseEnforcementRepository;

    // Distinct values so the suite fails if getUsageStats regresses to the
    // enforcement counter: display drives the surfaced count, enforcement must
    // not be called.
    mockTraceUsage = {
      getCurrentMonthCount: vi.fn().mockResolvedValue(123),
      getCurrentMonthCountForDisplay: vi.fn().mockResolvedValue(500),
    } as unknown as ITraceUsageService;

    mockPlanProvider = {
      getActivePlan: vi.fn().mockResolvedValue(TEST_PLAN),
    } as unknown as PlanProvider;

    mockUsageUnitResolver = {
      getResolvedUsageUnit: vi.fn().mockResolvedValue("traces"),
    };

    service = new UsageStatsService(
      mockRepository,
      mockTraceUsage,
      mockPlanProvider,
      mockUsageUnitResolver,
    );
  });

  describe("getUsageStats", () => {
    const testUser = { id: "user-1", role: "ADMIN" as const };

    describe("when usage unit resolves to traces", () => {
      it("includes usageUnit as traces in the result", async () => {
        mockUsageUnitResolver.getResolvedUsageUnit = vi
          .fn()
          .mockResolvedValue("traces");

        const stats = await service.getUsageStats("org-123", testUser);

        expect(stats.usageUnit).toBe("traces");
      });
    });

    describe("when usage unit resolves to events", () => {
      it("includes usageUnit as events in the result", async () => {
        mockUsageUnitResolver.getResolvedUsageUnit = vi
          .fn()
          .mockResolvedValue("events");

        const stats = await service.getUsageStats("org-123", testUser);

        expect(stats.usageUnit).toBe("events");
      });
    });

    it("includes all other stats alongside usageUnit", async () => {
      const stats = await service.getUsageStats("org-123", testUser);

      expect(stats.projectsCount).toBe(2);
      expect(stats.currentMonthMessagesCount).toBe(500);
      expect(stats.usageUnit).toBe("traces");
      expect(stats.messageLimitInfo).toBeDefined();
    });

    it("surfaces the display count and never the enforcement counter", async () => {
      await service.getUsageStats("org-123", testUser);

      expect(
        mockTraceUsage.getCurrentMonthCountForDisplay,
      ).toHaveBeenCalledWith({ organizationId: "org-123" });
      expect(mockTraceUsage.getCurrentMonthCount).not.toHaveBeenCalled();
    });
  });
});
