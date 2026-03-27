import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRepository } from "~/server/repositories/organization.repository";
import {
  clearMonthCountCache,
  TraceUsageService,
} from "../trace-usage.service";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockIsClickHouseEnabled,
  mockGetClickHouseClientForProject,
  mockQueryTraceSummariesTotalUniq,
} = vi.hoisted(() => ({
  mockIsClickHouseEnabled: vi.fn(),
  mockGetClickHouseClientForProject: vi.fn(),
  mockQueryTraceSummariesTotalUniq: vi.fn(),
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  isClickHouseEnabled: mockIsClickHouseEnabled,
  getClickHouseClientForProject: mockGetClickHouseClientForProject,
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
    // Default: no ClickHouse (ES path) — pass false so splitProjectsByFlag returns early
    mockIsClickHouseEnabled.mockReturnValue(false);
    mockGetClickHouseClientForProject.mockResolvedValue(null);
    service = new TraceUsageService(
      mockOrganizationRepository,
      mockEsClientFactory,
      mockPrisma as any,
      false,
    );
  });

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
        mockIsClickHouseEnabled.mockReturnValue(true); // ClickHouse available
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
        mockIsClickHouseEnabled.mockReturnValue(true); // ClickHouse available
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
