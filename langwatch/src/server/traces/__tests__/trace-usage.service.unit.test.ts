import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationRepository } from "~/server/repositories/organization.repository";
import { TraceUsageService } from "../trace-usage.service";

const { mockQueryTraceSummariesTotalUniq } = vi.hoisted(() => ({
  mockQueryTraceSummariesTotalUniq: vi.fn(),
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

  let service: TraceUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TraceUsageService(mockOrganizationRepository);
  });

  describe("getCurrentMonthCount", () => {
    beforeEach(() => {
      vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
        "proj-1",
      ]);
    });

    it("queries ClickHouse for trace summaries total", async () => {
      mockQueryTraceSummariesTotalUniq.mockResolvedValue(500);

      const result = await service.getCurrentMonthCount({
        organizationId: "org-ch-total-1",
      });

      expect(result).toBe(500);
      expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalledWith({
        projectIds: ["proj-1"],
        billingMonth: "2026-02",
      });
    });

    describe("when result is cached", () => {
      it("returns cached value without querying ClickHouse", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(300);

        // First call populates cache
        await service.getCurrentMonthCount({
          organizationId: "org-ch-cache-1",
        });

        // Second call uses cache
        const result = await service.getCurrentMonthCount({
          organizationId: "org-ch-cache-1",
        });

        expect(result).toBe(300);
        expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalledTimes(1);
      });
    });

    describe("when queryTraceSummariesTotalUniq returns null (ClickHouse unavailable)", () => {
      it("fails open with 0", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(null);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-ch-null-1",
        });

        expect(result).toBe(0);
      });

      it("does not cache the failure-derived zero", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(null);
        await service.getCurrentMonthCount({
          organizationId: "org-ch-null-nocache-1",
        });

        // ClickHouse recovers: the next call must re-query instead of
        // serving a cached 0 for the remainder of the 5-minute TTL.
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(700);
        const result = await service.getCurrentMonthCount({
          organizationId: "org-ch-null-nocache-1",
        });

        expect(result).toBe(700);
        expect(mockQueryTraceSummariesTotalUniq).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("getCountByProjects", () => {
    beforeEach(() => {
      vi.mocked(mockOrganizationRepository.getProjectIds).mockResolvedValue([
        "proj-1",
        "proj-2",
      ]);
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

    describe("when queryTraceSummariesTotalUniq returns null (ClickHouse unavailable)", () => {
      it("fails open with count 0 for the project", async () => {
        mockQueryTraceSummariesTotalUniq.mockResolvedValue(null);

        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: ["proj-1"],
        });

        expect(result).toEqual([{ projectId: "proj-1", count: 0 }]);
      });
    });

    describe("when projectIds is empty", () => {
      it("returns empty array without touching the repository", async () => {
        const result = await service.getCountByProjects({
          organizationId: "org-123",
          projectIds: [],
        });

        expect(result).toEqual([]);
        expect(mockOrganizationRepository.getProjectIds).not.toHaveBeenCalled();
      });
    });

    describe("when a projectId does not belong to the organization", () => {
      it("throws without querying ClickHouse", async () => {
        await expect(
          service.getCountByProjects({
            organizationId: "org-123",
            projectIds: ["proj-1", "proj-other-org"],
          }),
        ).rejects.toThrow(
          "getCountByProjects: projectIds [proj-other-org] do not belong to organization org-123",
        );
        expect(mockQueryTraceSummariesTotalUniq).not.toHaveBeenCalled();
      });
    });
  });
});
