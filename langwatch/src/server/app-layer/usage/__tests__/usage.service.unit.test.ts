import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "~/server/utils/ttlCache";
import type { PlanResolver } from "../../subscription/plan-provider";
import type { OrganizationService } from "../../organizations/organization.service";
import { UsageService } from "../usage.service";

vi.mock("~/env.mjs", () => ({
  env: { IS_SAAS: true },
}));

vi.mock("../../tracing", () => ({
  traced: <T>(instance: T) => instance,
}));

vi.mock("../../../clickhouse/client", () => ({
  getClickHouseClient: () => null,
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
    mockOrgRepo.getPricingModel.mockResolvedValue(null);
    (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: "free",
      type: "FREE",
      free: true,
      maxMessagesPerMonth: 1000,
    });
    service = Object.create(UsageService.prototype);
    Object.assign(service, {
      organizationService: mockOrgService,
      traceUsageService: mockTraceUsageService,
      eventUsageService: mockEventUsageService,
      planResolver: mockPlanResolver,
      organizationRepository: mockOrgRepo,
      cache: new TtlCache<number>(30_000),
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

    describe("when count >= maxMessagesPerMonth", () => {
      beforeEach(() => {
        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 1000 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          name: "free",
          type: "FREE",
          free: true,
          maxMessagesPerMonth: 1000,
        });
      });

      it("returns exceeded: true with message", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
        expect(result.message).toBe(
          "Monthly limit of 1000 traces reached",
        );
        expect(result.count).toBe(1000);
        expect(result.maxMessagesPerMonth).toBe(1000);
        expect(result.planName).toBe("free");
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
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 500 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          maxMessagesPerMonth: 1000,
          type: "FREE",
          free: true,
        });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
      });
    });

    describe("when self-hosted (IS_SAAS=false)", () => {
      afterEach(async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = true;
      });

      it("returns exceeded: false for a FREE plan clone", async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = false;

        const { FREE_PLAN } = await import(
          "../../../../../ee/licensing/constants"
        );

        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 5000 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({ ...FREE_PLAN });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
      });

      it("enforces limits for non-FREE plan types", async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = false;

        vi.mocked(
          mockOrgService.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 5000 },
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          type: "PRO",
          name: "Pro",
          free: false,
          maxMessagesPerMonth: 1000,
        });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);
      });
    });
  });

  describe("getCurrentMonthCount", () => {
    it("delegates to TraceUsageService and sums counts", async () => {
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
      });
    });

    describe("when result is cached", () => {
      it("returns cached value within TTL", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 42 },
        ]);

        // First call populates cache
        const first = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });
        expect(first).toBe(42);

        // Second call uses cache
        const second = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });
        expect(second).toBe(42);

        // Only one actual fetch
        expect(mockOrgService.getProjectIds).toHaveBeenCalledTimes(1);
      });
    });

    describe("cache key includes usage unit", () => {
      it("caches separately for different meter decisions", async () => {
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockTraceUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 42 },
        ]);

        // First call with default (traces) unit
        await service.getCurrentMonthCount({ organizationId: "org-123" });

        // Change plan to non-free (license override) with events unit
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          type: "ENTERPRISE",
          free: false,
          maxMessagesPerMonth: 100_000,
          usageUnit: "events",
        });

        mockEventUsageService.getCountByProjects.mockResolvedValue([
          { projectId: "proj-1", count: 99 },
        ]);

        // Second call — different unit, should NOT use cache
        const second = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(second).toBe(99);
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

    it("delegates to TraceUsageService for traces unit", async () => {
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
      expect(mockEventUsageService.getCountByProjects).not.toHaveBeenCalled();
    });

    describe("when meter decision is events", () => {
      beforeEach(() => {
        // License override plan with events unit
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          type: "ENTERPRISE",
          free: false,
          maxMessagesPerMonth: 100_000,
          usageUnit: "events",
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
        expect(mockEventUsageService.getCountByProjects).toHaveBeenCalledWith({
          organizationId: "org-123",
          projectIds: ["proj-1"],
        });
        expect(mockTraceUsageService.getCountByProjects).not.toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // Meter decision routing
  // ==========================================================================

  describe("meter decision routing", () => {
    describe("when policy resolves to traces", () => {
      beforeEach(() => {
        // Default: free plan, TIERED pricing → traces
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
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
        expect(mockEventUsageService.getCountByProjects).not.toHaveBeenCalled();
      });
    });

    describe("when policy resolves to events", () => {
      beforeEach(() => {
        // License override plan with events unit
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          type: "ENTERPRISE",
          free: false,
          maxMessagesPerMonth: 100_000,
          usageUnit: "events",
        });
        vi.mocked(mockOrgService.getProjectIds).mockResolvedValue(["proj-1"]);
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
        expect(mockTraceUsageService.getCountByProjects).not.toHaveBeenCalled();
      });
    });
  });
});
