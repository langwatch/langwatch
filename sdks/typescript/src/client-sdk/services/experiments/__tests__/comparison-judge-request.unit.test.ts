/**
 * What Experiment.compare() asks the judge for: one call per row, what each
 * candidate carries, and the settings left unset so the judge's own defaults
 * apply.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 */

import { describe, it, expect } from "vitest";
import type { ComparisonMetric } from "../types";
import {
  type ComparisonHarness,
  THREE_OUTPUTS,
  createExperiment,
  runComparison,
  useComparisonHarness,
} from "./comparison-harness";

describe("Experiment.compare", () => {
  let harness: ComparisonHarness;
  useComparisonHarness((created) => {
    harness = created;
  });

  describe("given three targets recorded an output for the row", () => {
    describe("when the row is compared with no options beyond the row", () => {
      /** @scenario "Comparing every target on a row takes one call" */
      it("judges all three outputs in a single call the caller configured nothing for", async () => {
        const experiment = await createExperiment();

        const { verdict } = await runComparison(experiment);

        expect(harness.judgeRequests).toHaveLength(1);
        const request = harness.judgeRequests[0]!;
        expect(request.data.candidates.map((candidate) => candidate.id)).toEqual([
          "gpt-5-mini",
          "claude-sonnet-5",
          "gemini-flash",
        ]);
        expect(request.settings).toEqual({});
        expect(verdict?.candidates).toEqual([
          "gpt-5-mini",
          "claude-sonnet-5",
          "gemini-flash",
        ]);
      });

      it("judges outputs the batch already sent and cleared", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        // The batch is flushed on a timer, so by the time a row is compared
        // its target outputs can already be gone from it. They are judged
        // anyway, which is only possible because they are held elsewhere.
        const flushedBeforeJudging = harness.requestOrder.indexOf("batch");
        expect(flushedBeforeJudging).toBeGreaterThanOrEqual(0);
        expect(flushedBeforeJudging).toBeLessThan(
          harness.requestOrder.indexOf("judge")
        );
        expect(harness.loggedDatasetTargets.flat()).toEqual(
          expect.arrayContaining(Object.keys(THREE_OUTPUTS))
        );
        expect(
          harness.judgeRequests[0]!.data.candidates.map((candidate) => candidate.id)
        ).toEqual(Object.keys(THREE_OUTPUTS));
      });

      /** @scenario "Judging on merits is the default" */
      it("sends no reference answer and does not turn golden judging on", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        const request = harness.judgeRequests[0]!;
        expect("golden" in request.data).toBe(false);
        expect("has_golden_answer" in request.settings).toBe(false);
      });

      /** @scenario "The SDK does not ship its own copy of the judge prompt" */
      it("sends no prompt so the judge picks the default that fits the row", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        expect("prompt" in harness.judgeRequests[0]!.settings).toBe(false);
      });

      /** @scenario "Unset options are not sent" */
      it("omits every setting the caller did not set", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        expect(Object.keys(harness.judgeRequests[0]!.settings)).toEqual([]);
      });
    });

    describe("when the row is compared asking for per-candidate metrics", () => {
      /** @scenario "Duration is the only per-candidate metric on offer" */
      it("shows the judge how long each candidate took, and never a cost", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment, {
          options: { includeMetrics: ["duration"] },
        });

        const request = harness.judgeRequests[0]!;
        expect(request.settings.include_metrics).toEqual(["duration"]);
        for (const candidate of request.data.candidates) {
          expect(typeof candidate.duration).toBe("number");
          expect(candidate.duration).toBeGreaterThanOrEqual(0);
          expect("cost" in candidate).toBe(false);
        }

        // The option cannot ask for one either, so nothing can request a
        // metric the SDK has no value to fill.
        // @ts-expect-error cost is not a comparison metric
        const unsupported: ComparisonMetric[] = ["cost"];
        expect(unsupported).toEqual(["cost"]);
      });
    });
  });

  describe("given a target returned its response wrapped in an output field", () => {
    describe("when the row is compared", () => {
      it("shows the judge the same text as the target that returned the response itself", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment, {
          outputs: {
            "gpt-5-mini": "Four.",
            "claude-sonnet-5": { output: "Four." },
            "gemini-flash": { answer: "Four.", confidence: 0.9 },
          },
        });

        expect(
          harness.judgeRequests[0]!.data.candidates.map(
            (candidate) => candidate.output
          )
        ).toEqual(["Four.", "Four.", '{"answer":"Four.","confidence":0.9}']);
      });
    });
  });
});
