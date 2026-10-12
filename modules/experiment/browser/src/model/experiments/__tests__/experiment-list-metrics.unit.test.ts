/** @see modules/experiment/specs/experiment-list-page.feature */
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import {
  defaultMetric,
  changeOfRun,
  describeChange,
  formatMetricValue,
  formatScore,
  cellProgressOf,
  formatUsd,
  headlineFromList,
  metricMenuLine,
  sparklineOf,
  headlineOf,
  metricReason,
  noMetricNote,
  runsAreFresh,
  listStampOf,
  DEFAULT_METRIC_RULE,
  leadMetric,
  metricsOfRuns,
  pooledValue,
  runCost,
  runsOldestFirst,
  summariseResult,
} from "../experiment-list-metrics.ts";

const run = ({
  id,
  createdAt,
  evaluations,
  cost,
  finishedAt,
  updatedAt,
}: {
  id: string;
  createdAt: number;
  finishedAt?: number;
  updatedAt?: number;
  evaluations: ExperimentRun["summary"]["evaluations"];
  cost?: { datasetCost?: number; evaluationsCost?: number };
}): ExperimentRun => ({
  experimentId: "exp",
  runId: id,
  workflowVersion: null,
  timestamps: { createdAt, updatedAt: updatedAt ?? createdAt, finishedAt },
  summary: { evaluations, ...cost },
});

const correct = (passed: number) => ({
  name: "correct",
  averageScore: passed,
  averagePassed: passed,
});
const latency = (ms: number) => ({ name: "latency_ms", averageScore: ms });
const quality = (score: number) => ({ name: "quality", averageScore: score });

describe("given the evaluators the runs of an experiment report", () => {
  describe("when the person has not picked a primary metric", () => {
    it("leads with the first pass/fail evaluator by name", () => {
      const metrics = metricsOfRuns([
        run({ id: "a", createdAt: 1, evaluations: { q: quality(0.4), c: correct(0.9) } }),
      ]);
      expect(defaultMetric({ metrics })?.label).toBe("correct");
    });

    it("skips measurements such as latency when no evaluator passes or fails", () => {
      const metrics = metricsOfRuns([
        run({ id: "a", createdAt: 1, evaluations: { l: latency(900), q: quality(0.4) } }),
      ]);
      expect(defaultMetric({ metrics })?.label).toBe("quality");
    });

    it("falls back to the first evaluator when only measurements exist", () => {
      const metrics = metricsOfRuns([
        run({ id: "a", createdAt: 1, evaluations: { l: latency(900) } }),
      ]);
      expect(defaultMetric({ metrics })?.label).toBe("latency_ms");
    });

    /** @scenario A real score is not mistaken for a measurement */
    it("keeps a real score whose name only contains a measurement word", () => {
      for (const name of ["token_overlap", "cost_efficiency", "latency_aware_quality"]) {
        const metrics = metricsOfRuns([
          run({
            id: "a",
            createdAt: 1,
            evaluations: { a: { name: "cost", averageScore: 5 }, x: { name, averageScore: 0.4 } },
          }),
        ]);
        expect(defaultMetric({ metrics })?.label).toBe(name);
      }
    });

    it("has no metric when no evaluator ran", () => {
      expect(
        defaultMetric({
          metrics: metricsOfRuns([run({ id: "a", createdAt: 1, evaluations: {} })]),
        }),
      ).toBeUndefined();
    });
  });

  describe("when an evaluator reports both a pass flag and a score", () => {
    it("offers it twice, as a pass rate and as an average score", () => {
      const metrics = metricsOfRuns([
        run({
          id: "a",
          createdAt: 1,
          evaluations: { c: { name: "correct", averageScore: 0.7, averagePassed: 0.9 } },
        }),
      ]);
      expect(metrics.map((m) => [m.key, m.kind])).toEqual([
        ["c", "passRate"],
        ["c:score", "score"],
      ]);
    });
  });

  describe("when the person picked a metric", () => {
    const metrics = metricsOfRuns([
      run({ id: "a", createdAt: 1, evaluations: { q: quality(0.4), c: correct(0.9) } }),
    ]);

    it("uses the pick", () => {
      expect(leadMetric({ metrics, chosenKey: "q" })?.label).toBe("quality");
    });

    it("falls back to the default when the picked evaluator is gone", () => {
      expect(leadMetric({ metrics, chosenKey: "removed" })?.label).toBe("correct");
    });
  });
});

describe("given runs in any order", () => {
  it("numbers them oldest first", () => {
    const runs = runsOldestFirst([
      run({ id: "b", createdAt: 20, evaluations: {} }),
      run({ id: "a", createdAt: 10, evaluations: {} }),
    ]);
    expect(runs.map((r) => r.runId)).toEqual(["a", "b"]);
  });
});

describe("given a run's pooled values", () => {
  const metrics = metricsOfRuns([
    run({ id: "a", createdAt: 1, evaluations: { c: correct(0.8234) } }),
  ]);

  it("reads a pass rate in percent to one decimal", () => {
    expect(
      pooledValue(run({ id: "a", createdAt: 1, evaluations: { c: correct(0.8234) } }), metrics[0]!),
    ).toBe(82.3);
  });

  it("has no value for an evaluator the run did not report", () => {
    expect(
      pooledValue(run({ id: "a", createdAt: 1, evaluations: {} }), metrics[0]!),
    ).toBeUndefined();
  });

  it("adds dataset and evaluation cost, and none when neither is reported", () => {
    expect(
      runCost(
        run({
          id: "a",
          createdAt: 1,
          evaluations: {},
          cost: { datasetCost: 0.5, evaluationsCost: 0.25 },
        }),
      ),
    ).toBe(0.75);
    expect(runCost(run({ id: "a", createdAt: 1, evaluations: {} }))).toBeUndefined();
  });
});

describe("given a change between two values", () => {
  /** @scenario A change reads as a short chip about an earlier run */
  it("reads a pass rate, a score and no movement as short chips naming the run", () => {
    expect(describeChange({ delta: 1.3, kind: "passRate", against: 2 })).toMatchObject({
      text: "1.3 pt better",
      against: 2,
    });
    expect(describeChange({ delta: 0.12, kind: "score", against: 2 })).toMatchObject({
      text: "up 0.120",
      against: 2,
    });
    expect(describeChange({ delta: 0, kind: "score", against: 2 })).toMatchObject({
      text: "no change",
      against: 2,
    });
  });

  it("says a pass rate change in points, better or worse", () => {
    expect(describeChange({ delta: 1.34, kind: "passRate", against: 2 })).toEqual({
      text: "1.3 pt better",
      tone: "good",
      against: 2,
    });
    expect(describeChange({ delta: -2, kind: "passRate", against: 1 })).toEqual({
      text: "2.0 pt worse",
      tone: "bad",
      against: 1,
    });
  });

  it("calls a move under half a point no change", () => {
    expect(describeChange({ delta: 0.4, kind: "passRate", against: 1 })).toEqual({
      text: "no change",
      tone: "flat",
      against: 1,
    });
  });

  it("never judges a score, only up or down", () => {
    expect(describeChange({ delta: -0.12, kind: "score", against: 1 })).toEqual({
      text: "down 0.120",
      tone: "flat",
      against: 1,
    });
    expect(describeChange({ delta: 0.12, kind: "score", against: 3 }).text).toBe("up 0.120");
  });
});

describe("given the list query's own summary of the latest run", () => {
  it("reads a pass rate in percent", () => {
    const headline = headlineFromList({
      name: "correct",
      averageScore: 0.8,
      averagePassed: 0.8234,
    });
    expect([headline?.metric.kind, headline?.metric.label, headline?.value]).toEqual([
      "passRate",
      "correct",
      82.3,
    ]);
  });

  it("reads a score when there is no pass flag, and nothing without either", () => {
    expect(headlineFromList({ name: "quality", averageScore: 3.5 })?.value).toBe(3.5);
    expect(headlineFromList({ name: "quality", averageScore: null })).toBeUndefined();
    expect(headlineFromList(null)).toBeUndefined();
  });
});

describe("given runs where the run before has no value", () => {
  const runs = [
    run({ id: "a", createdAt: 1, evaluations: { c: correct(0.5) } }),
    run({ id: "b", createdAt: 2, evaluations: {} }),
    run({ id: "c", createdAt: 3, evaluations: { c: correct(0.7) } }),
  ];
  const metric = metricsOfRuns(runs)[0]!;

  it("compares with the previous run that has one, as the headline does", () => {
    const change = changeOfRun({ runs, index: 2, metric });
    expect(change?.againstRunNumber).toBe(1);
    expect(change?.delta).toBeCloseTo(20);
    expect(summariseResult({ runs, metric })?.change).toEqual(change);
  });

  it("has no change for a run without a value, or without an earlier one", () => {
    expect(changeOfRun({ runs, index: 1, metric })).toBeUndefined();
    expect(changeOfRun({ runs, index: 0, metric })).toBeUndefined();
  });
});

describe("given the runs of one experiment", () => {
  const metrics = metricsOfRuns([
    run({ id: "a", createdAt: 1, evaluations: { c: correct(0.8), q: quality(1) } }),
  ]);
  const pass = metrics[0]!;
  const runs = [
    run({ id: "a", createdAt: 1, evaluations: { c: correct(0.8) } }),
    run({ id: "b", createdAt: 2, evaluations: { c: correct(0.9) } }),
    run({ id: "c", createdAt: 3, evaluations: {} }),
  ];

  it("heads with the newest scored run and its change from the scored run before", () => {
    const result = summariseResult({ runs, metric: pass })!;
    expect(result.value).toBe(90);
    expect(result.runNumber).toBe(2);
    expect(result.change?.againstRunNumber).toBe(1);
    expect(result.change?.delta).toBeCloseTo(10);
  });

  it("names the newer run that has no score", () => {
    expect(summariseResult({ runs, metric: pass })?.newerRunNumber).toBe(3);
  });

  it("has no headline when no run scored the metric", () => {
    expect(summariseResult({ runs: [runs[2]!], metric: pass })).toBeUndefined();
  });

  it("formats a pass rate with a percent sign and a score with its own precision", () => {
    expect(formatMetricValue(pass, 90)).toBe("90.0%");
    expect(formatMetricValue(metrics[1]!, 0.91423)).toBe("0.914");
  });
});

describe("given a measurement named with units or spaces", () => {
  /** @scenario A real score is not mistaken for a measurement */
  it("skips response_time and Latency (ms) as defaults, but keeps real scores", () => {
    for (const name of [
      "response_time",
      "Latency (ms)",
      "Response Time",
      "duration_s",
      "Cost (USD)",
    ]) {
      const metrics = metricsOfRuns([
        run({
          id: "a",
          createdAt: 1,
          evaluations: {
            a: { name, averageScore: 5 },
            x: { name: "token_overlap", averageScore: 0.4 },
          },
        }),
      ]);
      expect(defaultMetric({ metrics })?.label).toBe("token_overlap");
    }
  });
});

describe("given the list's own first evaluator", () => {
  const metrics = metricsOfRuns([
    run({
      id: "a",
      createdAt: 1,
      evaluations: { c: correct(0.9), l: latency(900), q: quality(0.4) },
    }),
  ]);

  it("leads with it, matched by name and kind, so a closed and an open row agree", () => {
    expect(
      defaultMetric({ metrics, listPrimary: { name: "quality", averageScore: 0.4 } })?.label,
    ).toBe("quality");
  });

  it("falls back to the rule when the runs do not carry it", () => {
    expect(defaultMetric({ metrics, listPrimary: { name: "gone", averageScore: 1 } })?.label).toBe(
      "correct",
    );
  });

  it("still lets the person's pick win", () => {
    expect(
      leadMetric({
        metrics,
        chosenKey: "q",
        listPrimary: { name: "latency_ms", averageScore: 900 },
      })?.label,
    ).toBe("quality");
  });
});

describe("given the headline of a row", () => {
  const runs = [
    run({ id: "a", createdAt: 1, evaluations: { c: correct(0.5) } }),
    run({ id: "b", createdAt: 2, evaluations: { c: correct(0.7) } }),
  ];
  const metric = metricsOfRuns(runs)[0]!;
  const listPrimary = { name: "correct", averageScore: 0.7, averagePassed: 0.7 };

  it("reads the same value from fresh runs and from the list, with no change chip data", () => {
    const fromRuns = headlineOf({ runs, metric, listPrimary });
    const fromList = headlineOf({ runs: [], metric: undefined, listPrimary });
    expect([fromRuns?.value, fromRuns?.metric.label]).toEqual([
      fromList?.value,
      fromList?.metric.label,
    ]);
    expect(fromRuns).not.toHaveProperty("change");
  });
});

describe("given cached runs and what the list says", () => {
  const runs = [
    run({ id: "a", createdAt: 1, evaluations: {} }),
    run({ id: "b", createdAt: 2, evaluations: {} }),
  ];

  it("are fresh when the count and the newest start match", () => {
    expect(runsAreFresh({ runs, runsSummary: { count: 2 } })).toBe(true);
    expect(
      runsAreFresh({
        runs,
        runsSummary: { count: 2, latestRun: { timestamps: { createdAt: 2 } } },
      }),
    ).toBe(true);
  });

  it("are stale when a run was added, or the newest run differs", () => {
    expect(runsAreFresh({ runs, runsSummary: { count: 3 } })).toBe(false);
    expect(
      runsAreFresh({
        runs,
        runsSummary: { count: 2, latestRun: { timestamps: { createdAt: 9 } } },
      }),
    ).toBe(false);
  });

  /** @scenario A finished run replaces the partial numbers of a running one */
  it("are stale once the list says the newest run finished and the cache saw it running", () => {
    const running = [runs[0]!, run({ id: "b", createdAt: 2, updatedAt: 5, evaluations: {} })];
    const listed = (timestamps: Record<string, number | null>) => ({
      count: 2,
      latestRun: { timestamps: { createdAt: 2, ...timestamps } },
    });
    expect(runsAreFresh({ runs: running, runsSummary: listed({ finishedAt: null }) })).toBe(true);
    expect(runsAreFresh({ runs: running, runsSummary: listed({ finishedAt: 9 }) })).toBe(false);
    expect(runsAreFresh({ runs: running, runsSummary: listed({ stoppedAt: 9 }) })).toBe(false);
    expect(runsAreFresh({ runs: running, runsSummary: listed({ updatedAt: 9 }) })).toBe(false);
    const finished = [runs[0]!, run({ id: "b", createdAt: 2, finishedAt: 9, evaluations: {} })];
    expect(runsAreFresh({ runs: finished, runsSummary: listed({ finishedAt: 9 }) })).toBe(true);
  });

  it("changes the list stamp when the newest run finishes", () => {
    const before = { count: 2, latestRun: { timestamps: { createdAt: 2, updatedAt: 5 } } };
    const after = { count: 2, latestRun: { timestamps: { createdAt: 2, finishedAt: 9 } } };
    expect(listStampOf(before)).not.toBe(listStampOf(after));
    expect(listStampOf(before)).toBe(listStampOf({ ...before }));
  });

  it("are never fresh when empty", () => {
    expect(runsAreFresh({ runs: [], runsSummary: { count: 0 } })).toBe(false);
  });
});

describe("given runs without a numeric evaluator", () => {
  it("says categories only when evaluators reported, else no scored runs", () => {
    const categorical = run({
      id: "a",
      createdAt: 1,
      evaluations: { k: { name: "label", averageScore: null } },
    });
    expect(noMetricNote([categorical])).toMatch(/No numeric results/);
    expect(noMetricNote([run({ id: "a", createdAt: 1, evaluations: {} })])).toBe(
      "No scored runs yet.",
    );
  });
});

describe("given the reason for the shown metric", () => {
  const correctMetric = metricsOfRuns([
    run({ id: "a", createdAt: 1, evaluations: { c: correct(0.9) } }),
  ])[0]!;

  it("explains the default with its rule", () => {
    const text = metricReason({ metric: correctMetric, fallback: correctMetric, chosen: false });
    expect(text).toContain(DEFAULT_METRIC_RULE);
  });

  it("names the pick and what is shown without it", () => {
    expect(metricReason({ metric: correctMetric, fallback: correctMetric, chosen: true })).toBe(
      "You picked correct for this experiment. Without a pick it shows correct.",
    );
  });

  it("says nothing has scored when there is no metric", () => {
    expect(metricReason({ metric: undefined, fallback: undefined, chosen: false })).toBe(
      "No evaluator has scored this experiment yet.",
    );
  });
});

describe("given an average score of any size", () => {
  it("shows three decimals under 1, two under 100, one under 1,000 and whole numbers above", () => {
    expect([0.914, 3.5, 123.456, 1234.6].map(formatScore)).toEqual([
      "0.914",
      "3.50",
      "123.5",
      "1,235",
    ]);
  });
});

describe("given measurements among the evaluators", () => {
  /** @scenario A real score is not mistaken for a measurement */
  it("does not offer latency or tokens as an average score when anything else exists", () => {
    const metrics = metricsOfRuns([
      run({
        id: "a",
        createdAt: 1,
        evaluations: {
          l: latency(900),
          t: { name: "tokens", averageScore: 4000 },
          q: quality(0.4),
        },
      }),
    ]);
    expect(metrics.map((metric) => metric.label)).toEqual(["quality"]);
  });

  it("offers a measurement only when nothing else exists", () => {
    const metrics = metricsOfRuns([
      run({ id: "a", createdAt: 1, evaluations: { l: latency(900) } }),
    ]);
    expect(metrics.map((metric) => metric.label)).toEqual(["latency_ms"]);
  });

  it("keeps a pass rate named like a measurement", () => {
    const metrics = metricsOfRuns([
      run({
        id: "a",
        createdAt: 1,
        evaluations: { l: { name: "latency_ok", averageScore: null, averagePassed: 0.9 } },
      }),
    ]);
    expect(metrics.map((metric) => metric.kind)).toEqual(["passRate"]);
  });

  it("draws no headline from a list summary that leads with a measurement", () => {
    expect(headlineFromList({ name: "latency_ms", averageScore: 900 })).toBeUndefined();
  });
});

describe("given the menu of the primary metric", () => {
  it("explains itself in one short line", () => {
    expect(metricMenuLine({ only: false })).toBe("Pick the evaluator this row leads with.");
    expect(metricMenuLine({ only: true })).toBe("The only evaluator in this experiment.");
    expect(metricMenuLine({ only: false }).length).toBeLessThan(60);
  });
});

describe("given a run history for the sparkline", () => {
  const metric = { key: "c", evaluatorId: "c", label: "correct", kind: "passRate" } as const;
  const runs = [0.5, 0.6, 0.7, 0.8].map((value, at) =>
    run({ id: `r${at}`, createdAt: at + 1, evaluations: { c: correct(value) } }),
  );

  it("needs three values, and keeps them oldest first", () => {
    expect(sparklineOf({ runs: runs.slice(0, 2), metric })).toEqual([]);
    expect(sparklineOf({ runs, metric })).toEqual([50, 60, 70, 80]);
  });

  it("keeps only the latest twenty runs", () => {
    const many = Array.from({ length: 30 }, (_, at) =>
      run({ id: `m${at}`, createdAt: at + 1, evaluations: { c: correct(0.5) } }),
    );
    expect(sparklineOf({ runs: many, metric })).toHaveLength(20);
  });
});

describe("given a run's progress", () => {
  const running = {
    ...run({ id: "a", createdAt: 1, evaluations: {} }),
    progress: 1024,
    total: 1600,
  };

  it("counts cells for a workbench run only", () => {
    expect(cellProgressOf({ run: running, workbench: true })).toEqual({ done: 1024, total: 1600 });
    expect(cellProgressOf({ run: running, workbench: false })).toBeUndefined();
    expect(cellProgressOf({ run: undefined, workbench: true })).toBeUndefined();
  });
});

describe("given a cost to scan", () => {
  it("shows cents above ten, a thousandth below, whole dollars from a hundred", () => {
    expect([formatUsd(9.284), formatUsd(0.019), formatUsd(128.4), formatUsd(undefined)]).toEqual([
      "$9.28",
      "$0.019",
      "$128",
      "–",
    ]);
  });
});
