import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRepository } from "~/server/repositories/organization.repository";
import type { PlanResolver } from "~/server/app-layer/subscription/plan-provider";
import {
  clearMonthCountCache,
  TraceUsageService,
} from "../trace-usage.service";
import { FREE_PLAN } from "../../../../ee/licensing/constants";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetClickHouseClient,
  mockQueryTraceSummariesTotalUniq,
} = vi.hoisted(() => ({
  mockGetClickHouseClient: vi.fn(),
  mockQueryTraceSummariesTotalUniq: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: true,
  },
}));

vi.mock("~/server/clickhouse/client", () => ({
  getClickHouseClient: mockGetClickHouseClient,
}));

vi.mock("../../../../ee/billing/services/billableEventsQuery", () => ({
  queryTraceSummariesTotalUniq: mockQueryTraceSummariesTotalUniq,
  getBillingMonth: vi.fn(() => "2026-02"),
}));

describe("TraceUsageService", () => {
  const mockOrganizationRepository = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
  } as unknown as OrganizationRepository;

  const mockEsClient = {
    count: vi.fn(),
  };

  const mockEsClientFactory = vi.fn().mockResolvedValue(mockEsClient);

  const mockPlanResolver = vi.fn() as unknown as PlanResolver;

  const mockPrisma = {
    project: {
      findMany: vi.fn(),
    },
  };

  const mockClickHouseClient = {
    query: vi.fn(),
  };

  let service: TraceUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    clearMonthCountCache();
    // Default: no ClickHouse (ES path)
    mockGetClickHouseClient.mockReturnValue(null);
    service = new TraceUsageService(
      mockOrganizationRepository,
      mockEsClientFactory,
      mockPlanResolver,
      mockPrisma as any,
      mockClickHouseClient as any,
    );
  });

  // ==========================================================================
  // checkLimit (deprecated — kept for backward compatibility)
  // ==========================================================================

  describe("checkLimit", () => {
    describe("when organizationId is not found", () => {
      it("throws an error", async () => {
        vi.mocked(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue(null);

        await expect(
          service.checkLimit({ teamId: "team-123" }),
        ).rejects.toThrow("Team team-123 has no organization");
      });
    });

    describe("when count >= maxMessagesPerMonth", () => {
      beforeEach(() => {
        vi.mocked(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockPrisma.project.findMany.mockResolvedValue([
          { id: "proj-1", featureClickHouseDataSourceTraces: false },
        ]);
        mockEsClient.count.mockResolvedValue({ count: 1000 });
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          name: "free",
          maxMessagesPerMonth: 1000,
        });
      });

      it("returns exceeded: true", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });
        expect(result.exceeded).toBe(true);
      });

      it("returns message 'Monthly limit of 1000 traces reached'", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });
        expect(result.message).toBe("Monthly limit of 1000 traces reached");
      });

      it("returns count and maxMessagesPerMonth as 1000", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });
        expect(result.count).toBe(1000);
        expect(result.maxMessagesPerMonth).toBe(1000);
      });

      it("returns planName as 'free'", async () => {
        const result = await service.checkLimit({ teamId: "team-123" });
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
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockPrisma.project.findMany.mockResolvedValue([
          { id: "proj-1", featureClickHouseDataSourceTraces: false },
        ]);
        mockEsClient.count.mockResolvedValue({ count: 500 });
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          maxMessagesPerMonth: 1000,
        });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
      });
    });

    describe("when self-hosted (IS_SAAS=false)", () => {
      beforeEach(() => {
        vi.mocked(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        mockPrisma.project.findMany.mockResolvedValue([
          { id: "proj-1", featureClickHouseDataSourceTraces: false },
        ]);
        mockEsClient.count.mockResolvedValue({ count: 5000 }); // Over any limit
      });

      it("returns exceeded: false for a FREE plan clone", async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = false;
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({ ...FREE_PLAN });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);

        vi.mocked(env).IS_SAAS = true;
      });

      it("enforces limits for non-FREE plan types", async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = false;
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          type: "PRO",
          name: "Pro",
          maxMessagesPerMonth: 1000,
        });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(true);

        vi.mocked(env).IS_SAAS = true;
      });
    });

    describe("when ClickHouse is available", () => {
      beforeEach(() => {
        mockGetClickHouseClient.mockReturnValue({});
        vi.mocked(
          mockOrganizationRepository.getOrganizationIdByTeamId,
        ).mockResolvedValue("org-123");
        vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
          "proj-1",
        ]);
        (mockPlanResolver as ReturnType<typeof vi.fn>).mockResolvedValue({
          name: "pro",
          maxMessagesPerMonth: 10000,
        });
      });

      it("uses trace summaries for count (traces-only)", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(500);

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);
        expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // ES path (no ClickHouse)
  // ==========================================================================

  describe("getCurrentMonthCount", () => {
    describe("when ClickHouse is not available (ES path)", () => {
      describe("when organization has no projects", () => {
        it("returns 0 without querying ES", async () => {
          vi.mocked(
            mockOrganizationRepository.getProjectIds,
          ).mockResolvedValue([]);

          const result = await service.getCurrentMonthCount({
            organizationId: "org-123",
          });

          expect(result).toBe(0);
          expect(mockEsClientFactory).not.toHaveBeenCalled();
        });
      });

      describe("when organization has projects", () => {
        it("sums counts from all projects", async () => {
          vi.mocked(
            mockOrganizationRepository.getProjectIds,
          ).mockResolvedValue(["proj-1", "proj-2"]);
          mockEsClient.count.mockResolvedValue({ count: 42 });

          const result = await service.getCurrentMonthCount({
            organizationId: "org-123",
          });

          expect(result).toBe(84); // 42 per project * 2 projects
          expect(mockEsClientFactory).toHaveBeenCalledWith({
            organizationId: "org-123",
          });
        });
      });

      describe("when result is cached", () => {
        it("returns cached value without querying ES", async () => {
          vi.mocked(
            mockOrganizationRepository.getProjectIds,
          ).mockResolvedValue(["proj-1"]);
          mockEsClient.count.mockResolvedValue({ count: 100 });

          // First call populates cache
          await service.getCurrentMonthCount({ organizationId: "org-123" });

          // Second call uses cache
          const result = await service.getCurrentMonthCount({
            organizationId: "org-123",
          });

          expect(result).toBe(100);
          expect(mockEsClient.count).toHaveBeenCalledTimes(1);
        });
      });
    });

    // ========================================================================
    // ClickHouse path (traces-only)
    // ========================================================================

    describe("when ClickHouse is available", () => {
      beforeEach(() => {
        mockGetClickHouseClient.mockReturnValue({}); // truthy value
        vi.mocked(
          mockOrganizationRepository.getProjectIds,
        ).mockResolvedValue(["proj-1"]);
      });

      it("queries ClickHouse for trace summaries total", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(500);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(500);
        expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalledWith({
          projectIds: ["proj-1"],
          billingMonth: "2026-02",
        });
      });

      it("returns 0 when queryTraceSummariesTotalUniq returns null", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(null);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-123",
        });

        expect(result).toBe(0);
      });

      it("does not query ES when CH returns a result", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(200);

        await service.getCurrentMonthCount({ organizationId: "org-123" });

        expect(mockEsClientFactory).not.toHaveBeenCalled();
      });

      describe("when result is cached", () => {
        it("returns cached value without querying ClickHouse", async () => {
          mockQueryTraceSummariesTotalUniq.mockResolvedValue(300);

          // First call populates cache
          await service.getCurrentMonthCount({ organizationId: "org-123" });

          // Second call uses cache
          const result = await service.getCurrentMonthCount({
            organizationId: "org-123",
          });

          expect(result).toBe(300);
          expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  // ==========================================================================
  // getCountByProjects (traces-only)
  // ==========================================================================

  describe("getCountByProjects", () => {
    describe("when ClickHouse is not available (ES path)", () => {
      it("queries ES for each project", async () => {
        mockPrisma.project.findMany.mockResolvedValue([
          { id: "proj-1", featureClickHouseDataSourceTraces: false },
          { id: "proj-2", featureClickHouseDataSourceTraces: false },
        ]);
        mockEsClient.count.mockResolvedValue({ count: 10 });

        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: ["proj-1", "proj-2"],
        });

        expect(result).toEqual([
          { projectId: "proj-1", count: 10 },
          { projectId: "proj-2", count: 10 },
        ]);
        expect(mockEsClient.count).toHaveBeenCalledTimes(2);
      });
    });

    describe("when ClickHouse is available", () => {
      beforeEach(() => {
        mockGetClickHouseClient.mockReturnValue({}); // truthy value
      });

      it("queries trace summaries per project", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(50);

        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: ["proj-1", "proj-2"],
        });

        expect(result).toEqual([
          { projectId: "proj-1", count: 50 },
          { projectId: "proj-2", count: 50 },
        ]);
        expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalledWith({
          projectIds: ["proj-1"],
          billingMonth: "2026-02",
        });
        expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalledWith({
          projectIds: ["proj-2"],
          billingMonth: "2026-02",
        });
      });

      it("returns 0 when queryTraceSummariesTotalUniq returns null", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(null);

        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: ["proj-1"],
        });

        expect(result).toEqual([{ projectId: "proj-1", count: 0 }]);
      });

      it("does not query ES when CH returns results", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(50);

        await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: ["proj-1"],
        });

        expect(mockEsClientFactory).not.toHaveBeenCalled();
      });
    });

    describe("when projectIds is empty", () => {
      it("returns empty array", async () => {
        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: [],
        });

        expect(result).toEqual([]);
      });
    });
  });
});
