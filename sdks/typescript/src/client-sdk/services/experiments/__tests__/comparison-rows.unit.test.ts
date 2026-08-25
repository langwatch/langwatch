/**
 * Which row a comparison is about: the one being iterated, one named
 * explicitly, none at all outside a run, and several judged at once.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 */

import { describe, it, expect, vi } from "vitest";
import { ComparisonError } from "../errors";
import type { Experiment } from "../experiment";
import {
  type ComparisonHarness,
  THREE_OUTPUTS,
  comparisonEvaluations,
  createExperiment,
  useComparisonHarness,
} from "./comparison-harness";

describe("Experiment.compare", () => {
  let harness: ComparisonHarness;
  useComparisonHarness((created) => {
    harness = created;
  });

  describe("given a run over several rows, each with its own answer", () => {
    const CITIES = [
      { answer: "Amsterdam" },
      { answer: "Rotterdam" },
      { answer: "Utrecht" },
    ];

    /** Both targets answer with the row's own city, so a verdict about the
     * wrong row is visible in the candidates the judge was shown. */
    const answerEachRow = (experiment: Experiment, item: { answer: string }) =>
      Promise.all([
        experiment.withTarget("gpt-5-mini", () => `${item.answer}.`),
        experiment.withTarget("claude-sonnet-5", () => `The answer is ${item.answer}.`),
      ]);

    describe("when a row is compared without naming it", () => {
      /** @scenario "The row being iterated is the row compared" */
      it("compares the row the iteration is on, one verdict per row", async () => {
        const experiment = await createExperiment();

        await experiment.run(
          CITIES,
          async ({ item }) => {
            await answerEachRow(experiment, item);
            await experiment.compare();
          },
          { concurrency: 3 },
        );

        expect(harness.judgeRequests).toHaveLength(3);
        expect(
          harness.judgeRequests.map((request) => request.data.row_index).sort(),
        ).toEqual([0, 1, 2]);
        for (const request of harness.judgeRequests) {
          const city = CITIES[request.data.row_index!]!.answer;
          for (const candidate of request.data.candidates) {
            expect(candidate.output).toContain(city);
          }
        }
      });
    });

    describe("when a row is compared naming a different one", () => {
      /** @scenario "A row named explicitly is the row compared" */
      it("compares the row named, not the one being iterated", async () => {
        const experiment = await createExperiment();

        await experiment.run(
          CITIES,
          async ({ item, index }) => {
            await answerEachRow(experiment, item);
            if (index === 2) await experiment.compare({ index: 0 });
          },
          { concurrency: 1 },
        );

        expect(harness.judgeRequests).toHaveLength(1);
        const request = harness.judgeRequests[0]!;
        expect(request.data.row_index).toBe(0);
        for (const candidate of request.data.candidates) {
          expect(candidate.output).toContain("Amsterdam");
        }
        expect(comparisonEvaluations(harness)[0]!.index).toBe(0);
      });
    });
  });

  describe("given targets that ran outside any iteration", () => {
    describe("when the row is compared without naming it", () => {
      /** @scenario "Comparing outside an iteration asks which row" */
      it("asks for the row instead of judging whichever one it could reach", async () => {
        const experiment = await createExperiment();
        await experiment.withTarget("gpt-5-mini", () => "Amsterdam.");
        await experiment.withTarget("claude-sonnet-5", () => "The answer is Amsterdam.");

        const error = await experiment.compare().catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ComparisonError);
        expect((error as ComparisonError).message).toContain("Pass index explicitly");
        expect((error as ComparisonError).message).toContain("run()");
        expect(harness.judgeRequests).toHaveLength(0);
      });

      it("judges the row once it is named", async () => {
        const experiment = await createExperiment();
        await experiment.withTarget("gpt-5-mini", () => "Amsterdam.");
        await experiment.withTarget("claude-sonnet-5", () => "The answer is Amsterdam.");

        const verdict = await experiment.compare({ index: 0 });

        expect(verdict.status).toBe("decided");
        expect(harness.judgeRequests[0]!.data.row_index).toBe(0);
      });
    });
  });

  describe("given an experiment iterating rows concurrently", () => {
    describe("when each row awaits its own comparison", () => {
      /** @scenario "Comparing from an async experiment" */
      it("keeps the other rows moving while a judge is thinking, and records each row the same way", async () => {
        const experiment = await createExperiment();
        let release!: () => void;
        harness.gate = new Promise<void>((resolve) => {
          release = resolve;
        });

        const running = experiment.run(
          [{ question: "What is 2 + 2?" }, { question: "What is 3 + 3?" }],
          async ({ index }) => {
            await Promise.all(
              Object.entries(THREE_OUTPUTS).map(([target, output]) =>
                experiment.withTarget(target, () => output),
              ),
            );
            await experiment.compare({ index });
          },
          { concurrency: 2 },
        );

        // Both rows reach the judge before either verdict comes back, which
        // they could not do if awaiting one comparison held the loop.
        await vi.waitFor(() => expect(harness.judgeRequests).toHaveLength(2));
        release();
        await running;

        const recorded = comparisonEvaluations(harness);
        expect(recorded.map((evaluation) => evaluation.index).sort()).toEqual([0, 1]);
        for (const evaluation of recorded) {
          expect(evaluation).toMatchObject({
            evaluator: "langevals/select_best_compare",
            name: "comparison",
            status: "processed",
            target_id: null,
          });
          expect(evaluation.inputs?.candidates).toEqual([
            { id: "gpt-5-mini" },
            { id: "claude-sonnet-5" },
            { id: "gemini-flash" },
          ]);
        }
      });
    });
  });
});
