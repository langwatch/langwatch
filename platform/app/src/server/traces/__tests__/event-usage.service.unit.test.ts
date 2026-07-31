import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventUsageService } from "../event-usage.service";
import { USAGE_UNKNOWN } from "../usage-count";

const mockQueryBillableEventsTotalUniq = vi.fn();
const mockQueryBillableEventsByProjectApprox = vi.fn();
const mockGetBillingMonth = vi.fn().mockReturnValue("2026-03");
const mockIsClickHouseEnabled = vi.fn();

vi.mock("~/server/app-layer/clients/clickhouse/shared", () => ({
  isClickHouseEnabled: () => mockIsClickHouseEnabled(),
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
    mockIsClickHouseEnabled.mockReturnValue(true);
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

    it("reports the count as unknown when the query returns null", async () => {
      // A null total means the query did not run. Answering 0 makes that
      // indistinguishable from an organization that genuinely billed nothing,
      // and every consumer downstream then acts on the wrong one.
      mockQueryBillableEventsTotalUniq.mockResolvedValue(null);

      const result = await service.getCurrentMonthCount({
        organizationId: "org-1",
      });

      expect(result).toBe(USAGE_UNKNOWN);
    });

    describe("when ClickHouse is unavailable", () => {
      it("reports the count as unknown, never 0", async () => {
        // This asserted 0 and called it "fail-open". Letting traffic through
        // during our own outage is still the right call — it is just not this
        // service's call to make, and a fabricated number made it invisibly.
        // UsageService.checkLimit now decides, and logs that it did.
        mockIsClickHouseEnabled.mockReturnValue(false);

        const result = await service.getCurrentMonthCount({
          organizationId: "org-1",
        });

        expect(result).toBe(USAGE_UNKNOWN);
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
      expect(mockQueryBillableEventsByProjectApprox).not.toHaveBeenCalled();
    });

    describe("when ClickHouse is unavailable", () => {
      it("reports the whole set as unknown, not as zeros", async () => {
        mockIsClickHouseEnabled.mockReturnValue(false);

        const result = await service.getCountByProjects({
          organizationId: "org-1",
          projectIds: ["proj-1", "proj-2"],
        });

        // Not a list of zeroed projects: that shape reads as a complete
        // answer, and the usage-limit email built from it would tell an admin
        // every one of their projects had gone quiet.
        expect(result).toBe(USAGE_UNKNOWN);
        expect(mockQueryBillableEventsByProjectApprox).not.toHaveBeenCalled();
      });
    });
  });
});
