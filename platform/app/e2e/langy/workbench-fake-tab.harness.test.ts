/**
 * The fake workbench tab's run path, exercised directly.
 *
 * No scenario, no judge, no user simulator, no Langy turn: this drives the same
 * object the live suite attaches to a conversation, so a failure here is the
 * harness or the run pipeline rather than the agent. Run it first, because it
 * validates the shared request builder and the results fold for the price of a
 * handful of model calls.
 *
 * What it pins is the scoped-comparison seeding rule: running one column of a
 * comparison, with the other column's cells already filled, must not make the
 * judge report "Waiting on <column>" over verdicts no one asked to re-run.
 * Both carrier shapes are covered, because both leave the same hole:
 *
 *   - a comparison COLUMN-TARGET run on its own, whose variants are two other
 *     columns;
 *   - a comparison CHIP over two columns, with one of those columns run alone.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run workbench-fake-tab.harness.test.ts --reporter=verbose
 */

import { describe, expect, it } from "vitest";
import { openFakeWorkbenchTab } from "./fake-workbench-tab";
import { seedComparisonWorkbench } from "./seed-optimization-workbench";
import {
  expectColumnsFilled,
  expectComparisonScored,
  expectRunHasRealScores,
} from "./workbench-assertions";

const ROWS = [0, 1, 2, 3];

describe("The fake workbench tab", () => {
  describe("given a comparison column over two prompt columns", () => {
    /** @scenario A run the open page starts covers the columns its comparisons depend on */
    it("seeds the columns it compares and writes a verdict for every row", async () => {
      const seeded = await seedComparisonWorkbench({
        name: "comparison-column",
        rows: ROWS.length,
        carrier: "column-target",
      });
      const tab = await openFakeWorkbenchTab({
        experimentSlug: seeded.experimentSlug,
      });
      try {
        const variants = await tab.runToCompletion({
          type: "target-rows",
          targetIds: [seeded.baselineTargetId, seeded.candidateTargetId],
          rowIndices: ROWS,
        });
        expect(
          variants.status,
          `running both prompt columns failed: ${variants.failure}`,
        ).toBe("success");
        expectColumnsFilled({
          tab,
          targetIds: [seeded.baselineTargetId, seeded.candidateTargetId],
          rows: ROWS.length,
        });

        // The candidate-only run: the comparison column is the only thing in
        // scope, so both variants' outputs have to be seeded from what the
        // board already holds.
        const comparison = await tab.runToCompletion({
          type: "target",
          targetId: seeded.comparisonId,
        });
        expect(
          comparison.status,
          `running the comparison column failed: ${comparison.failure}`,
        ).toBe("success");
        expectComparisonScored({
          run: comparison,
          evaluatorId: seeded.comparisonId,
        });

        expect(comparison.runId, "the run never named itself").toBeDefined();
        await expectRunHasRealScores({
          slug: seeded.experimentSlug,
          runId: comparison.runId!,
        });
      } finally {
        await tab.close();
      }
    });
  });

  describe("given a comparison chip over two prompt columns", () => {
    /** @scenario One column re-run on its own still gets its comparison judged */
    it("seeds the other variant when only one of them runs", async () => {
      const seeded = await seedComparisonWorkbench({
        name: "comparison-chip",
        rows: ROWS.length,
        carrier: "chip-evaluator",
      });
      const tab = await openFakeWorkbenchTab({
        experimentSlug: seeded.experimentSlug,
      });
      try {
        const variants = await tab.runToCompletion({
          type: "target-rows",
          targetIds: [seeded.baselineTargetId, seeded.candidateTargetId],
          rowIndices: ROWS,
        });
        expect(
          variants.status,
          `running both prompt columns failed: ${variants.failure}`,
        ).toBe("success");
        expectColumnsFilled({
          tab,
          targetIds: [seeded.baselineTargetId, seeded.candidateTargetId],
          rows: ROWS.length,
        });

        // Re-running the candidate alone is the production shape: the chip
        // still judges every variant, and the baseline's saved output is what
        // keeps it from reporting the whole comparison as waiting.
        const rerun = await tab.runToCompletion({
          type: "target",
          targetId: seeded.candidateTargetId,
        });
        expect(
          rerun.status,
          `re-running the candidate column failed: ${rerun.failure}`,
        ).toBe("success");
        expectComparisonScored({
          run: rerun,
          evaluatorId: seeded.comparisonId,
        });
      } finally {
        await tab.close();
      }
    });
  });
});
