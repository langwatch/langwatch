/**
 * The run's first pass: how it sizes the selection, and what it refuses to do
 * while sizing it.
 *
 * @see ../instant-eval-run.executor.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import type { Mock } from "vitest";
import { describe, expect, it } from "vitest";

import {
  fakes,
  PROJECT_ID,
  RUN_ID,
  rowKey,
} from "./instantEvalRunExecutorFakes";

describe("given a run about to be planned", () => {
  describe("when the plan pass runs", () => {
    /** @scenario "The run's total comes from a count rather than from every key" */
    it("counts the selection one row past the run's own limit", async () => {
      const { executor, rowSource } = fakes({ rowLimit: 10_000 });

      await executor.plan({ runId: RUN_ID, projectId: PROJECT_ID });

      // A count, not a key read: reading a hundred thousand keys to learn the
      // size is past the executor's byte ceiling, and that ceiling truncates
      // silently. One past the limit is what tells a capped run it was capped.
      expect(rowSource.count).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10_001 }),
      );
    });

    /** @scenario "Pass one makes no judgement" */
    it("judges nothing", async () => {
      const { executor, rowSource } = fakes();

      await executor.plan({ runId: RUN_ID, projectId: PROJECT_ID });

      expect(rowSource.read).not.toHaveBeenCalled();
      expect(rowSource.judgePrepared).not.toHaveBeenCalled();
    });

    it("reports the total it found", async () => {
      const { executor } = fakes({
        total: 3,
        keys: [[rowKey("t1"), rowKey("t2"), rowKey("t3")]],
      });

      const plan = await executor.plan({
        runId: RUN_ID,
        projectId: PROJECT_ID,
      });

      expect(plan).toMatchObject({ total: 3, isCapped: false });
    });

    /** @scenario "An estimate over more rows than the cap reports the cap it was bounded to" */
    it("says so when the statement matched more rows than the run may judge", async () => {
      // One past the limit is what the count answers for a capped selection,
      // and the reported total is still the limit rather than the bound.
      const { executor } = fakes({ rowLimit: 100, total: 101 });

      const plan = await executor.plan({
        runId: RUN_ID,
        projectId: PROJECT_ID,
      });

      expect(plan.isCapped).toBe(true);
      expect(plan.total).toBe(100);
    });

    /** @scenario "The average token count comes from a sample rather than from every row" */
    it("measures at most fifty rows of text", async () => {
      const { executor, rowSource } = fakes({
        total: 120,
        keys: [Array.from({ length: 50 }, (_, index) => rowKey(`t${index}`))],
      });

      await executor.plan({ runId: RUN_ID, projectId: PROJECT_ID });

      // The key pass the sample runs asks for fifty, so the text read is
      // bounded before the rows arrive rather than sliced after.
      expect(rowSource.keys).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
      const call = (rowSource.texts as Mock).mock.calls[0]?.[0] as {
        traceIds: string[];
      };
      expect(call.traceIds).toHaveLength(50);
    });
  });
});
