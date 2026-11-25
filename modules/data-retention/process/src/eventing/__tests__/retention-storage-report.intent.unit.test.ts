/**
 * The daily sweep intent: it asks for the day's measurements, then prunes both processes'
 * dispatched outbox rows, and a failed prune never fails the sweep.
 * @see specs/billing/retention-storage-billing.feature
 */
import { describe, expect, it } from "vitest";

import { runRetentionStorageReportSweep } from "../retention-storage-report.intent.ts";
import {
  RETENTION_STORAGE_BILLING_PROCESS_NAME,
  RETENTION_STORAGE_REPORT_PROCESS_NAME,
} from "../retention-storage-report.process.ts";

const NOW = Date.UTC(2026, 10, 15, 12);
const SCHEDULED_FOR = Date.UTC(2026, 10, 15);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function sweep({ failPrune = false }: { failPrune?: boolean } = {}) {
  const requested: number[] = [];
  const pruned: { processName: string; before: number }[] = [];
  const run = runRetentionStorageReportSweep({
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

describe("runRetentionStorageReportSweep", () => {
  describe("when the daily sweep intent is delivered", () => {
    /** @scenario "The daily sweep prunes both processes' sent outbox rows" */
    it("requests the day's measurements and prunes both processes' rows older than a week", async () => {
      const { run, requested, pruned } = sweep();

      await run({ scheduledFor: SCHEDULED_FOR });

      expect(requested).toEqual([SCHEDULED_FOR]);
      expect(pruned).toEqual([
        { processName: RETENTION_STORAGE_REPORT_PROCESS_NAME, before: NOW - WEEK_MS },
        { processName: RETENTION_STORAGE_BILLING_PROCESS_NAME, before: NOW - WEEK_MS },
      ]);
    });
  });

  describe("when pruning the outbox fails", () => {
    /** @scenario "A failed outbox prune does not fail the daily sweep" */
    it("still tries both processes and resolves", async () => {
      const { run, pruned } = sweep({ failPrune: true });

      await expect(run({ scheduledFor: SCHEDULED_FOR })).resolves.toBeUndefined();
      expect(pruned.map((row) => row.processName)).toEqual([
        RETENTION_STORAGE_REPORT_PROCESS_NAME,
        RETENTION_STORAGE_BILLING_PROCESS_NAME,
      ]);
    });
  });
});
