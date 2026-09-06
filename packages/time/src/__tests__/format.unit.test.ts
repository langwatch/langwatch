import { describe, expect, it } from "vitest";

import { format } from "../format";

const AMSTERDAM = { timeZone: "Europe/Amsterdam" } as const;

/**
 * Every pattern the product passes, against four moments, with the string the
 * previous library printed. A row that stops matching is a customer-visible
 * change of copy.
 */
const GOLDEN: [stamp: string, pattern: string, expected: string][] = [
  ["2026-06-15T12:00:00+02:00", "MMM d HH:mm", "Jun 15 12:00"],
  ["2026-06-15T12:00:00+02:00", "HH:mm", "12:00"],
  ["2026-06-15T12:00:00+02:00", "MMM d", "Jun 15"],
  ["2026-06-15T12:00:00+02:00", "yyyy-MM-dd'T'HH:mm", "2026-06-15T12:00"],
  ["2026-06-15T12:00:00+02:00", "MMM d, yyyy", "Jun 15, 2026"],
  ["2026-06-15T12:00:00+02:00", "MMM d, HH:mm", "Jun 15, 12:00"],
  ["2026-06-15T12:00:00+02:00", "d MMM yyyy, HH:mm", "15 Jun 2026, 12:00"],
  ["2026-06-15T12:00:00+02:00", "yyyy-MM-dd HH:mm", "2026-06-15 12:00"],
  ["2026-06-15T12:00:00+02:00", "dd/MMM HH:mm", "15/Jun 12:00"],
  ["2026-06-15T12:00:00+02:00", "yyyy-MM-dd", "2026-06-15"],
  ["2024-03-05T09:30:00Z", "MMM d HH:mm", "Mar 5 10:30"],
  ["2024-03-05T09:30:00Z", "HH:mm", "10:30"],
  ["2024-03-05T09:30:00Z", "MMM d", "Mar 5"],
  ["2024-03-05T09:30:00Z", "yyyy-MM-dd'T'HH:mm", "2024-03-05T10:30"],
  ["2024-03-05T09:30:00Z", "MMM d, yyyy", "Mar 5, 2024"],
  ["2024-03-05T09:30:00Z", "MMM d, HH:mm", "Mar 5, 10:30"],
  ["2024-03-05T09:30:00Z", "d MMM yyyy, HH:mm", "5 Mar 2024, 10:30"],
  ["2024-03-05T09:30:00Z", "yyyy-MM-dd HH:mm", "2024-03-05 10:30"],
  ["2024-03-05T09:30:00Z", "dd/MMM HH:mm", "05/Mar 10:30"],
  ["2024-03-05T09:30:00Z", "yyyy-MM-dd", "2024-03-05"],
  ["2026-01-09T04:07:03+01:00", "MMM d HH:mm", "Jan 9 04:07"],
  ["2026-01-09T04:07:03+01:00", "HH:mm", "04:07"],
  ["2026-01-09T04:07:03+01:00", "MMM d", "Jan 9"],
  ["2026-01-09T04:07:03+01:00", "yyyy-MM-dd'T'HH:mm", "2026-01-09T04:07"],
  ["2026-01-09T04:07:03+01:00", "MMM d, yyyy", "Jan 9, 2026"],
  ["2026-01-09T04:07:03+01:00", "MMM d, HH:mm", "Jan 9, 04:07"],
  ["2026-01-09T04:07:03+01:00", "d MMM yyyy, HH:mm", "9 Jan 2026, 04:07"],
  ["2026-01-09T04:07:03+01:00", "yyyy-MM-dd HH:mm", "2026-01-09 04:07"],
  ["2026-01-09T04:07:03+01:00", "dd/MMM HH:mm", "09/Jan 04:07"],
  ["2026-01-09T04:07:03+01:00", "yyyy-MM-dd", "2026-01-09"],
  ["2025-12-31T23:59:59+01:00", "MMM d HH:mm", "Dec 31 23:59"],
  ["2025-12-31T23:59:59+01:00", "HH:mm", "23:59"],
  ["2025-12-31T23:59:59+01:00", "MMM d", "Dec 31"],
  ["2025-12-31T23:59:59+01:00", "yyyy-MM-dd'T'HH:mm", "2025-12-31T23:59"],
  ["2025-12-31T23:59:59+01:00", "MMM d, yyyy", "Dec 31, 2025"],
  ["2025-12-31T23:59:59+01:00", "MMM d, HH:mm", "Dec 31, 23:59"],
  ["2025-12-31T23:59:59+01:00", "d MMM yyyy, HH:mm", "31 Dec 2025, 23:59"],
  ["2025-12-31T23:59:59+01:00", "yyyy-MM-dd HH:mm", "2025-12-31 23:59"],
  ["2025-12-31T23:59:59+01:00", "dd/MMM HH:mm", "31/Dec 23:59"],
  ["2025-12-31T23:59:59+01:00", "yyyy-MM-dd", "2025-12-31"],
];

describe("format", () => {
  describe("given the patterns the screens pass today", () => {
    /** @scenario "Every pattern the product uses renders unchanged" */
    it.each(GOLDEN)("renders %s as %s unchanged", (stamp, pattern, expected) => {
      expect(format(new Date(stamp), pattern, AMSTERDAM)).toBe(expected);
    });
  });

  describe("given a moment read in another time zone", () => {
    it("reads the wall clock of that zone", () => {
      const at = new Date("2026-06-15T12:00:00+02:00");
      expect(format(at, "yyyy-MM-dd HH:mm", { timeZone: "UTC" })).toBe("2026-06-15 10:00");
      expect(format(at, "yyyy-MM-dd HH:mm", { timeZone: "Asia/Tokyo" })).toBe("2026-06-15 19:00");
    });
  });

  describe("given a moment on the day a clock changes", () => {
    it("prints the local wall clock either side of the change", () => {
      expect(format(new Date("2026-03-29T00:30:00+01:00"), "HH:mm", AMSTERDAM)).toBe("00:30");
      expect(format(new Date("2026-03-29T03:30:00+02:00"), "HH:mm", AMSTERDAM)).toBe("03:30");
    });
  });

  describe("given epoch milliseconds rather than a Date", () => {
    it("reads the same moment", () => {
      const at = new Date("2026-06-15T12:00:00+02:00");
      expect(format(at.getTime(), "MMM d, yyyy", AMSTERDAM)).toBe("Jun 15, 2026");
    });
  });

  describe("given a pattern carrying a token the package does not implement", () => {
    /** @scenario "An unsupported pattern fails loudly rather than printing a literal" */
    it("fails naming the token rather than printing it", () => {
      expect(() => format(Date.now(), "EEEE do", AMSTERDAM)).toThrow(
        /Unsupported date pattern token "EEEE"/,
      );
    });
  });

  describe("given a quoted literal", () => {
    it("prints the literal and not the tokens inside it", () => {
      expect(format(new Date("2026-06-15T12:00:00+02:00"), "'at' HH:mm", AMSTERDAM)).toBe(
        "at 12:00",
      );
    });
  });
});
