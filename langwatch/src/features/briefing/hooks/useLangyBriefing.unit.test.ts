import { describe, expect, it } from "vitest";
import type { SeriesInputType } from "~/server/analytics/registry";
import { buildSeriesName } from "~/server/app-layer/analytics/repositories/_timeseries-row-parser";
import type { TimeseriesBucket } from "~/server/analytics/types";
import type { BriefingReceipt } from "../types";
import {
  buildBriefingReceipts,
  readGroupedSummaryMetric,
  readSummaryMetric,
  type ReceiptSignals,
} from "./useLangyBriefing";

/**
 * `readSummaryMetric` is the load-bearing piece of the home briefing's real
 * analytics: it reads a `getTimeseries` value back out of the `currentPeriod`
 * bucket. The key MUST match how the app-layer wrote it — a drifting key reads
 * 0 (or nothing) and silently shows the wrong number. These tests pin the read
 * to the canonical `buildSeriesName` encoder.
 *
 * Spec: specs/home/langy-briefing.feature
 */
describe("readSummaryMetric", () => {
  // The exact series the briefing sends (with cost, the fullest shape).
  const series: SeriesInputType[] = [
    { metric: "metadata.trace_id", aggregation: "cardinality" },
    { metric: "metadata.thread_id", aggregation: "cardinality" },
    { metric: "performance.total_cost", aggregation: "sum" },
    { metric: "performance.completion_time", aggregation: "median" },
  ];

  const bucketWith = (values: Record<string, number>): TimeseriesBucket => ({
    date: "full",
    ...values,
  });

  describe("given a currentPeriod bucket keyed by buildSeriesName", () => {
    const buckets = [
      bucketWith({
        [buildSeriesName(series[0]!, 0)]: 15,
        [buildSeriesName(series[1]!, 1)]: 5,
        [buildSeriesName(series[2]!, 2)]: 0.0257,
        [buildSeriesName(series[3]!, 3)]: 4300,
      }),
    ];

    it("reads each series' value by its request index", () => {
      expect(
        readSummaryMetric({
          buckets,
          series,
          metric: "metadata.trace_id",
          aggregation: "cardinality",
        }),
      ).toBe(15);
      expect(
        readSummaryMetric({
          buckets,
          series,
          metric: "metadata.thread_id",
          aggregation: "cardinality",
        }),
      ).toBe(5);
      expect(
        readSummaryMetric({
          buckets,
          series,
          metric: "performance.total_cost",
          aggregation: "sum",
        }),
      ).toBe(0.0257);
      expect(
        readSummaryMetric({
          buckets,
          series,
          metric: "performance.completion_time",
          aggregation: "median",
        }),
      ).toBe(4300);
    });

    it("keys the ungrouped read as {index}/{metric}/{aggregation}", () => {
      // Locks the literal format the read depends on.
      expect(buildSeriesName(series[0]!, 0)).toBe(
        "0/metadata.trace_id/cardinality",
      );
    });
  });

  describe("when the series does not carry the requested metric", () => {
    it("returns undefined instead of a wrong index", () => {
      const withoutCost = series.filter(
        (s) => s.metric !== "performance.total_cost",
      );
      const buckets = [
        bucketWith({ [buildSeriesName(withoutCost[0]!, 0)]: 15 }),
      ];
      expect(
        readSummaryMetric({
          buckets,
          series: withoutCost,
          metric: "performance.total_cost",
          aggregation: "sum",
        }),
      ).toBeUndefined();
    });

    it("tracks the shifted index when cost is dropped", () => {
      // Without cost, completion_time moves from index 3 to index 2.
      const withoutCost = series.filter(
        (s) => s.metric !== "performance.total_cost",
      );
      const buckets = [
        bucketWith({ [buildSeriesName(withoutCost[2]!, 2)]: 8400 }),
      ];
      expect(
        readSummaryMetric({
          buckets,
          series: withoutCost,
          metric: "performance.completion_time",
          aggregation: "median",
        }),
      ).toBe(8400);
    });
  });

  describe("when the metric never appears in any bucket", () => {
    it("returns undefined so the cell is omitted, not shown as 0", () => {
      expect(
        readSummaryMetric({
          buckets: [bucketWith({})],
          series,
          metric: "metadata.trace_id",
          aggregation: "cardinality",
        }),
      ).toBeUndefined();
    });

    it("returns undefined when there are no buckets at all", () => {
      expect(
        readSummaryMetric({
          buckets: undefined,
          series,
          metric: "metadata.trace_id",
          aggregation: "cardinality",
        }),
      ).toBeUndefined();
    });
  });

  describe("when the value is spread across multiple buckets", () => {
    it("sums the numeric cells (a no-op passthrough for a single full bucket)", () => {
      const key = buildSeriesName(series[0]!, 0);
      const buckets = [bucketWith({ [key]: 10 }), bucketWith({ [key]: 5 })];
      expect(
        readSummaryMetric({
          buckets,
          series,
          metric: "metadata.trace_id",
          aggregation: "cardinality",
        }),
      ).toBe(15);
    });
  });
});

describe("readGroupedSummaryMetric", () => {
  const series: SeriesInputType[] = [
    { metric: "metadata.trace_id", aggregation: "cardinality" },
  ];
  const key = buildSeriesName(series[0]!, 0);

  it("reads and orders grouped error signals from the analytics response", () => {
    const buckets: TimeseriesBucket[] = [
      {
        date: "full",
        "traces.trace_name": {
          checkout: { [key]: 6 },
          refunds: { [key]: 2 },
        },
      },
    ];

    expect(
      readGroupedSummaryMetric({
        buckets,
        series,
        groupBy: "traces.trace_name",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
      }),
    ).toEqual([
      { value: "checkout", count: 6 },
      { value: "refunds", count: 2 },
    ]);
  });

  it("returns undefined when grouped evidence was not provided", () => {
    expect(
      readGroupedSummaryMetric({
        buckets: [{ date: "full" }],
        series,
        groupBy: "traces.trace_name",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
      }),
    ).toBeUndefined();
  });
});

/**
 * `buildBriefingReceipts` turns current/prior facets into the attention inbox.
 * The assertions pin both prioritization and the no-invented-cause contract.
 *
 * Spec: specs/home/langy-briefing.feature
 */
describe("buildBriefingReceipts", () => {
  const base: ReceiptSignals = {
    slug: "acme",
    currentErrorShapes: [],
    previousErrorShapes: [],
    previousErrorShapesComplete: true,
    sharedTraceNames: [],
    errorTraces: 0,
  };

  const byId = (receipts: BriefingReceipt[], id: string) =>
    receipts.find((r) => r.id === id);

  describe("given a shape absent from the prior window", () => {
    it("leads with the new shape and carries the exact search into both actions", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        currentErrorShapes: [{ value: "Provider rate limit", count: 4 }],
      });
      const item = receipts[0];
      expect(item?.subject).toBe("New error shape");
      // A NEW shape carries no metric tag: the subject already says "New
      // error shape", so the old "new" pill was redundant noise.
      expect(item?.metric).toBeUndefined();
      expect(item?.context?.query).toBe('errorMessage:"Provider rate limit"');
      expect(item?.context?.id).toBe(item?.context?.query);
      expect(item?.link?.href).toContain("/acme/traces#all-traces?");
      expect(item?.askPrompt).toContain("do not claim a root cause");
    });

    it("does not call a shape new when the prior top-N facet was incomplete", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        currentErrorShapes: [{ value: "Provider rate limit", count: 4 }],
        previousErrorShapesComplete: false,
      });

      expect(receipts[0]?.subject).toBe("Repeated error shape");
      expect(receipts[0]?.metric?.text).toBeUndefined();
    });
  });

  describe("given a shape that materially increased", () => {
    it("marks the shape regressed and compares its counts", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        currentErrorShapes: [{ value: "Request timed out", count: 6 }],
        previousErrorShapes: [{ value: "Request timed out", count: 2 }],
      });
      expect(receipts[0]?.subject).toBe("Error shape regressed");
      expect(receipts[0]?.metric?.text).toBe("6 vs 2");
    });
  });

  describe("given volatile ids in otherwise identical errors", () => {
    it("collapses them into one comparable repeated shape", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        currentErrorShapes: [
          {
            value:
              "Job 81349277 failed request 44e8b4cc-2f4c-4ace-ae7f-6b21097271f9",
            count: 2,
          },
          {
            value:
              "Job 81349278 failed request c9b89b28-546c-4530-a487-725aa20c3ea9",
            count: 3,
          },
        ],
        previousErrorShapes: undefined,
        previousErrorShapesComplete: undefined,
      });
      expect(receipts[0]?.subject).toBe("Repeated error shape");
      expect(receipts[0]?.detail).toContain("5 traces");
      expect(receipts[0]?.subject).not.toContain("New");
    });
  });

  describe("given multiple errors with a shared trace name", () => {
    it("surfaces correlation as a signal without claiming it is the cause", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        sharedTraceNames: [{ value: "refund-agent", count: 6 }],
      });
      const shared = receipts.find((item) =>
        item.id.startsWith("shared-trace-name:"),
      );
      expect(shared?.subject).toBe("Shared error signal");
      expect(shared?.detail).toContain("Correlation, not a confirmed cause");
      expect(shared?.context?.query).toBe(
        'status:error AND traceName:"refund-agent"',
      );
    });
  });

  describe("given a meaningful p50 regression", () => {
    it("compares periods instead of promoting the single slowest trace", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        p50Latency: 2_000,
        previousP50Latency: 1_000,
      });
      const latency = byId(receipts, "latency-regression");
      expect(latency?.detail).toContain("100% slower");
      expect(latency?.metric?.text).toBe("2.0s");
      expect(latency?.context?.query).toBe("duration:>2000");
    });

    it("omits small/noisy changes and a latency value with no baseline", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        p50Latency: 1_200,
        previousP50Latency: 1_000,
      });
      expect(byId(receipts, "latency-regression")).toBeUndefined();
      expect(
        byId(
          buildBriefingReceipts({
            ...base,
            p50Latency: 8_000,
            previousP50Latency: undefined,
          }),
          "latency-regression",
        ),
      ).toBeUndefined();
    });
  });

  describe("when errors exist but shape/cause inputs are unavailable", () => {
    it("shows an honest triage fallback linked to the error search", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        currentErrorShapes: undefined,
        previousErrorShapes: undefined,
        errorTraces: 3,
      });
      const fallback = byId(receipts, "errors-unclassified");
      expect(fallback?.detail).toContain("cannot prove a shared error shape");
      expect(fallback?.context?.query).toBe("status:error");
    });
  });

  describe("when many supported signals fire at once", () => {
    it("orders changed errors, shared signals, and latency before repeated noise", () => {
      const receipts = buildBriefingReceipts({
        ...base,
        currentErrorShapes: [
          { value: "New provider failure", count: 4 },
          { value: "Persistent timeout", count: 9 },
          { value: "One-off parse error", count: 1 },
        ],
        previousErrorShapes: [
          { value: "Persistent timeout", count: 8 },
          { value: "One-off parse error", count: 1 },
        ],
        sharedTraceNames: [{ value: "checkout-agent", count: 8 }],
        p50Latency: 2_000,
        previousP50Latency: 1_000,
      });
      expect(receipts).toHaveLength(4);
      expect(receipts.map((item) => item.subject)).toEqual([
        "New error shape",
        "Shared error signal",
        "Latency regressed",
        "Repeated error shape",
      ]);
    });
  });
});
