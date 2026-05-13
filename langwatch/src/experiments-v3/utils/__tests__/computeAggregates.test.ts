import { describe, expect, it } from "vitest";
import type { EvaluationResults } from "../../types";
import {
  computeMetricStats,
  computeTargetAggregates,
  formatCost,
  formatLatency,
  formatPassRate,
  formatScore,
} from "../computeAggregates";

describe("computeTargetAggregates", () => {
  const createResults = (
    overrides: Partial<EvaluationResults> = {},
  ): EvaluationResults => ({
    status: "success",
    targetOutputs: {},
    targetMetadata: {},
    evaluatorResults: {},
    errors: {},
    ...overrides,
  });

  it("returns zero counts when no results", () => {
    const results = createResults();
    const evaluators = [{ id: "eval-1", name: "Exact Match" }];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    expect(aggregates.completedRows).toBe(0);
    expect(aggregates.totalRows).toBe(3);
    expect(aggregates.errorRows).toBe(0);
    expect(aggregates.overallPassRate).toBeNull();
  });

  it("counts completed rows only when target AND all evaluators are done", () => {
    // Row 0: target done, evaluator done -> complete
    // Row 1: target done, evaluator done -> complete
    // Row 2: no target output -> not complete
    const results = createResults({
      targetOutputs: {
        "target-1": ["output 1", "output 2", undefined],
      },
      evaluatorResults: {
        "target-1": {
          "eval-1": [{ passed: true }, { passed: false }, undefined],
        },
      },
    });
    const evaluators = [{ id: "eval-1", name: "Exact Match" }];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    expect(aggregates.completedRows).toBe(2);
    expect(aggregates.totalRows).toBe(3);
  });

  it("does not count row as complete when evaluator is pending", () => {
    // Row 0: target done, evaluator done -> complete
    // Row 1: target done, evaluator still pending -> NOT complete
    const results = createResults({
      targetOutputs: {
        "target-1": ["output 1", "output 2"],
      },
      evaluatorResults: {
        "target-1": {
          "eval-1": [{ passed: true }, undefined],
        },
      },
    });
    const evaluators = [{ id: "eval-1", name: "Exact Match" }];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      2,
    );

    // Only 1 row is complete (row 0 has both target and evaluator done)
    expect(aggregates.completedRows).toBe(1);
    expect(aggregates.totalRows).toBe(2);
  });

  it("counts row as complete when no evaluators are configured", () => {
    // With no evaluators, row is complete as soon as target output arrives
    const results = createResults({
      targetOutputs: {
        "target-1": ["output 1", "output 2", undefined],
      },
    });
    const evaluators: Array<{ id: string; name: string }> = [];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    expect(aggregates.completedRows).toBe(2);
    expect(aggregates.totalRows).toBe(3);
  });

  it("counts error rows", () => {
    const results = createResults({
      targetOutputs: {
        "target-1": ["output 1", undefined, undefined],
      },
      errors: {
        "target-1": [
          undefined,
          "error message",
          undefined,
        ] as unknown as string[],
      },
    });
    const evaluators: Array<{ id: string; name: string }> = [];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    expect(aggregates.completedRows).toBe(2);
    expect(aggregates.errorRows).toBe(1);
  });

  it("computes pass rate from evaluator results", () => {
    const results = createResults({
      targetOutputs: {
        "target-1": ["out1", "out2", "out3"],
      },
      evaluatorResults: {
        "target-1": {
          "eval-1": [
            { status: "processed", passed: true },
            { status: "processed", passed: true },
            { status: "processed", passed: false },
          ],
        },
      },
    });
    const evaluators = [{ id: "eval-1", name: "Exact Match" }];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    expect(aggregates.evaluators[0]?.total).toBe(3);
    expect(aggregates.evaluators[0]?.passed).toBe(2);
    expect(aggregates.evaluators[0]?.failed).toBe(1);
    expect(aggregates.evaluators[0]?.passRate).toBeCloseTo(66.67, 1);
    expect(aggregates.overallPassRate).toBeCloseTo(66.67, 1);
  });

  it("computes average score when available", () => {
    const results = createResults({
      evaluatorResults: {
        "target-1": {
          "eval-1": [
            { status: "processed", passed: true, score: 0.8 },
            { status: "processed", passed: false, score: 0.2 },
            { status: "processed", passed: true, score: 1.0 },
          ],
        },
      },
    });
    const evaluators = [{ id: "eval-1", name: "Score Evaluator" }];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    expect(aggregates.evaluators[0]?.averageScore).toBeCloseTo(0.667, 2);
  });

  it("counts errors from evaluator results", () => {
    const results = createResults({
      evaluatorResults: {
        "target-1": {
          "eval-1": [
            { status: "processed", passed: true },
            { error: "Evaluator crashed" }, // Error format that parseEvaluationResult recognizes
            { status: "processed", passed: false },
          ],
        },
      },
    });
    const evaluators = [{ id: "eval-1", name: "Exact Match" }];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    expect(aggregates.evaluators[0]?.errors).toBe(1);
    expect(aggregates.evaluators[0]?.total).toBe(3);
  });

  it("returns null passRate for score-only evaluators (no pass/fail)", () => {
    // This is the case for LLM-as-judge Score evaluators that only return a score
    const results = createResults({
      evaluatorResults: {
        "target-1": {
          "eval-1": [
            { score: 0.8 }, // No passed field - should be "processed"
            { score: 0.6 },
            { score: 0.9 },
          ],
        },
      },
    });
    const evaluators = [{ id: "eval-1", name: "LLM Score" }];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    // Score-only results should have null passRate
    expect(aggregates.evaluators[0]?.passRate).toBeNull();
    expect(aggregates.evaluators[0]?.passed).toBe(0);
    expect(aggregates.evaluators[0]?.failed).toBe(0);
    expect(aggregates.evaluators[0]?.total).toBe(3);
    // But averageScore should still work
    expect(aggregates.evaluators[0]?.averageScore).toBeCloseTo(0.767, 2);
    // Overall passRate should also be null when no evaluators have pass/fail
    expect(aggregates.overallPassRate).toBeNull();
  });

  it("excludes score-only results from pass rate but includes pass/fail results", () => {
    // Mix of pass/fail evaluator and score-only evaluator
    const results = createResults({
      evaluatorResults: {
        "target-1": {
          "eval-pass-fail": [
            { status: "processed", passed: true },
            { status: "processed", passed: false },
          ],
          "eval-score-only": [
            { score: 0.8 }, // No passed field
            { score: 0.6 },
          ],
        },
      },
    });
    const evaluators = [
      { id: "eval-pass-fail", name: "Exact Match" },
      { id: "eval-score-only", name: "LLM Score" },
    ];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      2,
    );

    // Pass/fail evaluator should have pass rate
    expect(aggregates.evaluators[0]?.passRate).toBe(50); // 1 passed / 2 total
    expect(aggregates.evaluators[0]?.passed).toBe(1);
    expect(aggregates.evaluators[0]?.failed).toBe(1);

    // Score-only evaluator should have null pass rate
    expect(aggregates.evaluators[1]?.passRate).toBeNull();
    expect(aggregates.evaluators[1]?.passed).toBe(0);
    expect(aggregates.evaluators[1]?.failed).toBe(0);
    expect(aggregates.evaluators[1]?.averageScore).toBeCloseTo(0.7, 2);

    // Overall pass rate should only count the pass/fail evaluator
    expect(aggregates.overallPassRate).toBe(50); // 1 passed / 2 (passed+failed)
  });

  it("handles status: 'processed' with passed: null as score-only", () => {
    const results = createResults({
      evaluatorResults: {
        "target-1": {
          "eval-1": [
            { status: "processed", passed: null, score: 1 },
            { status: "processed", passed: null, score: 0.5 },
          ],
        },
      },
    });
    const evaluators = [{ id: "eval-1", name: "Score Evaluator" }];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      2,
    );

    // passed: null should be treated as score-only, not pass/fail
    expect(aggregates.evaluators[0]?.passRate).toBeNull();
    expect(aggregates.evaluators[0]?.averageScore).toBeCloseTo(0.75, 2);
  });

  it("handles multiple evaluators", () => {
    const results = createResults({
      evaluatorResults: {
        "target-1": {
          "eval-1": [
            { status: "processed", passed: true },
            { status: "processed", passed: true },
          ],
          "eval-2": [
            { status: "processed", passed: false },
            { status: "processed", passed: false },
          ],
        },
      },
    });
    const evaluators = [
      { id: "eval-1", name: "Evaluator 1" },
      { id: "eval-2", name: "Evaluator 2" },
    ];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      2,
    );

    expect(aggregates.evaluators).toHaveLength(2);
    expect(aggregates.evaluators[0]?.passRate).toBe(100);
    expect(aggregates.evaluators[1]?.passRate).toBe(0);
    // Overall: 2 passed out of 4 total = 50%
    expect(aggregates.overallPassRate).toBe(50);
  });

  it("computes average cost and latency from metadata", () => {
    const results = createResults({
      targetOutputs: {
        "target-1": ["out1", "out2", "out3"],
      },
      targetMetadata: {
        "target-1": [
          { cost: 0.001, duration: 500 },
          { cost: 0.002, duration: 1000 },
          { cost: 0.003, duration: 1500 },
        ],
      },
    });
    const evaluators: Array<{ id: string; name: string }> = [];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    expect(aggregates.averageCost).toBeCloseTo(0.002, 6);
    expect(aggregates.totalCost).toBeCloseTo(0.006, 6);
    expect(aggregates.averageLatency).toBeCloseTo(1000, 0);
  });

  it("computes overall average score across multiple evaluators", () => {
    const results = createResults({
      evaluatorResults: {
        "target-1": {
          "eval-1": [
            { status: "processed", passed: true, score: 1.0 },
            { status: "processed", passed: true, score: 1.0 },
          ],
          "eval-2": [
            { status: "processed", passed: false, score: 0.0 },
            { status: "processed", passed: false, score: 0.0 },
          ],
        },
      },
    });
    const evaluators = [
      { id: "eval-1", name: "Evaluator 1" },
      { id: "eval-2", name: "Evaluator 2" },
    ];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      2,
    );

    // eval-1 avg = 1.0, eval-2 avg = 0.0, overall avg = 0.5
    expect(aggregates.overallAverageScore).toBeCloseTo(0.5, 2);
  });

  it("handles partial metadata (some rows missing cost/duration)", () => {
    const results = createResults({
      targetOutputs: {
        "target-1": ["out1", "out2", "out3"],
      },
      targetMetadata: {
        "target-1": [
          { cost: 0.001, duration: 500 },
          undefined,
          { cost: 0.003 }, // No duration
        ] as any,
      },
    });
    const evaluators: Array<{ id: string; name: string }> = [];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    // Only 2 rows have cost
    expect(aggregates.averageCost).toBeCloseTo(0.002, 6);
    expect(aggregates.totalCost).toBeCloseTo(0.004, 6);
    // Only 1 row has duration
    expect(aggregates.averageLatency).toBe(500);
  });

  it("computes totalDuration as sum of all durations", () => {
    const results = createResults({
      targetOutputs: {
        "target-1": ["out1", "out2", "out3"],
      },
      targetMetadata: {
        "target-1": [
          { duration: 500 },
          { duration: 300 },
          { duration: 700 },
        ] as any,
      },
    });
    const evaluators: Array<{ id: string; name: string }> = [];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      3,
    );

    // Total duration should be sum: 500 + 300 + 700 = 1500
    expect(aggregates.totalDuration).toBe(1500);
    // Average should be 1500 / 3 = 500
    expect(aggregates.averageLatency).toBe(500);
  });

  it("returns null for totalDuration when no durations", () => {
    const results = createResults({
      targetOutputs: {
        "target-1": ["out1", "out2"],
      },
      targetMetadata: {
        "target-1": [
          { cost: 0.001 }, // No duration
          { cost: 0.002 }, // No duration
        ] as any,
      },
    });
    const evaluators: Array<{ id: string; name: string }> = [];

    const aggregates = computeTargetAggregates(
      "target-1",
      results,
      evaluators,
      2,
    );

    expect(aggregates.totalDuration).toBeNull();
    expect(aggregates.averageLatency).toBeNull();
  });
});

describe("formatPassRate", () => {
  it("returns dash for null", () => {
    expect(formatPassRate(null)).toBe("-");
  });

  it("rounds to nearest integer", () => {
    expect(formatPassRate(66.67)).toBe("67%");
    expect(formatPassRate(33.33)).toBe("33%");
    expect(formatPassRate(100)).toBe("100%");
    expect(formatPassRate(0)).toBe("0%");
  });
});

describe("formatScore", () => {
  it("returns dash for null", () => {
    expect(formatScore(null)).toBe("-");
  });

  it("formats to 2 decimal places", () => {
    expect(formatScore(0.666)).toBe("0.67");
    expect(formatScore(1)).toBe("1.00");
    expect(formatScore(0)).toBe("0.00");
  });
});

describe("formatCost", () => {
  it("returns dash for null", () => {
    expect(formatCost(null)).toBe("-");
  });

  it("formats small costs with 6 decimal places", () => {
    expect(formatCost(0.000001)).toBe("$0.000001");
    expect(formatCost(0.0001)).toBe("$0.000100");
  });

  it("formats medium costs with 4 decimal places", () => {
    expect(formatCost(0.01)).toBe("$0.0100");
    expect(formatCost(0.1234)).toBe("$0.1234");
  });

  it("formats large costs with 2 decimal places", () => {
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(10.5)).toBe("$10.50");
  });
});

describe("formatLatency", () => {
  it("returns dash for null", () => {
    expect(formatLatency(null)).toBe("-");
  });

  it("formats milliseconds for values under 1 second", () => {
    expect(formatLatency(500)).toBe("500ms");
    expect(formatLatency(123)).toBe("123ms");
  });

  it("formats seconds for values 1 second or more", () => {
    expect(formatLatency(1000)).toBe("1.0s");
    expect(formatLatency(1500)).toBe("1.5s");
    expect(formatLatency(2345)).toBe("2.3s");
  });
});

describe("computeMetricStats", () => {
  it("returns null for empty array", () => {
    expect(computeMetricStats([])).toBeNull();
  });

  it("computes all percentiles for single value", () => {
    const stats = computeMetricStats([100]);

    expect(stats).not.toBeNull();
    expect(stats!.min).toBe(100);
    expect(stats!.max).toBe(100);
    expect(stats!.avg).toBe(100);
    expect(stats!.median).toBe(100);
    expect(stats!.p75).toBe(100);
    expect(stats!.p90).toBe(100);
    expect(stats!.p95).toBe(100);
    expect(stats!.p99).toBe(100);
    expect(stats!.total).toBe(100);
    expect(stats!.count).toBe(1);
  });

  it("computes percentiles correctly for multiple values", () => {
    // Values: 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const stats = computeMetricStats(values);

    expect(stats).not.toBeNull();
    expect(stats!.min).toBe(100);
    expect(stats!.max).toBe(1000);
    expect(stats!.avg).toBe(550); // (100+200+...+1000)/10 = 5500/10
    expect(stats!.median).toBeCloseTo(550, 0); // p50, interpolated between 500 and 600
    expect(stats!.p75).toBeCloseTo(775, 0);
    expect(stats!.p90).toBeCloseTo(910, 0);
    expect(stats!.p95).toBeCloseTo(955, 0);
    expect(stats!.p99).toBeCloseTo(991, 0);
    expect(stats!.total).toBe(5500);
    expect(stats!.count).toBe(10);
  });

  it("handles unsorted input", () => {
    const values = [500, 100, 300, 200, 400];
    const stats = computeMetricStats(values);

    expect(stats).not.toBeNull();
    expect(stats!.min).toBe(100);
    expect(stats!.max).toBe(500);
    expect(stats!.median).toBe(300);
    expect(stats!.avg).toBe(300);
  });
});

describe("computeTargetAggregates latencyStats and costStats", () => {
  const createResults = (
    overrides: Partial<EvaluationResults> = {},
  ): EvaluationResults => ({
    status: "success",
    targetOutputs: {},
    targetMetadata: {},
    evaluatorResults: {},
    errors: {},
    ...overrides,
  });

  it("includes latencyStats and costStats when metadata present", () => {
    const results = createResults({
      targetOutputs: {
        "target-1": ["out1", "out2", "out3"],
      },
      targetMetadata: {
        "target-1": [
          { cost: 0.001, duration: 500 },
          { cost: 0.002, duration: 1000 },
          { cost: 0.003, duration: 1500 },
        ],
      },
    });

    const aggregates = computeTargetAggregates("target-1", results, [], 3);

    expect(aggregates.latencyStats).not.toBeNull();
    expect(aggregates.latencyStats!.min).toBe(500);
    expect(aggregates.latencyStats!.max).toBe(1500);
    expect(aggregates.latencyStats!.avg).toBe(1000);
    expect(aggregates.latencyStats!.total).toBe(3000);
    expect(aggregates.latencyStats!.count).toBe(3);

    expect(aggregates.costStats).not.toBeNull();
    expect(aggregates.costStats!.min).toBe(0.001);
    expect(aggregates.costStats!.max).toBe(0.003);
    expect(aggregates.costStats!.avg).toBe(0.002);
    expect(aggregates.costStats!.total).toBe(0.006);
    expect(aggregates.costStats!.count).toBe(3);
  });

  it("returns null for latencyStats and costStats when no metadata", () => {
    const results = createResults({
      targetOutputs: {
        "target-1": ["out1"],
      },
    });

    const aggregates = computeTargetAggregates("target-1", results, [], 1);

    expect(aggregates.latencyStats).toBeNull();
    expect(aggregates.costStats).toBeNull();
  });
});
