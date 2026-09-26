import { beforeEach, describe, expect, it } from "vitest";
import { SpanIngestionTally } from "../span-ingestion-tally";
import { traceIngestionSpansTotal } from "../trace-ingestion.metrics";

describe("given no OTLP span has been ingested", () => {
  describe("when the initialized outcome metric is read", () => {
    it("initializes each bounded outcome at zero before any OTLP span", async () => {
      const metric = await traceIngestionSpansTotal.get();
      expect(
        metric.values.map((sample) => [sample.labels.outcome, sample.value]),
      ).toEqual([
        ["collected", 0],
        ["failed", 0],
        ["dropped", 0],
        ["deduped", 0],
        ["filtered", 0],
      ]);
    });
  });
});

describe("OTLP ingestion outcomes", () => {
  beforeEach(() => {
    traceIngestionSpansTotal.reset();
  });

  describe("given collected, skipped and rejected spans", () => {
    describe("when the tally records their outcomes", () => {
      /** @scenario "OTLP partial rejection exposes its cause independently of HTTP status" */
      it("keeps intentional skips out of partial rejection and infrastructure failures distinct", async () => {
        const tally = SpanIngestionTally.create();
        tally.record({ status: "collected" });
        tally.record({ status: "filtered" });
        tally.record({ status: "deduped" });
        tally.record({ status: "dropped", error: "invalid timestamp" });
        tally.record({ status: "failed", error: "Redis unavailable" });
        tally.record({ status: "failed", error: "queue unavailable" });

        expect(tally.toResult()).toEqual({
          rejectedSpans: 3,
          ingestionFailures: 2,
          ingestionFailureMessage: "Redis unavailable; queue unavailable",
          errorMessage:
            "invalid timestamp; Redis unavailable; queue unavailable",
        });
        const metric = await traceIngestionSpansTotal.get();
        expect(metric.values).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              labels: { operation: "otlp_traces", outcome: "collected" },
              value: 1,
            }),
            expect.objectContaining({
              labels: { operation: "otlp_traces", outcome: "failed" },
              value: 2,
            }),
            expect.objectContaining({
              labels: { operation: "otlp_traces", outcome: "dropped" },
              value: 1,
            }),
            expect.objectContaining({
              labels: { operation: "otlp_traces", outcome: "deduped" },
              value: 1,
            }),
            expect.objectContaining({
              labels: { operation: "otlp_traces", outcome: "filtered" },
              value: 1,
            }),
          ]),
        );
        expect(metric.values).toHaveLength(5);
      });
    });
  });

  describe("given an empty OTLP request", () => {
    describe("when its collection tally is read", () => {
      it("does not count an empty request as accepted work", async () => {
        expect(SpanIngestionTally.create().toResult().rejectedSpans).toBe(0);
        const metric = await traceIngestionSpansTotal.get();
        expect(metric.values).toHaveLength(0);
      });
    });
  });
});
