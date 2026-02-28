import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRepository } from "~/server/repositories/organization.repository";
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
  mockQueryBillableEventsTotalUniq,
  mockQueryTraceSummariesTotalUniq,
  mockQueryBillableEventsByProjectApprox,
} = vi.hoisted(() => ({
  mockGetClickHouseClient: vi.fn(),
  mockQueryBillableEventsTotalUniq: vi.fn(),
  mockQueryTraceSummariesTotalUniq: vi.fn(),
  mockQueryBillableEventsByProjectApprox: vi.fn(),
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
  queryBillableEventsTotalUniq: mockQueryBillableEventsTotalUniq,
  queryTraceSummariesTotalUniq: mockQueryTraceSummariesTotalUniq,
  queryBillableEventsByProjectApprox: mockQueryBillableEventsByProjectApprox,
  getBillingMonth: vi.fn(() => "2026-02"),
}));

describe("TraceUsageService", () => {
  const mockOrganizationRepository = {
    getOrganizationIdByTeamId: vi.fn(),
    getProjectIds: vi.fn(),
    getPricingModel: vi.fn(),
  } as unknown as OrganizationRepository;

  const mockEsClient = {
    count: vi.fn(),
  };

  const mockEsClientFactory = vi.fn().mockResolvedValue(mockEsClient);

  const mockSubscriptionHandler = {
    getActivePlan: vi.fn(),
  };

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
    // Default: no ClickHouse (ES path), TIERED pricing
    mockGetClickHouseClient.mockReturnValue(null);
    vi.mocked(mockOrganizationRepository.getPricingModel).mockResolvedValue(
      "TIERED",
    );
    service = new TraceUsageService(
      mockOrganizationRepository,
      mockEsClientFactory,
      mockSubscriptionHandler as any,
      mockPrisma as any,
      mockClickHouseClient as any,
    );
  });

  // ==========================================================================
  // checkLimit
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
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({
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
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({
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
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({ ...FREE_PLAN });

        const result = await service.checkLimit({ teamId: "team-123" });

        expect(result.exceeded).toBe(false);

        vi.mocked(env).IS_SAAS = true;
      });

      it("enforces limits for non-FREE plan types", async () => {
        const { env } = await import("~/env.mjs");
        vi.mocked(env).IS_SAAS = false;
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({
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
        mockSubscriptionHandler.getActivePlan.mockResolvedValue({
          name: "pro",
          maxMessagesPerMonth: 10000,
        });
      });

      describe("when pricing model is TIERED", () => {
        beforeEach(() => {
          vi.mocked(
            mockOrganizationRepository.getPricingModel,
          ).mockResolvedValue("TIERED");
        });

        it("uses trace summaries for count", async () => {
          mockQueryTraceSummariesTotalUniq.mockResolvedValue(500);

          const result = await service.checkLimit({ teamId: "team-123" });

          expect(result.exceeded).toBe(false);
          expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalled();
          expect(mockQueryBillableEventsTotalUniq).not.toHaveBeenCalled();
        });
      });

      describe("when pricing model is SEAT_EVENT", () => {
        beforeEach(() => {
          vi.mocked(
            mockOrganizationRepository.getPricingModel,
          ).mockResolvedValue("SEAT_EVENT");
        });

        it("uses billable events for count", async () => {
          mockQueryBillableEventsTotalUniq.mockResolvedValue(500);

          const result = await service.checkLimit({ teamId: "team-123" });

          expect(result.exceeded).toBe(false);
          expect(mockQueryBillableEventsTotalUniq).toHaveBeenCalled();
          expect(mockQueryTraceSummariesTotalUniq).not.toHaveBeenCalled();
        });
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
          // getProjectIds called once for count and once for getPricingModel resolution path,
          // but cache prevents second full query
          expect(mockEsClient.count).toHaveBeenCalledTimes(1);
        });
      });
    });

    // ========================================================================
    // ClickHouse path
    // ========================================================================

    describe("when ClickHouse is available", () => {
      beforeEach(() => {
        mockGetClickHouseClient.mockReturnValue({}); // truthy value
      });

      describe("when pricing model is TIERED", () => {
        beforeEach(() => {
          vi.mocked(
            mockOrganizationRepository.getPricingModel,
          ).mockResolvedValue("TIERED");
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

        it("does not query billable events", async () => {
          mockQueryTraceSummariesTotalUniq.mockResolvedValue(200);

          await service.getCurrentMonthCount({ organizationId: "org-123" });

          expect(mockQueryBillableEventsTotalUniq).not.toHaveBeenCalled();
        });

        it("does not query ES", async () => {
          mockQueryTraceSummariesTotalUniq.mockResolvedValue(200);

          await service.getCurrentMonthCount({ organizationId: "org-123" });

          expect(mockEsClientFactory).not.toHaveBeenCalled();
        });
      });

      describe("when pricing model is SEAT_EVENT", () => {
        beforeEach(() => {
          vi.mocked(
            mockOrganizationRepository.getPricingModel,
          ).mockResolvedValue("SEAT_EVENT");
        });

        it("queries ClickHouse for billable events total", async () => {
          mockQueryBillableEventsTotalUniq.mockResolvedValue(500);

          const result = await service.getCurrentMonthCount({
            organizationId: "org-123",
          });

          expect(result).toBe(500);
          expect(mockQueryBillableEventsTotalUniq).toHaveBeenCalledWith({
            organizationId: "org-123",
            billingMonth: "2026-02",
          });
        });

        it("returns 0 when queryBillableEventsTotalUniq returns null", async () => {
          mockQueryBillableEventsTotalUniq.mockResolvedValue(null);

          const result = await service.getCurrentMonthCount({
            organizationId: "org-123",
          });

          expect(result).toBe(0);
        });

        it("does not query trace summaries", async () => {
          mockQueryBillableEventsTotalUniq.mockResolvedValue(200);

          await service.getCurrentMonthCount({ organizationId: "org-123" });

          expect(mockQueryTraceSummariesTotalUniq).not.toHaveBeenCalled();
        });

        it("does not query ES or project IDs", async () => {
          mockQueryBillableEventsTotalUniq.mockResolvedValue(200);

          await service.getCurrentMonthCount({ organizationId: "org-123" });

          expect(mockEsClientFactory).not.toHaveBeenCalled();
        });
      });

      describe("when result is cached", () => {
        it("returns cached value without querying ClickHouse", async () => {
          vi.mocked(
            mockOrganizationRepository.getProjectIds,
          ).mockResolvedValue(["proj-1"]);
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
  // getCountByProjects
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

      describe("when pricing model is SEAT_EVENT", () => {
        beforeEach(() => {
          vi.mocked(
            mockOrganizationRepository.getPricingModel,
          ).mockResolvedValue("SEAT_EVENT");
        });

        it("queries ClickHouse for billable events by project", async () => {
          mockQueryBillableEventsByProjectApprox.mockResolvedValue([
            { projectId: "proj-1", count: 100 },
            { projectId: "proj-2", count: 200 },
          ]);

          const result = await service.getCountByProjects({
            organizationId: "org-123",
            projectIds: ["proj-1", "proj-2"],
          });

          expect(result).toEqual([
            { projectId: "proj-1", count: 100 },
            { projectId: "proj-2", count: 200 },
          ]);
          expect(mockQueryBillableEventsByProjectApprox).toHaveBeenCalledWith({
            organizationId: "org-123",
            billingMonth: "2026-02",
          });
        });

        it("returns 0 for projects not found in ClickHouse results", async () => {
          mockQueryBillableEventsByProjectApprox.mockResolvedValue([
            { projectId: "proj-1", count: 100 },
          ]);

          const result = await service.getCountByProjects({
            organizationId: "org-123",
            projectIds: ["proj-1", "proj-2"],
          });

          expect(result).toEqual([
            { projectId: "proj-1", count: 100 },
            { projectId: "proj-2", count: 0 },
          ]);
        });

        it("does not query ES", async () => {
          mockQueryBillableEventsByProjectApprox.mockResolvedValue([]);

          await service.getCountByProjects({
            organizationId: "org-123",
            projectIds: ["proj-1"],
          });

          expect(mockEsClientFactory).not.toHaveBeenCalled();
        });

        it("does not query trace summaries", async () => {
          mockQueryBillableEventsByProjectApprox.mockResolvedValue([]);

          await service.getCountByProjects({
            organizationId: "org-123",
            projectIds: ["proj-1"],
          });

          expect(mockQueryTraceSummariesTotalUniq).not.toHaveBeenCalled();
        });
      });

      describe("when pricing model is TIERED", () => {
        beforeEach(() => {
          vi.mocked(
            mockOrganizationRepository.getPricingModel,
          ).mockResolvedValue("TIERED");
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

        it("does not query billable events", async () => {
          mockQueryTraceSummariesTotalUniq.mockResolvedValue(50);

          await service.getCountByProjects({
            organizationId: "org-123",
            projectIds: ["proj-1"],
          });

          expect(mockQueryBillableEventsByProjectApprox).not.toHaveBeenCalled();
        });

        it("does not query ES", async () => {
          mockQueryTraceSummariesTotalUniq.mockResolvedValue(50);

          await service.getCountByProjects({
            organizationId: "org-123",
            projectIds: ["proj-1"],
          });

          expect(mockEsClientFactory).not.toHaveBeenCalled();
        });
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
