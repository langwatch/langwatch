import { describe, expect, it } from "vitest";
import { formatRate, passRateBar, sparkline } from "../charts";

describe("Feature: Run report — the outcome bar", () => {
  describe("given a mix of outcomes", () => {
    const bar = passRateBar({
      segments: [
        { label: "passed", value: 3, tone: "pass" },
        { label: "failed", value: 1, tone: "fail" },
      ],
    });

    /** @scenario The report opens with no network access */
    it("renders an inline svg that names itself as an image", () => {
      expect(bar).toContain('<svg class="chart"');
      expect(bar).toContain('role="img"');
      expect(bar).toContain("<title>Outcomes: 3 passed, 1 failed</title>");
    });

    /** @scenario Printing the report produces a clean document */
    it("repeats the same numbers in a table for readers who cannot see it", () => {
      expect(bar).toContain('<table class="visually-hidden">');
      expect(bar).toContain("<td>passed</td><td>3</td>");
      expect(bar).toContain("<td>failed</td><td>1</td>");
    });

    /** @scenario The same run produces the same report twice */
    it("lays the segments out proportionally with fixed decimals", () => {
      expect(bar).toContain('width="75.00"');
      expect(bar).toContain('width="25.00"');
    });
  });

  describe("given a segment label containing markup", () => {
    /** @scenario A scenario named like markup is shown as text */
    it("escapes the label in both the title and the table", () => {
      const bar = passRateBar({
        segments: [{ label: "<b>passed</b>", value: 1, tone: "pass" }],
      });
      expect(bar).not.toContain("<b>");
      expect(bar).toContain("&lt;b&gt;passed&lt;/b&gt;");
    });
  });

  describe("given an outcome nobody hit", () => {
    /** @scenario The report never disagrees with the screen */
    it("keeps it out of the picture and still counts it in the table", () => {
      const bar = passRateBar({
        segments: [
          { label: "passed", value: 4, tone: "pass" },
          { label: "stalled", value: 0, tone: "warn" },
        ],
      });
      expect(bar).toContain("<title>Outcomes: 4 passed</title>");
      expect(bar).not.toContain("fill-warn");
      expect(bar).toContain("<td>stalled</td><td>0</td>");
    });
  });

  describe("given no runs at all", () => {
    /** @scenario A report still downloads when no model is configured */
    it("renders an empty bar rather than dividing by zero", () => {
      const bar = passRateBar({
        segments: [{ label: "passed", value: 0, tone: "pass" }],
      });
      expect(bar).toContain("<title>No runs to chart</title>");
      expect(bar).not.toContain("NaN");
    });
  });
});

describe("Feature: Run report — the trend sparkline", () => {
  describe("given a history of pass rates", () => {
    const spark = sparkline({
      points: [
        { label: "batch-1", value: 50 },
        { label: "batch-2", value: 25 },
        { label: "batch-3", value: 80 },
      ],
    });

    /** @scenario The report opens with no network access */
    it("plots the points inline and highlights the current run", () => {
      expect(spark).toContain('<polyline class="spark-line"');
      expect(spark).toContain('<circle class="spark-current"');
      expect(spark).toContain(
        "<title>Pass rate across 3 runs, ending at 80.0%</title>",
      );
    });

    /** @scenario The same run produces the same report twice */
    it("spaces the points on a fixed grid", () => {
      expect(spark).toContain('points="0.00,12.00 50.00,17.00 100.00,6.00"');
    });

    /** @scenario Printing the report produces a clean document */
    it("repeats the rates in a table", () => {
      expect(spark).toContain("<td>batch-1</td><td>50.0%</td>");
      expect(spark).toContain("<td>batch-3</td><td>80.0%</td>");
    });
  });

  describe("given a single point", () => {
    /** @scenario The same run produces the same report twice */
    it("centres it rather than dividing by zero", () => {
      const spark = sparkline({ points: [{ label: "batch-1", value: 100 }] });
      expect(spark).toContain('points="50.00,2.00"');
    });
  });

  describe("given no earlier runs", () => {
    /** @scenario A question left with nothing to say is shown as a gap */
    it("says there is nothing to compare against instead of drawing a flat line", () => {
      expect(sparkline({ points: [] })).toContain(
        "No earlier runs to compare against.",
      );
    });
  });

  describe("given a rate to format", () => {
    /** @scenario The same run produces the same report twice */
    it("formats to one decimal place without consulting a locale", () => {
      expect(formatRate(66.66666)).toBe("66.7%");
      expect(formatRate(100)).toBe("100.0%");
      expect(formatRate(0)).toBe("0.0%");
    });

    /**
     * The input is a percentage, the unit `passRateFrom()` and
     * `wilsonInterval()` both produce. Reading it as a fraction multiplied a
     * second time, so the one run big and consistent enough to quote a rate
     * headlined "Pass rate 8000.0%".
     *
     * @scenario A large enough sample states its rate with a margin
     */
    it("takes a percentage, not a fraction", () => {
      expect(formatRate(80)).toBe("80.0%");
      expect(formatRate(80)).not.toBe("8000.0%");
    });
  });
});
