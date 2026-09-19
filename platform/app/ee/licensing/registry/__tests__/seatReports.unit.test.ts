import { describe, expect, it } from "vitest";
import { licenseTermQuarterStart } from "../seatReports";

const quarterOf = (issuedAt: string, now: string) =>
  licenseTermQuarterStart({
    issuedAt: new Date(issuedAt),
    now: new Date(now),
  }).toISOString();

describe("licenseTermQuarterStart", () => {
  describe("given a license issued mid-month", () => {
    describe("when the clock moves through the term", () => {
      it("steps three months at a time from the day it was issued", () => {
        const issuedAt = "2026-02-10T09:30:00.000Z";

        expect([
          quarterOf(issuedAt, "2026-02-10T09:30:00.000Z"),
          quarterOf(issuedAt, "2026-05-09T23:59:59.000Z"),
          quarterOf(issuedAt, "2026-05-10T09:30:00.000Z"),
          quarterOf(issuedAt, "2027-01-01T00:00:00.000Z"),
        ]).toEqual([
          "2026-02-10T09:30:00.000Z",
          "2026-02-10T09:30:00.000Z",
          "2026-05-10T09:30:00.000Z",
          "2026-11-10T09:30:00.000Z",
        ]);
      });
    });
  });

  describe("given a license issued on a day the target month does not have", () => {
    it("clamps to the last day of that month instead of rolling over", () => {
      expect(
        quarterOf("2026-08-31T00:00:00.000Z", "2027-01-01T00:00:00.000Z"),
      ).toBe("2026-11-30T00:00:00.000Z");
    });
  });

  describe("given a clock that reads earlier than the license was issued", () => {
    it("reads as the first quarter rather than opening one of its own", () => {
      expect(
        quarterOf("2026-09-19T12:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      ).toBe("2026-09-19T12:00:00.000Z");
    });
  });
});
