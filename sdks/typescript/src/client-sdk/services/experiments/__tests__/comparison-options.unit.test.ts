/**
 * The options a caller passes to Experiment.compare(), and the judge settings
 * each one maps onto.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 */

import { describe, it, expect } from "vitest";
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
      /** @scenario "Both SDKs expose the same comparison" */
      it("maps every option onto the judge's own setting names and returns the shared verdict shape", async () => {
        const experiment = await createExperiment();

        const { verdict } = await runComparison(experiment, {
          options: {
            name: "head-to-head",
            input: "What is 2 + 2?",
            golden: "4",
            prompt: "Pick the best of {candidates}",
            model: "openai/gpt-5-mini",
            allowTie: false,
            randomizeOrder: false,
            swapAndReconcile: false,
            includeMetrics: ["duration"],
            temperature: 0.2,
          },
        });

        const request = harness.judgeRequests[0]!;
        expect(request.name).toBe("head-to-head");
        expect(request.settings).toEqual({
          prompt: "Pick the best of {candidates}",
          model: "openai/gpt-5-mini",
          has_golden_answer: true,
          allow_tie: false,
          randomize_order: false,
          swap_and_reconcile: false,
          include_metrics: ["duration"],
          temperature: 0.2,
        });
        expect(Object.keys(request.data).sort()).toEqual([
          "candidates",
          "golden",
          "input",
          "row_index",
        ]);
        expect(Object.keys(verdict!).sort()).toEqual([
          "candidates",
          "reasoning",
          "status",
          "winner",
        ]);
      });
    });

    describe("when the row is compared with a reference answer", () => {
      /** @scenario "Giving a reference answer turns on golden judging" */
      it("sends the reference answer and turns golden judging on from that one option", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment, { options: { golden: "4" } });

        const request = harness.judgeRequests[0]!;
        expect(request.data.golden).toBe("4");
        expect(request.settings.has_golden_answer).toBe(true);
      });
    });

    describe("when the row is compared with a custom judge prompt", () => {
      /** @scenario "The judge prompt can be customized" */
      it("sends that prompt verbatim", async () => {
        const experiment = await createExperiment();
        const prompt = "Rank {candidates} by how well they cite {input}.";

        await runComparison(experiment, { options: { prompt } });

        expect(harness.judgeRequests[0]!.settings.prompt).toBe(prompt);
      });
    });

    describe("when the row is compared with ties disallowed", () => {
      /** @scenario "Options I do set are sent" */
      it("disallows ties in the request", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment, { options: { allowTie: false } });

        expect(harness.judgeRequests[0]!.settings.allow_tie).toBe(false);
      });
    });

    describe("when only two of the three targets are named", () => {
      /** @scenario "Comparing a subset of the registered targets" */
      it("judges exactly the two named", async () => {
        const experiment = await createExperiment();

        const { verdict } = await runComparison(experiment, {
          options: { targets: ["gpt-5-mini", "claude-sonnet-5"] },
        });

        expect(
          harness.judgeRequests[0]!.data.candidates.map((candidate) => candidate.id)
        ).toEqual(["gpt-5-mini", "claude-sonnet-5"]);
        expect(verdict?.candidates).toEqual(["gpt-5-mini", "claude-sonnet-5"]);
      });
    });

    describe("when the same row is compared twice", () => {
      /** @scenario "Candidate order is seeded from the row automatically" */
      it("seeds both calls from the row index, and a different row with a different one", async () => {
        const experiment = await createExperiment();

        await experiment.run(
          [{ question: "What is 2 + 2?" }, { question: "What is 3 + 3?" }],
          async ({ index }) => {
            await Promise.all(
              Object.entries(THREE_OUTPUTS).map(([target, output]) =>
                experiment.withTarget(target, () => output)
              )
            );
            await experiment.compare({ index });
            if (index === 0) await experiment.compare({ index });
          },
          { concurrency: 1 }
        );

        const [first, second, other] = harness.judgeRequests;
        expect(first!.data.row_index).toBe(0);
        expect(second!.data.row_index).toBe(0);
        expect(first!.data.candidates.map((candidate) => candidate.id)).toEqual(
          second!.data.candidates.map((candidate) => candidate.id)
        );
        expect(other!.data.row_index).toBe(1);
      });
    });
  });
});
