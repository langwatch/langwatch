import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingMonthDateRange,
  queryTraceSummariesTotalUniq,
} from "../billableEventsQuery";

const { mockClickHouseForProject } = vi.hoisted(() => ({
  mockClickHouseForProject: vi.fn(),
}));

vi.mock("~/server/app-layer/clients/clickhouse/tenant-resolver", () => ({
  clickHouseForProject: mockClickHouseForProject,
  clickHouseForOrganization: vi.fn(),
}));

describe("billingMonthDateRange", () => {
  describe("when given a mid-year billing month", () => {
    it("returns the first instant of the month and of the next month", () => {
      expect(billingMonthDateRange("2026-07")).toEqual([
        "2026-07-01 00:00:00.000",
        "2026-08-01 00:00:00.000",
      ]);
    });
  });

  describe("when given December", () => {
    it("rolls the end date over to January of the next year", () => {
      expect(billingMonthDateRange("2026-12")).toEqual([
        "2026-12-01 00:00:00.000",
        "2027-01-01 00:00:00.000",
      ]);
    });
  });

  describe("when checking the range shape", () => {
    it("produces a half-open range ending exactly at the next month boundary", () => {
      const [start, end] = billingMonthDateRange("2026-01");
      expect(start).toBe("2026-01-01 00:00:00.000");
      // End is the *exclusive* boundary — the first millisecond of February,
      // to be used with `< endDate`, never `<=`.
      expect(end).toBe("2026-02-01 00:00:00.000");
    });
  });
});

describe("queryTraceSummariesTotalUniq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when a ClickHouse client is available", () => {
    it("queries with tenant-scoped and month-bounded params and parses the total", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ total: "42" }]);
      mockClickHouseForProject.mockResolvedValue({
        query: mockQuery,
      });

      const result = await queryTraceSummariesTotalUniq({
        projectIds: ["proj-1", "proj-2"],
        billingMonth: "2026-02",
      });

      expect(result).toBe(42);
      expect(mockClickHouseForProject).toHaveBeenCalledWith("proj-1");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            tenantIds: ["proj-1", "proj-2"],
            startDate: "2026-02-01 00:00:00.000",
            endDate: "2026-03-01 00:00:00.000",
          },
        }),
      );
      const sql = (mockQuery.mock.calls[0]?.[0] as { sql: string }).sql;
      expect(sql).toContain("TenantId IN {tenantIds:Array(String)}");
    });
  });

  describe("when no ClickHouse client is available", () => {
    it("returns null so callers can distinguish outage from zero usage", async () => {
      mockClickHouseForProject.mockResolvedValue(null);

      const result = await queryTraceSummariesTotalUniq({
        projectIds: ["proj-1"],
        billingMonth: "2026-02",
      });

      expect(result).toBeNull();
    });
  });

  describe("when projectIds is empty", () => {
    it("returns 0 without resolving a client", async () => {
      const result = await queryTraceSummariesTotalUniq({
        projectIds: [],
        billingMonth: "2026-02",
      });

      expect(result).toBe(0);
      expect(mockClickHouseForProject).not.toHaveBeenCalled();
    });
  });
});
