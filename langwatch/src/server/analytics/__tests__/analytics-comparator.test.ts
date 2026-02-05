import { describe, expect, it } from "vitest";
import { AnalyticsComparator } from "../analytics-comparator";
import type { TimeseriesResult, FilterDataResult } from "../types";

describe("AnalyticsComparator", () => {
  describe("findDiscrepancies", () => {
    it("returns empty array when results match exactly", () => {
      const comparator = new AnalyticsComparator();
      const esResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [{ date: "2023-12-31", count: 90 }],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [{ date: "2023-12-31", count: 90 }],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });

    it("returns empty array when results within tolerance (5%)", () => {
      const comparator = new AnalyticsComparator(0.05);
      const esResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [],
      };
      // 4% difference is within 5% tolerance
      const chResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 104 }],
        previousPeriod: [],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });

    it("detects value differences exceeding tolerance", () => {
      const comparator = new AnalyticsComparator(0.05);
      const esResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [],
      };
      // 10% difference exceeds 5% tolerance
      const chResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 110 }],
        previousPeriod: [],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies.length).toBeGreaterThan(0);
      expect(discrepancies[0]).toContain("count");
      expect(discrepancies[0]).toContain("ES=100");
      expect(discrepancies[0]).toContain("CH=110");
    });

    it("detects bucket count differences in timeseries", () => {
      const comparator = new AnalyticsComparator();
      const esResult: TimeseriesResult = {
        currentPeriod: [
          { date: "2024-01-01", count: 100 },
          { date: "2024-01-02", count: 110 },
        ],
        previousPeriod: [],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies.length).toBeGreaterThan(0);
      expect(discrepancies[0]).toContain("bucket count");
      expect(discrepancies[0]).toContain("ES=2");
      expect(discrepancies[0]).toContain("CH=1");
    });

    it("handles missing metrics gracefully", () => {
      const comparator = new AnalyticsComparator();
      const esResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100, extraMetric: 50 }],
        previousPeriod: [],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [],
      };

      // Does not throw
      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      // extraMetric is only in ES, CH doesn't have it - should not cause error
      expect(discrepancies).toBeDefined();
    });

    it("uses minimum absolute difference of 1 for small values", () => {
      const comparator = new AnalyticsComparator(0.05);
      const esResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 2 }],
        previousPeriod: [],
      };
      // Difference of 1 should be within MIN_ABSOLUTE_DIFFERENCE tolerance
      const chResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 3 }],
        previousPeriod: [],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });

    it("handles unknown result types gracefully", () => {
      const comparator = new AnalyticsComparator();
      const esResult = { unknownField: "test" };
      const chResult = { unknownField: "test" };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });
  });

  describe("compareTimeseriesResults", () => {
    it("compares current period buckets", () => {
      const comparator = new AnalyticsComparator(0.01); // 1% tolerance for precision
      const esResult: TimeseriesResult = {
        currentPeriod: [
          { date: "2024-01-01", metric1: 100, metric2: 200 },
          { date: "2024-01-02", metric1: 150, metric2: 250 },
        ],
        previousPeriod: [],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [
          { date: "2024-01-01", metric1: 100, metric2: 200 },
          { date: "2024-01-02", metric1: 150, metric2: 300 }, // metric2 differs
        ],
        previousPeriod: [],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies.length).toBe(1);
      expect(discrepancies[0]).toContain("Bucket 1");
      expect(discrepancies[0]).toContain("metric2");
    });

    it("compares previous period buckets when both have data", () => {
      const comparator = new AnalyticsComparator();
      const esResult: TimeseriesResult = {
        currentPeriod: [],
        previousPeriod: [{ date: "2023-12-31", count: 100 }],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [],
        previousPeriod: [{ date: "2023-12-31", count: 100 }],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });

    it("handles empty bucket arrays", () => {
      const comparator = new AnalyticsComparator();
      const esResult: TimeseriesResult = {
        currentPeriod: [],
        previousPeriod: [],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [],
        previousPeriod: [],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });

    it("compares multiple metrics in a single bucket", () => {
      const comparator = new AnalyticsComparator(0.01);
      const esResult: TimeseriesResult = {
        currentPeriod: [
          {
            date: "2024-01-01",
            totalCost: 1.5,
            traceCount: 100,
            avgDuration: 250,
          },
        ],
        previousPeriod: [],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [
          {
            date: "2024-01-01",
            totalCost: 1.5,
            traceCount: 100,
            avgDuration: 250,
          },
        ],
        previousPeriod: [],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });
  });

  describe("compareFilterDataResults", () => {
    it("compares filter option counts", () => {
      const comparator = new AnalyticsComparator(0.01);
      const esResult: FilterDataResult = {
        options: [
          { field: "topic-1", label: "Topic 1", count: 50 },
          { field: "topic-2", label: "Topic 2", count: 30 },
        ],
      };
      const chResult: FilterDataResult = {
        options: [
          { field: "topic-1", label: "Topic 1", count: 50 },
          { field: "topic-2", label: "Topic 2", count: 30 },
        ],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });

    it("detects missing options", () => {
      const comparator = new AnalyticsComparator();
      const esResult: FilterDataResult = {
        options: [
          { field: "topic-1", label: "Topic 1", count: 50 },
          { field: "topic-2", label: "Topic 2", count: 30 },
        ],
      };
      const chResult: FilterDataResult = {
        options: [{ field: "topic-1", label: "Topic 1", count: 50 }],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies.length).toBeGreaterThan(0);
      expect(discrepancies[0]).toContain("Option count");
      expect(discrepancies[0]).toContain("ES=2");
      expect(discrepancies[0]).toContain("CH=1");
    });

    it("detects count differences in filter options", () => {
      const comparator = new AnalyticsComparator(0.01);
      const esResult: FilterDataResult = {
        options: [{ field: "topic-1", label: "Topic 1", count: 50 }],
      };
      const chResult: FilterDataResult = {
        options: [{ field: "topic-1", label: "Topic 1", count: 70 }],
      };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies.length).toBeGreaterThan(0);
      expect(discrepancies[0]).toContain("Option topic-1");
      expect(discrepancies[0]).toContain("ES=50");
      expect(discrepancies[0]).toContain("CH=70");
    });

    it("handles empty options arrays", () => {
      const comparator = new AnalyticsComparator();
      const esResult: FilterDataResult = { options: [] };
      const chResult: FilterDataResult = { options: [] };

      const discrepancies = comparator.findDiscrepancies(esResult, chResult);

      expect(discrepancies).toEqual([]);
    });
  });

  describe("compare method (logging)", () => {
    it("logs discrepancies when found", () => {
      const comparator = new AnalyticsComparator(0.01);
      const esResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 200 }],
        previousPeriod: [],
      };

      // Does not throw
      expect(() => {
        comparator.compare("getTimeseries", { projectId: "test" }, esResult, chResult);
      }).not.toThrow();
    });

    it("handles matching results without errors", () => {
      const comparator = new AnalyticsComparator();
      const result: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [],
      };

      expect(() => {
        comparator.compare("getTimeseries", { projectId: "test" }, result, result);
      }).not.toThrow();
    });
  });

  describe("custom tolerance", () => {
    it("respects custom tolerance percentage", () => {
      const strictComparator = new AnalyticsComparator(0.01); // 1%
      const lenientComparator = new AnalyticsComparator(0.10); // 10%

      const esResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 100 }],
        previousPeriod: [],
      };
      const chResult: TimeseriesResult = {
        currentPeriod: [{ date: "2024-01-01", count: 108 }], // 8% difference
        previousPeriod: [],
      };

      const strictDiscrepancies = strictComparator.findDiscrepancies(esResult, chResult);
      const lenientDiscrepancies = lenientComparator.findDiscrepancies(esResult, chResult);

      expect(strictDiscrepancies.length).toBeGreaterThan(0);
      expect(lenientDiscrepancies).toEqual([]);
    });
  });
});
