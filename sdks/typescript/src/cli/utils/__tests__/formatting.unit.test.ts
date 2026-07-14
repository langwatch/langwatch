import { describe, it, expect, vi, beforeEach } from "vitest";
import { stripAnsi, formatTable, formatRelativeTime } from "../formatting";

describe("stripAnsi()", () => {
  it("removes ANSI color codes from a string", () => {
    const input = "\u001b[36mhello\u001b[0m";
    expect(stripAnsi(input)).toBe("hello");
  });

  it("returns plain strings unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("handles empty strings", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("removes multiple ANSI sequences", () => {
    const input = "\u001b[1m\u001b[36mbold cyan\u001b[0m";
    expect(stripAnsi(input)).toBe("bold cyan");
  });
});

describe("formatRelativeTime()", () => {
  describe("when given a valid past date", () => {
    it("returns years for dates over a year ago", () => {
      const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(twoYearsAgo)).toBe("2y ago");
    });

    it("returns months for dates over a month ago", () => {
      const threeMonthsAgo = new Date(Date.now() - 3 * 30 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(threeMonthsAgo)).toBe("3mo ago");
    });

    it("returns days for dates over a day ago", () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(fiveDaysAgo)).toBe("5d ago");
    });

    it("returns hours for dates over an hour ago", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
    });

    it("returns minutes for dates over a minute ago", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      expect(formatRelativeTime(tenMinutesAgo)).toBe("10m ago");
    });

    it("returns seconds for recent dates", () => {
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
      expect(formatRelativeTime(thirtySecondsAgo)).toBe("30s ago");
    });

    it("returns 'just now' for dates less than a second ago", () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe("just now");
    });
  });

  describe("when given an invalid date", () => {
    it("returns dash for invalid date strings", () => {
      expect(formatRelativeTime("not-a-date")).toBe("—");
    });

    it("returns dash for empty string", () => {
      expect(formatRelativeTime("")).toBe("—");
    });
  });

  describe("when given a future date", () => {
    it("clamps to 'just now' instead of negative values", () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(futureDate)).toBe("just now");
    });
  });
});

describe("formatTable()", () => {
  let consoleOutput: string[];

  beforeEach(() => {
    consoleOutput = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  });

  describe("when data is empty", () => {
    it("prints the empty message", () => {
      formatTable({
        data: [],
        headers: ["Name"],
        emptyMessage: "Nothing here",
      });

      expect(consoleOutput).toHaveLength(1);
      expect(stripAnsi(consoleOutput[0]!)).toBe("Nothing here");
    });

    it("uses default empty message when none provided", () => {
      formatTable({ data: [], headers: ["Name"] });

      expect(consoleOutput).toHaveLength(1);
      expect(stripAnsi(consoleOutput[0]!)).toBe("No data found");
    });
  });

  describe("when data has rows", () => {
    it("prints header, separator, and data rows", () => {
      formatTable({
        data: [
          { Name: "alpha", Type: "foo" },
          { Name: "beta", Type: "bar" },
        ],
        headers: ["Name", "Type"],
      });

      // header + separator + 2 data rows = 4 lines
      expect(consoleOutput).toHaveLength(4);
    });

    it("pads columns to align with the longest value", () => {
      formatTable({
        data: [
          { Col: "short" },
          { Col: "a longer value" },
        ],
        headers: ["Col"],
      });

      const headerLine = stripAnsi(consoleOutput[0]!);
      const separatorLine = stripAnsi(consoleOutput[1]!);
      // separator should be at least as wide as the longest value
      expect(separatorLine.length).toBeGreaterThanOrEqual("a longer value".length);
      // header should be padded to match
      expect(headerLine.length).toBe(separatorLine.length);
    });

    it("applies color functions from colorMap", () => {
      const colorFn = vi.fn((s: string) => `[colored]${s}[/colored]`);

      formatTable({
        data: [{ Name: "test" }],
        headers: ["Name"],
        colorMap: { Name: colorFn },
      });

      expect(colorFn).toHaveBeenCalled();
    });
  });
});
