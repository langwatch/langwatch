/**
 * The workbench page's run path, driven through its own run buttons: a failure
 * here is the page or the run pipeline, not the agent. Pins the rule that a filled
 * column must not report "Waiting on <column>" for verdicts nobody asked to re-run.
 */

import { describe, expect, it } from "vitest";

import { seedComparisonWorkbench } from "./seed-optimization-workbench";
import {
  expectColumnsFilled,
  expectComparisonScored,
  expectRunHasRealScores,
} from "./workbench-assertions";
import { openWorkbenchPage, type WorkbenchPage } from "./workbench-page";

const ROWS = [0, 1, 2, 3];

/** Both prompt columns, each through its own run button: the page has no two-column run. */
async function runBothVariants({
  page,
  targetIds,
}: {
  page: WorkbenchPage;
  targetIds: string[];
}): Promise<void> {
  for (const targetId of targetIds) {
    const run = await page.runColumn(targetId);
    expect(run.status, `running prompt column ${targetId} failed: ${run.failure}`).toBe("success");
  }
  await expectColumnsFilled({ page, targetIds, rows: ROWS.length });
}

describe("The workbench page", () => {
  describe("given a comparison column over two prompt columns", () => {
    describe("when the comparison column is the only column run", () => {
      /** @scenario A run the open page starts covers the columns its comparisons depend on */
      it("seeds the columns it compares and writes a verdict for every row", async () => {
        const seeded = await seedComparisonWorkbench({
          name: "comparison-column",
          rows: ROWS.length,
          carrier: "column-target",
        });
        const page = await openWorkbenchPage({ experimentSlug: seeded.experimentSlug });
        try {
          await runBothVariants({
            page,
            targetIds: [seeded.baselineTargetId, seeded.candidateTargetId],
          });

          // The comparison column alone: both variants' outputs have to be seeded
          // from what the board already holds.
          const comparison = await page.runColumn(seeded.comparisonId);
          expect(
            comparison.status,
            `running the comparison column failed: ${comparison.failure}`,
          ).toBe("success");
          expectComparisonScored({ run: comparison, evaluatorId: seeded.comparisonId });

          expect(comparison.runId, "the run never named itself").toBeDefined();
          await expectRunHasRealScores({
            slug: seeded.experimentSlug,
            runId: comparison.runId!,
          });
        } finally {
          await page.close();
        }
      });
    });
  });

  describe("given a comparison chip over two prompt columns", () => {
    describe("when only one of the compared columns is re-run", () => {
      /** @scenario One column re-run on its own still gets its comparison judged */
      it("seeds the other variant when only one of them runs", async () => {
        const seeded = await seedComparisonWorkbench({
          name: "comparison-chip",
          rows: ROWS.length,
          carrier: "chip-evaluator",
        });
        const page = await openWorkbenchPage({ experimentSlug: seeded.experimentSlug });
        try {
          await runBothVariants({
            page,
            targetIds: [seeded.baselineTargetId, seeded.candidateTargetId],
          });

          // Re-running the candidate alone is the production shape: the chip still
          // judges every variant, and the baseline's saved output is what keeps it
          // from reporting the whole comparison as waiting.
          const rerun = await page.runColumn(seeded.candidateTargetId);
          expect(rerun.status, `re-running the candidate column failed: ${rerun.failure}`).toBe(
            "success",
          );
          expectComparisonScored({ run: rerun, evaluatorId: seeded.comparisonId });
        } finally {
          await page.close();
        }
      });
    });
  });
});
