/**
 * The daily drift sweep intent: it asks for the checks, then prunes the check's dispatched outbox
 * rows, and a failed prune never fails the sweep.
 * @see modules/data-retention/specs/retention-drift-check.feature
 */
import { describe, expect, it } from "vitest";

import { runRetentionDriftSweep } from "../retention-drift.intent.ts";
import { RETENTION_DRIFT_PROCESS_NAME } from "../retention-drift.process.ts";

const NOW = Date.UTC(2026, 10, 23, 12);
const SCHEDULED_FOR = Date.UTC(2026, 10, 23);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function sweep({ failPrune = false }: { failPrune?: boolean } = {}) {
  const requested: number[] = [];
  const pruned: { processName: string; before: number }[] = [];
  const run = runRetentionDriftSweep({
    request: async ({ at }) => {
      requested.push(at);
      return { requested: 2, failed: 0 };
    },
    deleteDispatchedBefore: async (params) => {
      pruned.push(params);
      if (failPrune) throw new Error("outbox is down");
      return 1;
    },
    now: () => NOW,
  });
  return { run, requested, pruned };
}

describe("runRetentionDriftSweep", () => {
  describe("when the daily drift check wakes", () => {
    /** @scenario "The daily sweep prunes the check's sent outbox rows" */
    it("asks for the checks at the wake's instant and prunes rows dispatched over a week ago", async () => {
      const { run, requested, pruned } = sweep();

      await run({ scheduledFor: SCHEDULED_FOR });

      expect(requested).toEqual([SCHEDULED_FOR]);
      expect(pruned).toEqual([
        { processName: RETENTION_DRIFT_PROCESS_NAME, before: NOW - WEEK_MS },
      ]);
    });
  });

  describe("when pruning the outbox fails", () => {
    /** @scenario "A failed outbox prune does not fail the drift sweep" */
    it("still resolves after trying the prune", async () => {
      const { run, requested, pruned } = sweep({ failPrune: true });

      await expect(run({ scheduledFor: SCHEDULED_FOR })).resolves.toBeUndefined();
      expect(requested).toEqual([SCHEDULED_FOR]);
      expect(pruned).toHaveLength(1);
    });
  });
});
