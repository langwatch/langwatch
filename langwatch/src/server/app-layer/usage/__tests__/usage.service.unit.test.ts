import { beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "~/server/utils/ttlCache";
import type { PlanResolver } from "../../subscription/plan-provider";
import type { OrganizationService } from "../../organizations/organization.service";
import { UsageService } from "../usage.service";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";

const ENTERPRISE_LICENSE_PLAN: PlanInfo = {
  ...FREE_PLAN,
  planSource: "license",
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  maxMessagesPerMonth: 100_000,
  usageUnit: "events",
};

const PAID_TIERED_PLAN: PlanInfo = {
  ...FREE_PLAN,
  planSource: "subscription",
  type: "TIERED",
  name: "Team",
  free: false,
  maxMessagesPerMonth: 10_000,
};

const { mockRedisStore } = vi.hoisted(() => {
  const mockRedisStore = new Map<string, string>();
  return { mockRedisStore };
});

vi.mock("~/server/redis", () => {
  const fakeRedis = {
    get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    setex: vi.fn(async (_key: string, _ttl: number, value: string) => {
      mockRedisStore.set(_key, value);
    }),
    del: vi.fn(async (key: string) => { mockRedisStore.delete(key); }),
  };
  return { isBuildOrNoRedis: false, connection: fakeRedis };
});

vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

vi.mock("../../../clickhouse/clickhouseClient", () => ({
  isClickHouseEnabled: () => false,
  getClickHouseClientForProject: () => Promise.resolve(null),
}));

const { mockEnv } = vi.hoisted(() => {
  const mockEnv: Record<string, unknown> = {};
  return { mockEnv };
});

vi.mock("~/env.mjs", () => ({
  env: new Proxy(mockEnv, {
    get: (_target, prop) => mockEnv[prop as string],
  }),
}));

describe("UsageService", () => {
  const mockOrgService: OrganizationService = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
  } as unknown as OrganizationService;

  const mockTraceUsageService = {
    getCountByProjects: vi.fn(),
  };

  const mockEventUsageService = {
    getCountByProjects: vi.fn(),
    getCurrentMonthCount: vi.fn(),
  };

  const mockOrgRepo = {
    getPricingModel: vi.fn().mockResolvedValue(null),
  };

  const mockPlanResolver = vi.fn() as unknown as PlanResolver;

  let service: UsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.clear();
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key];
    }
    mockOrgRepo.getPricingModel.mockResolvedValue(null);
    (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...FREE_PLAN,
      maxMessagesPerMonth: 1000,
    });
    service = Object.create(UsageService.prototype);
    Object.assign(service, {
      organizationService: mockOrgService,
      traceUsageService: mockTraceUsageService,
      eventUsageService: mockEventUsageService,
      planResolver: mockPlanResolver,
      organizationRepository: mockOrgRepo,
      countCache: new TtlCache<number>(30_000, "test:"),
      decisionCache: new TtlCache<unknown>(30_000, "test:"),
    });
  });

  describe("checkLimit", () => {
    describe("when team has no organization", () => {
      it("throws OrganizationNotFoundForTeamError", async () => {
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue(null);

        await expect(
          service.checkLimit({ teamId: "team-123" }),
        ).rejects.toThrow("Organization for team not found: team-123");
      });
    });

    describe("when free-tier org exceeds limit on SaaS", () => {
      beforeEach(() => {
        mockEnv.IS_SAAS = true;
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 50_000 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...FREE_PLAN,
          maxMessagesPerMonth: 50_000,
        });
      });

      it("returns message with Free prefix, events unit, and SaaS upgrade URL", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
        expect(result.message).toContain(
          "Free limit of 50000 events reached",
        );
        expect(result.message).toContain(
          "upgrade your plan at https://app.langwatch.ai/settings/subscription",
        );
      });
    });

    describe("when free-tier org exceeds limit on self-hosted", () => {
      beforeEach(() => {
        mockEnv.IS_SAAS = false;
        mockEnv.BASE_HOST = "https://my-langwatch.example.com";
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 50_000 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...FREE_PLAN,
          maxMessagesPerMonth: 50_000,
        });
      });

      it("returns message with Free prefix, events unit, and self-hosted license URL", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
        expect(result.message).toContain(
          "Free limit of 50000 events reached",
        );
        expect(result.message).toContain(
          "buy a license at https://my-langwatch.example.com/settings/license",
        );
      });
    });

    describe("when paid TIERED org exceeds limit on SaaS", () => {
      beforeEach(() => {
        mockEnv.IS_SAAS = true;
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 10_000 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...PAID_TIERED_PLAN,
          maxMessagesPerMonth: 10_000,
        });
      });

      it("returns message with Monthly prefix, traces unit, and SaaS upgrade URL", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
        expect(result.message).toContain(
          "Monthly limit of 10000 traces reached",
        );
        expect(result.message).toContain(
          "upgrade your plan at https://app.langwatch.ai/settings/subscription",
        );
      });
    });

    describe("when paid TIERED org exceeds limit on self-hosted", () => {
      beforeEach(() => {
        mockEnv.IS_SAAS = false;
        mockEnv.BASE_HOST = "https://my-langwatch.example.com";
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 10_000 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...PAID_TIERED_PLAN,
          maxMessagesPerMonth: 10_000,
        });
      });

      it("returns message with Monthly prefix, traces unit, and self-hosted license URL", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
        expect(result.message).toContain(
          "Monthly limit of 10000 traces reached",
        );
        expect(result.message).toContain(
          "buy a license at https://my-langwatch.example.com/settings/license",
        );
      });
    });

    describe("when count >= maxMessagesPerMonth", () => {
      beforeEach(() => {
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        // Free plan resolves to events counter
        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 1000 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...FREE_PLAN,
          maxMessagesPerMonth: 1000,
        });
      });

      it("returns exceeded: true with count and plan details", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
        expect(result.count).toBe(1000);
        expect(result.maxMessagesPerMonth).toBe(1000);
        expect(result.planName).toBe("Free");
      });

      it("calls planResolver with organizationId", async () => {
        await service.checkLimit({ teamId: "team-123" });

        expect(mockPlanResolver).toHaveBeenCalledWith("org-123");
      });
    });

    describe("when count < maxMessagesPerMonth", () => {
      it("returns exceeded: false", async () => {
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        // Free plan resolves to events counter
        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 500 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...FREE_PLAN,
          maxMessagesPerMonth: 1000,
        });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
      });
    });
  });

  describe("getCurrentMonthCount", () => {
    it("delegates to EventUsageService for free plan and sums counts", async () => {
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
        "proj-1",
        "proj-2",
      ]);
      // Free plan (default) resolves to events counter
      mockEventUsageService.getCountByProjects.mockResolvedValue([
        { projectId: "proj-1", count: 42 },
        { projectId: "proj-2", count: 58 },
      ]);

      const result = await service.getCurrentMonthCount({
        organizationId: "org-123",
      });

      expect(result).toBe(100);
      expect(
        mockEventUsageService.getCountByProjects,
      ).toHaveBeenCalledWith({
        organizationId: "org-123",
        projectIds: ["proj-1", "proj-2"],
      });
    });

    it("delegates to TraceUsageService for paid plan and sums counts", async () => {
      (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...PAID_TIERED_PLAN,
      });
      vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
        "proj-1",
        "proj-2",
      ]);
      mockTraceUsageService.getCountByProjects.mockResolvedValue([
        { projectId: "proj-1", count: 42 },
        { projectId: "proj-2", count: 58 },
      ]);

      const result = await service.getCurrentMonthCount({
        organizationId: "org-123",
      });

      expect(result).toBe(100);
      expect(
        mockTraceUsageService.getCountByProjects,
      ).toHaveBeenCalledWith({
        organizationId: "org-123",
        projectIds: ["proj-1", "proj-2"],
      });
    });

    describe("when organization has no projects", () => {
      it("returns 0 without querying any backend", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([]);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(0);
        expect(
          mockTraceUsageService.getCountByProjects,
        ).not.toHaveBeenCalled();
        expect(
          mockEventUsageService.getCountByProjects,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when result is cached", () => {
      it("returns cached value within TTL", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        // Free plan (default) resolves to events counter
        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 42 },
        ]);

        const first = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });
        expect(first).toBe(42);

        const second = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });
        expect(second).toBe(42);

        expect(mockOrgService.getProjectIds).toHaveBeenCalledTimes(1);
      });
    });

    describe("cache key includes usage unit", () => {
      it("caches separately for different meter decisions", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        // Default free plan uses events counter
        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 42 },
        ]);

        // First call with events unit (free plan)
        await service.getCurrentMonthCount({ organizationId: "org-123" });

        // Clear Redis and replace caches to force re-resolution, switch to paid plan (traces unit)
        mockRedisStore.clear();
        (service as any).decisionCache = new TtlCache(30_000, "test:");
        (service as any).countCache = new TtlCache(30_000, "test:");
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...PAID_TIERED_PLAN,
        });
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 200 },
        ]);

        // Different unit (traces), should NOT use cache
        const second = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(second).toBe(200);
        expect(mockOrgService.getProjectIds).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("getCountByProjects", () => {
    describe("when project list is empty", () => {
      it("returns empty array", async () => {
        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: [],
        });

        expect(result).toEqual([]);
      });
    });

    it("delegates to EventUsageService for free plan", async () => {
      // Default plan is FREE_PLAN (free: true) -> events
      mockEventUsageService.getCountByProjects.mockResolvedValue([
        { projectId: "proj-1", count: 10 },
        { projectId: "proj-2", count: 20 },
      ]);

      const result = await service.getCountByProjects({
        organizationId: "org-123",
        projectIds: ["proj-1", "proj-2"],
      });

      expect(result).toEqual([
        { projectId: "proj-1", count: 10 },
        { projectId: "proj-2", count: 20 },
      ]);
      expect(mockEventUsageService.getCountByProjects).toHaveBeenCalled();
      expect(
        mockTraceUsageService.getCountByProjects,
      ).not.toHaveBeenCalled();
    });

    it("delegates to TraceUsageService for paid plan", async () => {
      (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...PAID_TIERED_PLAN,
      });
      mockTraceUsageService.getCountByProjects.mockResolvedValue([
        { projectId: "proj-1", count: 10 },
        { projectId: "proj-2", count: 20 },
      ]);

      const result = await service.getCountByProjects({
        organizationId: "org-123",
        projectIds: ["proj-1", "proj-2"],
      });

      expect(result).toEqual([
        { projectId: "proj-1", count: 10 },
        { projectId: "proj-2", count: 20 },
      ]);
      expect(mockTraceUsageService.getCountByProjects).toHaveBeenCalled();
      expect(
        mockEventUsageService.getCountByProjects,
      ).not.toHaveBeenCalled();
    });

    describe("when meter decision is events", () => {
      beforeEach(() => {
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...ENTERPRISE_LICENSE_PLAN,
        });
      });

      it("delegates to EventUsageService", async () => {
        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 50 },
        ]);

        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: ["proj-1"],
        });

        expect(result).toEqual([{ projectId: "proj-1", count: 50 }]);
        expect(
          mockEventUsageService.getCountByProjects,
        ).toHaveBeenCalledWith({
          organizationId: "org-123",
          projectIds: ["proj-1"],
        });
        expect(
          mockTraceUsageService.getCountByProjects,
        ).not.toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // Meter decision routing
  // ==========================================================================

  describe("meter decision routing", () => {
    describe("when policy resolves to traces (paid plan)", () => {
      beforeEach(() => {
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...PAID_TIERED_PLAN,
        });
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 100 },
        ]);
      });

      it("routes getCurrentMonthCount to trace counter", async () => {
        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(100);
        expect(mockTraceUsageService.getCountByProjects).toHaveBeenCalled();
        expect(
          mockEventUsageService.getCountByProjects,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when policy resolves to events", () => {
      beforeEach(() => {
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...ENTERPRISE_LICENSE_PLAN,
        });
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 200 },
        ]);
      });

      it("routes getCurrentMonthCount to event counter", async () => {
        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(200);
        expect(mockEventUsageService.getCountByProjects).toHaveBeenCalled();
        expect(
          mockTraceUsageService.getCountByProjects,
        ).not.toHaveBeenCalled();
      });
    });
  });
});
