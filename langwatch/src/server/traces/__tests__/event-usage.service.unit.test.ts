import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventUsageService } from "../event-usage.service";

const mockQueryBillableEventsTotalUniq = vi.fn();
const mockQueryBillableEventsByProjectApprox = vi.fn();
const mockGetBillingMonth = vi.fn().mockReturnValue("2026-03");
const mockGetClickHouseClient = vi.fn();

vi.mock("~/server/clickhouse/client", () => ({
  getClickHouseClient: () => mockGetClickHouseClient(),
}));

vi.mock("../../../../ee/billing/services/billableEventsQuery", () => ({
  queryBillableEventsTotalUniq: (...args: unknown[]) =>
    mockQueryBillableEventsTotalUniq(...args),
  queryBillableEventsByProjectApprox: (...args: unknown[]) =>
    mockQueryBillableEventsByProjectApprox(...args),
  getBillingMonth: () => mockGetBillingMonth(),
}));

describe("EventUsageService", () => {
  let service: EventUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClickHouseClient.mockReturnValue({});
    service = new EventUsageService();
  });

  describe("getCurrentMonthCount", () => {
    it("returns billable events total from ClickHouse", async () => {
      mockQueryBillableEventsTotalUniq.mockResolvedValue(42);

      const result = await service.getCurrentMonthCount({
        organizationId: "org-1",
      });

      expect(result).toBe(42);
      expect(mockQueryBillableEventsTotalUniq).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-03",
      });
    });

    it("returns 0 when query returns null", async () => {
      mockQueryBillableEventsTotalUniq.mockResolvedValue(null);

      const result = await service.getCurrentMonthCount({
        organizationId: "org-1",
      });

      expect(result).toBe(0);
    });

    describe("when ClickHouse is unavailable", () => {
      it("returns 0 (fail-open)", async () => {
        mockGetClickHouseClient.mockReturnValue(null);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-1",
        });

        expect(result).toBe(0);
        expect(mockQueryBillableEventsTotalUniq).not.toHaveBeenCalled();
      });
    });
  });

  describe("getCountByProjects", () => {
    it("returns per-project billable event counts", async () => {
      mockQueryBillableEventsByProjectApprox.mockResolvedValue([
        { projectId: "proj-1", count: 10 },
        { projectId: "proj-2", count: 20 },
      ]);

      const result = await service.getCountByProjects({
        organizationId: "org-1",
        projectIds: ["proj-1", "proj-2"],
      });

      expect(result).toEqual([
        { projectId: "proj-1", count: 10 },
        { projectId: "proj-2", count: 20 },
      ]);
    });

    it("returns 0 for projects not in query result", async () => {
      mockQueryBillableEventsByProjectApprox.mockResolvedValue([
        { projectId: "proj-1", count: 10 },
      ]);

      const result = await service.getCountByProjects({
        organizationId: "org-1",
        projectIds: ["proj-1", "proj-2"],
      });

      expect(result).toEqual([
        { projectId: "proj-1", count: 10 },
        { projectId: "proj-2", count: 0 },
      ]);
    });

    it("returns empty array for empty projectIds", async () => {
      const result = await service.getCountByProjects({
        organizationId: "org-1",
        projectIds: [],
      });

      expect(result).toEqual([]);
      expect(
        mockQueryBillableEventsByProjectApprox,
      ).not.toHaveBeenCalled();
    });

    describe("when ClickHouse is unavailable", () => {
      it("returns zeros for all projects (fail-open)", async () => {
        mockGetClickHouseClient.mockReturnValue(null);

        const result = await service.getCountByProjects({
          organizationId: "org-1",
          projectIds: ["proj-1", "proj-2"],
        });

        expect(result).toEqual([
          { projectId: "proj-1", count: 0 },
          { projectId: "proj-2", count: 0 },
        ]);
        expect(
          mockQueryBillableEventsByProjectApprox,
        ).not.toHaveBeenCalled();
      });
    });
  });
});
