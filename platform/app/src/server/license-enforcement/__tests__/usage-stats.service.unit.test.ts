import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFreePlanLimits } from "../../../../ee/billing/planLimits";
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
      getCurrentMonthCost: vi.fn().mockResolvedValue(0),
      getMemberCount: vi.fn().mockResolvedValue(1),
      getMembersLiteCount: vi.fn().mockResolvedValue(0),
      getMembersDeveloperCount: vi.fn().mockResolvedValue(0),
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

      expect(stats.membersCount).toBe(1);
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

  describe("seatLimitInfo", () => {
    const testUser = { id: "user-1", role: "ADMIN" as const };

    const SAAS_FREE_PLAN = getFreePlanLimits();

    const givenPlanAndSeats = ({
      plan,
      members,
      lite,
    }: {
      plan: PlanInfo;
      members: number;
      lite: number;
    }) => {
      mockPlanProvider.getActivePlan = vi.fn().mockResolvedValue(plan);
      mockRepository.getMemberCount = vi.fn().mockResolvedValue(members);
      mockRepository.getMembersLiteCount = vi.fn().mockResolvedValue(lite);
    };

    describe("when a Free organization uses more member seats than the plan includes", () => {
      /** @scenario "Seat usage above the plan's member limit is reported as exceeded" */
      it("reports the seat limit as exceeded with the counts", async () => {
        givenPlanAndSeats({ plan: SAAS_FREE_PLAN, members: 3, lite: 0 });

        const stats = await service.getUsageStats("org-123", testUser);

        expect(stats.seatLimitInfo.status).toBe("exceeded");
        expect(stats.seatLimitInfo.members).toEqual({
          current: 3,
          max: 2,
          exceeded: true,
        });
        expect(stats.seatLimitInfo.message).toBe(
          "Your organization uses 3 member seats and your plan includes 2 member seats.",
        );
      });
    });

    describe("when a Free organization has Lite Members the plan does not include", () => {
      /** @scenario "Seat usage above the plan's Lite Member limit is reported as exceeded" */
      it("reports the seat limit as exceeded", async () => {
        givenPlanAndSeats({ plan: SAAS_FREE_PLAN, members: 1, lite: 2 });

        const stats = await service.getUsageStats("org-123", testUser);

        expect(stats.seatLimitInfo.status).toBe("exceeded");
        expect(stats.seatLimitInfo.membersLite.exceeded).toBe(true);
        expect(stats.seatLimitInfo.members.exceeded).toBe(false);
        expect(stats.seatLimitInfo.message).toBe(
          "Your organization uses 2 Lite Member seats and your plan includes no Lite Member seats.",
        );
      });
    });

    describe("when the organization uses exactly the seats the plan includes", () => {
      /** @scenario "Seat usage within the plan's limits is not reported as exceeded" */
      it("reports the seat limit as ok", async () => {
        givenPlanAndSeats({ plan: SAAS_FREE_PLAN, members: 2, lite: 0 });

        const stats = await service.getUsageStats("org-123", testUser);

        expect(stats.seatLimitInfo.status).toBe("ok");
        expect(stats.seatLimitInfo.message).toBe("");
      });
    });

    describe("when the plan has no member limit", () => {
      /** @scenario "A plan with no member limit never reports the seat limit as exceeded" */
      it("reports the seat limit as ok", async () => {
        givenPlanAndSeats({
          plan: {
            ...TEST_PLAN,
            maxMembers: Number.MAX_SAFE_INTEGER,
            maxMembersLite: Number.MAX_SAFE_INTEGER,
          },
          members: 500,
          lite: 500,
        });

        const stats = await service.getUsageStats("org-123", testUser);

        expect(stats.seatLimitInfo.status).toBe("ok");
      });
    });

    describe("when the plan's limits are overridden", () => {
      it("reports the seat limit as ok", async () => {
        givenPlanAndSeats({
          plan: { ...SAAS_FREE_PLAN, overrideAddingLimitations: true },
          members: 3,
          lite: 0,
        });

        const stats = await service.getUsageStats("org-123", testUser);

        expect(stats.seatLimitInfo.status).toBe("ok");
      });
    });

    describe("when the plan comes from a license", () => {
      /** @scenario "A license plan is left to the license page" */
      it("reports the seat limit as ok", async () => {
        givenPlanAndSeats({
          plan: { ...TEST_PLAN, planSource: "license", maxMembers: 2 },
          members: 5,
          lite: 0,
        });

        const stats = await service.getUsageStats("org-123", testUser);

        expect(stats.seatLimitInfo.status).toBe("ok");
      });
    });
  });
});
