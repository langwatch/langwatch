// @vitest-environment node

/**
 * Leg 6 — an experiment the application defined itself: it initialises a run,
 * logs one row's result, and the platform serves that run back.
 */
import { describe, expect, it } from "vitest";

import { client, platformGet, pollUntil, unique } from "./support/journey";

type RunsPage = { runs?: { run_id?: string; runId?: string }[] };

describe("given an application that runs its own experiment", () => {
  describe("when it initialises a run and logs a result", () => {
    // @scenario "An experiment logs its results and reads them back"
    it("has the platform list that run", async () => {
      const langwatch = client();
      const name = unique("sdk-app-experiment");

      const experiment = await langwatch.experiments.init(name);
      await experiment.run([{ question: "What is a span?" }], async ({ index }) => {
        experiment.log("accuracy", { index, score: 1, passed: true });
      });

      const slug = experiment.experimentSlug;
      const runs = await pollUntil({
        what: `the runs of experiment ${slug}`,
        read: async () => {
          const answer = await platformGet(
            `/api/v1/experiments/runs?experimentSlug=${encodeURIComponent(slug)}`,
          );
          if (answer.status !== 200) return null;
          const page = answer.body as RunsPage;
          return page.runs?.length ? page : null;
        },
        timeoutMs: 90_000,
        intervalMs: 3_000,
      });

      expect(runs.runs?.length).toBeGreaterThan(0);
    }, 180_000);
  });
});
