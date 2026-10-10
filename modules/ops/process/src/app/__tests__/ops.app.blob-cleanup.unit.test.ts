/**
 * A real sweep destroys blobs, so it asks the operator's confirmation; a dry
 * run destroys nothing and does not.
 */
import type { BlobSweepReport, OpsOperator, RunBlobCleanupInput } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { createOpsTestApp, OPS_STAFF_ADDRESS } from "./ops.fixture.ts";

const OPERATOR: OpsOperator = { id: "user_alex", email: OPS_STAFF_ADDRESS };

const EMPTY_SWEEP: BlobSweepReport = {
  queues: [],
  totals: {
    scanned: 0,
    truncated: false,
    leased: 0,
    repaired: 0,
    reclaimed: 0,
    bookkeeping: 0,
    pending: 0,
  },
  dryRun: true,
  durationMs: 0,
};

describe("given an operator sweeping the blob store", () => {
  describe("when the sweep is real and carries no confirmation", () => {
    it("refuses before anything is deleted", async () => {
      const { app } = createOpsTestApp();

      await expect(
        app.runBlobCleanup({ operator: OPERATOR, dryRun: false, requestedBy: OPERATOR.id }),
      ).rejects.toMatchObject({ code: "ops_confirmation_required" });
    });
  });

  describe("when the sweep is a dry run", () => {
    it("runs without asking for the confirmation", async () => {
      const swept: RunBlobCleanupInput[] = [];
      const { app } = createOpsTestApp({
        capability: {
          runBlobCleanup: async (command: RunBlobCleanupInput) => {
            swept.push(command);
            return EMPTY_SWEEP;
          },
        },
      });

      await app.runBlobCleanup({ operator: OPERATOR, dryRun: true, requestedBy: OPERATOR.id });

      expect(swept).toEqual([{ dryRun: true, requestedBy: OPERATOR.id }]);
    });
  });
});
