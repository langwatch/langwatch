/**
 * What a row reports when the judge call fails or the judge itself reports a
 * failure, and how that stays distinct from a judge that reached no verdict.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 */

import { describe, expect, it } from "vitest";
import {
  type ComparisonHarness,
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

  describe("given the judge cannot be reached", () => {
    describe("when the row is compared", () => {
      it("reports an error verdict, records the row as errored, and lets the run finish", async () => {
        const experiment = await createExperiment();
        harness.respond = () => {
          throw new Error("judge unreachable");
        };

        const { verdict, error } = await runComparison(experiment);

        expect(error).toBeUndefined();
        expect(verdict?.status).toBe("error");
        expect(verdict?.winner).toBeNull();
        expect(verdict?.reasoning).toContain("judge unreachable");
        expect(comparisonEvaluations(harness)[0]).toMatchObject({
          status: "error",
          label: null,
          score: null,
        });
      });

      it("keeps a failed judge call distinct from a judge that reached no verdict", async () => {
        const experiment = await createExperiment();
        harness.respond = () => {
          throw new Error("judge unreachable");
        };
        const { verdict: failed } = await runComparison(experiment);

        const second = await createExperiment();
        harness.respond = () => ({
          status: "skipped",
          details: "Order-sensitive verdict.",
        });
        const { verdict: undecided } = await runComparison(second);

        expect(failed?.status).toBe("error");
        expect(undecided?.status).toBe("inconclusive");
      });
    });
  });

  describe("given the judge itself reports a failure", () => {
    describe("when the row is compared", () => {
      it("reports an error verdict carrying the judge's own message", async () => {
        const experiment = await createExperiment();
        harness.respond = () => ({
          status: "error",
          details: "The judge model is not configured for this project.",
        });

        const { verdict, error } = await runComparison(experiment);

        expect(error).toBeUndefined();
        expect(verdict?.status).toBe("error");
        expect(verdict?.reasoning).toBe(
          "The judge model is not configured for this project.",
        );
        expect(comparisonEvaluations(harness)[0]!.status).toBe("error");
      });
    });
  });
});
