/**
 * The verdict a comparison returns, and the row-level record it leaves in the
 * batch: winner, tie, inconclusive, and the statuses that pair with them.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  THREE_OUTPUTS,
  comparisonEvaluations,
  createExperiment,
  createHarness,
  originalFetch,
  runComparison,
  type JudgeResponse,
} from "./comparison-harness";

describe("Experiment.compare", () => {
  let harness: ReturnType<typeof createHarness>;
  const previousApiKey = process.env.LANGWATCH_API_KEY;

  beforeEach(() => {
    // Left unset so ensureSetup() stays a no-op; the key is passed explicitly.
    delete process.env.LANGWATCH_API_KEY;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    harness = createHarness();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
  });

  describe("given three targets recorded an output for the row", () => {
    describe("when the row is compared with no options beyond the row", () => {
      /** @scenario "The verdict belongs to the row, not to a target" */
      it("records one row-level verdict carrying no target", async () => {
        const experiment = await createExperiment();

        await runComparison(experiment);

        const recorded = comparisonEvaluations(harness);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({
          name: "comparison",
          evaluator: "langevals/select_best_compare",
          status: "processed",
          index: 0,
          target_id: null,
        });
        expect(recorded[0]!.inputs?.candidates).toEqual([
          { id: "gpt-5-mini" },
          { id: "claude-sonnet-5" },
          { id: "gemini-flash" },
        ]);
      });

      it("keeps the verdict off the row's targets even when compared from inside a target block", async () => {
        const experiment = await createExperiment();

        await experiment.run([{ question: "What is 2 + 2?" }], async ({ index }) => {
          await Promise.all(
            Object.entries(THREE_OUTPUTS).map(([target, output]) =>
              experiment.withTarget(target, () => output)
            )
          );
          await experiment.withTarget("verdict-wrapper", async () => {
            await experiment.compare({ index });
            return null;
          });
        });

        const recorded = comparisonEvaluations(harness);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]!.target_id).toBeNull();
      });
    });

    describe("when the judge picks a winner", () => {
      /** @scenario "The verdict names the winning target" */
      it("names the winner with the registered target name and carries the reasoning", async () => {
        const experiment = await createExperiment();
        harness.respond = () => ({
          status: "processed",
          score: 1,
          label: "claude-sonnet-5",
          details: "It shows the working, the others only state the result.",
        });

        const { verdict } = await runComparison(experiment);

        expect(verdict).toEqual({
          status: "decided",
          winner: "claude-sonnet-5",
          reasoning: "It shows the working, the others only state the result.",
          candidates: ["gpt-5-mini", "claude-sonnet-5", "gemini-flash"],
        });
        expect(comparisonEvaluations(harness)[0]!.label).toBe("claude-sonnet-5");
      });
    });

    describe("when the judge finds no candidate clearly better", () => {
      /** @scenario "The judge may return a tie" */
      it("reports a tie with no winner", async () => {
        const experiment = await createExperiment();
        harness.respond = () => ({
          status: "processed",
          score: 0.5,
          label: "tie",
          details: "All three answer correctly and at the same length.",
        });

        const { verdict } = await runComparison(experiment);

        expect(verdict?.status).toBe("tie");
        expect(verdict?.winner).toBeNull();
        expect(comparisonEvaluations(harness)[0]).toMatchObject({
          status: "processed",
          label: "tie",
        });
      });
    });

    describe("when the two swap-and-reconcile passes disagree", () => {
      /** @scenario "A verdict that flips under order swap is inconclusive" */
      it("reports the row as inconclusive rather than as a tie", async () => {
        const experiment = await createExperiment();
        harness.respond = () => ({
          status: "skipped",
          details:
            "Order-sensitive verdict: original order picked gpt-5-mini; reversed order picked gemini-flash.",
        });

        const { verdict } = await runComparison(experiment);

        expect(verdict?.status).toBe("inconclusive");
        expect(verdict?.winner).toBeNull();
        expect(verdict?.reasoning).toContain("Order-sensitive verdict");

        const recorded = comparisonEvaluations(harness)[0]!;
        expect(recorded.status).toBe("skipped");
        expect(recorded.label).not.toBe("tie");
        expect(recorded.label).toBeNull();
      });
    });
  });

  describe("given every kind of outcome a row can reach", () => {
    describe("when each is compared", () => {
      it("records a batch status that agrees with the verdict it returns", async () => {
        const cases: {
          respond: () => JudgeResponse;
          outputs?: Record<string, unknown>;
          status: string;
          entryStatus: string;
        }[] = [
          {
            respond: () => ({ status: "processed", score: 1, label: "gpt-5-mini" }),
            status: "decided",
            entryStatus: "processed",
          },
          {
            respond: () => ({ status: "processed", score: 0.5, label: "tie" }),
            status: "tie",
            entryStatus: "processed",
          },
          {
            respond: () => ({ status: "skipped", details: "No stable answer." }),
            status: "inconclusive",
            entryStatus: "skipped",
          },
          {
            respond: () => ({ status: "error", details: "Judge exploded." }),
            status: "error",
            entryStatus: "error",
          },
          {
            respond: () => ({ status: "processed", score: 1, label: "gpt-5-mini" }),
            outputs: { ...THREE_OUTPUTS, "claude-sonnet-5": null, "gemini-flash": null },
            status: "skipped",
            entryStatus: "skipped",
          },
        ];

        for (const testCase of cases) {
          harness.loggedEvaluations.length = 0;
          harness.respond = testCase.respond;
          const experiment = await createExperiment();

          const { verdict } = await runComparison(experiment, {
            outputs: testCase.outputs,
          });

          expect(verdict?.status).toBe(testCase.status);
          expect(comparisonEvaluations(harness)[0]!.status).toBe(
            testCase.entryStatus
          );
        }
      });
    });
  });
});
