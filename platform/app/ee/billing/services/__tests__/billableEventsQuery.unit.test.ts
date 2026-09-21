import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  billingMonthDateRange,
  queryTraceSummariesTotalUniq,
} from "../billableEventsQuery";

const { findTraceSummariesTotalUniq } = vi.hoisted(() => ({
  findTraceSummariesTotalUniq: vi.fn(),
}));

// The query functions take the repository from the App, so standing in for
// the store means standing in for `getApp()`.
let billableEvents:
  | { findTraceSummariesTotalUniq: typeof findTraceSummariesTotalUniq }
  | undefined;
vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    billableEvents,
  }),
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
    billableEvents = { findTraceSummariesTotalUniq };
  });

  describe("when a ClickHouse repository is available", () => {
    it("queries with tenant-scoped and month-bounded params and returns the total", async () => {
      findTraceSummariesTotalUniq.mockResolvedValue(42);

      const result = await queryTraceSummariesTotalUniq({
        projectIds: ["proj-1", "proj-2"],
        billingMonth: "2026-02",
      });

      expect(result).toBe(42);
      expect(findTraceSummariesTotalUniq).toHaveBeenCalledWith({
        tenantIds: ["proj-1", "proj-2"],
        startDate: "2026-02-01 00:00:00.000",
        endDate: "2026-03-01 00:00:00.000",
      });
    });
  });

  describe("when no ClickHouse repository is available", () => {
    it("returns null so callers can distinguish outage from zero usage", async () => {
      billableEvents = undefined;

      const result = await queryTraceSummariesTotalUniq({
        projectIds: ["proj-1"],
        billingMonth: "2026-02",
      });

      expect(result).toBeNull();
    });
  });

  describe("when projectIds is empty", () => {
    it("returns 0 without resolving a repository", async () => {
      const result = await queryTraceSummariesTotalUniq({
        projectIds: [],
        billingMonth: "2026-02",
      });

      expect(result).toBe(0);
      expect(findTraceSummariesTotalUniq).not.toHaveBeenCalled();
    });
  });
});
