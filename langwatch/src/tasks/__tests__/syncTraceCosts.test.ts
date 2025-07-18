import { describe, it, expect } from "vitest";

// Test the Painless script logic (simulated in JavaScript)
const calculateTraceCostFromSpans = (spans: any[]): number | null => {
  let totalCost = 0.0;
  let hasValidCosts = false;

  for (const span of spans) {
    if (span?.metrics?.cost !== null && span?.metrics?.cost !== undefined) {
      totalCost += span.metrics.cost;
      hasValidCosts = true;
    }
  }

  return hasValidCosts ? totalCost : null;
};

describe("syncTraceCosts", () => {
  describe("calculateTraceCostFromSpans", () => {
    it("should calculate total cost from multiple spans with costs", () => {
      const spans = [
        {
          span_id: "span_1",
          metrics: {
            cost: 0.0001,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        },
        {
          span_id: "span_2",
          metrics: {
            cost: 0.0002,
            prompt_tokens: 200,
            completion_tokens: 100,
          },
        },
        {
          span_id: "span_3",
          metrics: {
            cost: 0.0003,
            prompt_tokens: 300,
            completion_tokens: 150,
          },
        },
      ];

      const totalCost = calculateTraceCostFromSpans(spans);

      expect(totalCost).toBeCloseTo(0.0006, 10); // 0.0001 + 0.0002 + 0.0003
    });

    it("should handle spans with undefined or null costs", () => {
      const spans = [
        {
          span_id: "span_1",
          metrics: {
            cost: 0.0001,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        },
        {
          span_id: "span_2",
          metrics: {
            cost: undefined, // Should be ignored
            prompt_tokens: 200,
            completion_tokens: 100,
          },
        },
        {
          span_id: "span_3",
          metrics: {
            cost: null, // Should be ignored
            prompt_tokens: 300,
            completion_tokens: 150,
          },
        },
      ];

      const totalCost = calculateTraceCostFromSpans(spans);

      expect(totalCost).toBe(0.0001); // Only the first span's cost
    });

    it("should return null when no spans have costs", () => {
      const spans = [
        {
          span_id: "span_1",
          metrics: {
            cost: undefined,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        },
        {
          span_id: "span_2",
          metrics: {
            cost: null,
            prompt_tokens: 200,
            completion_tokens: 100,
          },
        },
        {
          span_id: "span_3",
          // No metrics
        },
      ];

      const totalCost = calculateTraceCostFromSpans(spans);

      expect(totalCost).toBeNull();
    });

    it("should handle empty spans array", () => {
      const totalCost = calculateTraceCostFromSpans([]);

      expect(totalCost).toBeNull();
    });

    it("should handle spans without metrics", () => {
      const spans = [
        {
          span_id: "span_1",
          // No metrics
        },
        {
          span_id: "span_2",
          // No metrics
        },
      ];

      const totalCost = calculateTraceCostFromSpans(spans);

      expect(totalCost).toBeNull();
    });

    it("should handle spans with metrics but no cost", () => {
      const spans = [
        {
          span_id: "span_1",
          metrics: {
            prompt_tokens: 100,
            completion_tokens: 50,
            // No cost
          },
        },
        {
          span_id: "span_2",
          metrics: {
            prompt_tokens: 200,
            completion_tokens: 100,
            // No cost
          },
        },
      ];

      const totalCost = calculateTraceCostFromSpans(spans);

      expect(totalCost).toBeNull();
    });
  });
});
