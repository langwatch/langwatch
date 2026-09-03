/**
 * Rows where a target produced nothing: who still becomes a candidate, when
 * the row is skipped, and when naming an empty target is an error.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 */

import { describe, it, expect } from "vitest";
import { ComparisonError } from "../errors";
import {
  type ComparisonHarness,
  THREE_OUTPUTS,
  comparisonEvaluations,
  createExperiment,
  runComparison,
  useComparisonHarness,
} from "./comparison-harness";

describe("Experiment.compare", () => {
  let harness: ComparisonHarness;
  useComparisonHarness((created) => {
    harness = created;
  });

  describe("given one of the three targets recorded no output for the row", () => {
    const TWO_OUTPUTS = { ...THREE_OUTPUTS, "gemini-flash": null };

    describe("when the row is compared", () => {
      /** @scenario "Only targets with an output become candidates" */
      it("judges only the targets that produced something", async () => {
        const experiment = await createExperiment();

        const { verdict } = await runComparison(experiment, {
          outputs: TWO_OUTPUTS,
        });

        expect(harness.judgeRequests[0]!.data.candidates.map((candidate) => candidate.id)).toEqual([
          "gpt-5-mini",
          "claude-sonnet-5",
        ]);
        expect(verdict?.candidates).toEqual(["gpt-5-mini", "claude-sonnet-5"]);
      });
    });

    describe("when the row is compared naming that target", () => {
      /** @scenario "Naming a target that produced no output is an error" */
      it("fails with an error naming it, without calling the judge", async () => {
        const experiment = await createExperiment();

        const { error, verdict } = await runComparison(experiment, {
          outputs: TWO_OUTPUTS,
          options: {
            targets: ["gpt-5-mini", "claude-sonnet-5", "gemini-flash"],
          },
        });

        expect(error).toBeInstanceOf(ComparisonError);
        expect((error as ComparisonError).message).toContain("gemini-flash");
        expect((error as ComparisonError).missingTargets).toEqual(["gemini-flash"]);
        expect(verdict).toBeUndefined();
        expect(harness.judgeRequests).toHaveLength(0);
      });
    });
  });

  describe("given only one target recorded an output for the row", () => {
    const ONE_OUTPUT = {
      ...THREE_OUTPUTS,
      "claude-sonnet-5": null,
      "gemini-flash": "",
    };

    describe("when the row is compared", () => {
      /** @scenario "A row with fewer than two outputs is skipped, not failed" */
      it("skips the row, names what was missing, and lets the run finish", async () => {
        const experiment = await createExperiment();

        const { verdict, error } = await runComparison(experiment, {
          outputs: ONE_OUTPUT,
        });

        expect(error).toBeUndefined();
        expect(harness.judgeRequests).toHaveLength(0);
        expect(verdict?.status).toBe("skipped");
        expect(verdict?.winner).toBeNull();
        expect(verdict?.candidates).toEqual(["gpt-5-mini"]);
        expect(verdict?.reasoning).toContain("at least two candidate outputs");
        expect(verdict?.reasoning).toContain("claude-sonnet-5");
        expect(verdict?.reasoning).toContain("gemini-flash");

        const recorded = comparisonEvaluations(harness);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({
          status: "skipped",
          label: null,
          score: null,
          target_id: null,
        });
      });
    });
  });
});
