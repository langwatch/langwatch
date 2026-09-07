import { beforeEach, describe, expect, it, vi } from "vitest";
import { type BillableEventsPort, BillableEventsQueryService } from "../index.ts";
import { Temporal } from "@langwatch/time";

const { findTraceSummariesTotalUniq } = vi.hoisted(() => ({
  findTraceSummariesTotalUniq: vi.fn(),
}));

let billableEvents: { findTraceSummariesTotalUniq: typeof findTraceSummariesTotalUniq } | undefined;
const service = () =>
  BillableEventsQueryService.create(billableEvents as unknown as BillableEventsPort);

describe("billingMonthDateRange", () => {
  describe("when given a mid-year billing month", () => {
    /** @scenario "A month is asked for as a half-open range ending at the next month" */
    it("returns the first instant of the month and of the next month", () => {
      expect(BillableEventsQueryService.billingMonthDateRange("2026-07")).toEqual([
        "2026-07-01 00:00:00.000",
        "2026-08-01 00:00:00.000",
      ]);
    });
  });

  describe("when given December", () => {
    /** @scenario "A month is asked for as a half-open range ending at the next month" */
    it("rolls the end date over to January of the next year", () => {
      expect(BillableEventsQueryService.billingMonthDateRange("2026-12")).toEqual([
        "2026-12-01 00:00:00.000",
        "2027-01-01 00:00:00.000",
      ]);
    });
  });

  describe("when checking the range shape", () => {
    /** @scenario "A month is asked for as a half-open range ending at the next month" */
    it("produces a half-open range ending exactly at the next month boundary", () => {
      const [start, end] = BillableEventsQueryService.billingMonthDateRange("2026-01");
      expect(start).toBe("2026-01-01 00:00:00.000");
      // End is the *exclusive* boundary — the first millisecond of February,
      // to be used with `< endDate`, never `<=`.
      expect(end).toBe("2026-02-01 00:00:00.000");
    });
  });
});

describe("getBillingMonth", () => {
  describe("when the moment is the last instant of a month in UTC", () => {
    /** @scenario "The billing month is the UTC calendar month the moment falls in" */
    it("names that month rather than the next one a later time zone has entered", () => {
      expect(
        BillableEventsQueryService.getBillingMonth(
          Temporal.Instant.from("2026-01-31T23:59:59.999Z"),
        ),
      ).toBe("2026-01");
    });
  });

  describe("when the moment is the first instant of a month in UTC", () => {
    /** @scenario "The billing month is the UTC calendar month the moment falls in" */
    it("names the month that has just begun, whatever the reader's own clock says", () => {
      expect(
        BillableEventsQueryService.getBillingMonth(
          Temporal.Instant.from("2026-02-01T00:00:00.000Z"),
        ),
      ).toBe("2026-02");
    });
  });

  describe("when the moment is a leap day", () => {
    /** @scenario "The billing month is the UTC calendar month the moment falls in" */
    it("bills it under February", () => {
      expect(
        BillableEventsQueryService.getBillingMonth(
          Temporal.Instant.from("2028-02-29T12:00:00.000Z"),
        ),
      ).toBe("2028-02");
    });
  });

  describe("when the month number is a single digit", () => {
    /** @scenario "The billing month is the UTC calendar month the moment falls in" */
    it("pads it so the string sorts and matches the stored one", () => {
      expect(
        BillableEventsQueryService.getBillingMonth(
          Temporal.Instant.from("2026-09-15T00:00:00.000Z"),
        ),
      ).toBe("2026-09");
    });
  });
});

describe("getPreviousBillingMonth", () => {
  describe("when the moment is in January", () => {
    /** @scenario "The previous billing month walks back across a year end" */
    it("names December of the year before", () => {
      expect(
        BillableEventsQueryService.getPreviousBillingMonth(
          Temporal.Instant.from("2026-01-03T04:00:00.000Z"),
        ),
      ).toBe("2025-12");
    });
  });

  describe("when the moment is on the 31st and the month before is shorter", () => {
    /** @scenario "The previous billing month walks back across a year end" */
    it("names the month before rather than rolling forward past it", () => {
      expect(
        BillableEventsQueryService.getPreviousBillingMonth(
          Temporal.Instant.from("2026-03-31T12:00:00.000Z"),
        ),
      ).toBe("2026-02");
    });
  });

  describe("when the moment is the first instant of March in a leap year", () => {
    /** @scenario "The previous billing month walks back across a year end" */
    it("names February, the month the leap day belonged to", () => {
      expect(
        BillableEventsQueryService.getPreviousBillingMonth(
          Temporal.Instant.from("2028-03-01T00:00:00.000Z"),
        ),
      ).toBe("2028-02");
    });
  });

  describe("when the range for the previous month is taken", () => {
    /** @scenario "The previous billing month walks back across a year end" */
    it("closes at the first instant of the month the caller is in", () => {
      const previous = BillableEventsQueryService.getPreviousBillingMonth(
        Temporal.Instant.from("2026-01-15T00:00:00.000Z"),
      );

      expect(BillableEventsQueryService.billingMonthDateRange(previous)).toEqual([
        "2025-12-01 00:00:00.000",
        "2026-01-01 00:00:00.000",
      ]);
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

      const result = await service().tryQueryTraceSummariesTotalUniq({
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

      const result = await BillableEventsQueryService.create(null).tryQueryTraceSummariesTotalUniq({
        projectIds: ["proj-1"],
        billingMonth: "2026-02",
      });

      expect(result).toBeNull();
    });
  });

  describe("when projectIds is empty", () => {
    it("returns 0 without resolving a repository", async () => {
      const result = await service().tryQueryTraceSummariesTotalUniq({
        projectIds: [],
        billingMonth: "2026-02",
      });

      expect(result).toBe(0);
      expect(findTraceSummariesTotalUniq).not.toHaveBeenCalled();
    });
  });
});
