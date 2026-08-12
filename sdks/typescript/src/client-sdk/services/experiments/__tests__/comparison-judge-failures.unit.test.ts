/**
 * What a row reports when the judge call fails or the judge itself reports a
 * failure, and how that stays distinct from a judge that reached no verdict.
 *
 * Spec: specs/experiments/comparison-sdk.feature
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  comparisonEvaluations,
  createExperiment,
  createHarness,
  originalFetch,
  runComparison,
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
          "The judge model is not configured for this project."
        );
        expect(comparisonEvaluations(harness)[0]!.status).toBe("error");
      });
    });
  });
});
