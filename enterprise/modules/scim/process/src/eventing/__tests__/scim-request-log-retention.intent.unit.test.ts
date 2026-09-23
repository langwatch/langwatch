// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: specs/identity/scim-request-log.feature */
import { describe, expect, it, vi } from "vitest";

import {
  runScimRequestLogRetention,
  SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
} from "../scim-request-log-retention.intent.ts";

const NOW_MS = 1_790_000_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

describe("runScimRequestLogRetention", () => {
  describe("when the schedule fires", () => {
    /** @scenario "The worker runs the request log's retention sweep on a schedule" */
    it("sweeps once and prunes its own week-old bookkeeping", async () => {
      const sweep = vi.fn(async () => 4);
      const deleteDispatchedBefore = vi.fn(async () => 0);

      await runScimRequestLogRetention({ sweep, deleteDispatchedBefore, now: () => NOW_MS })();

      expect(sweep).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
        before: NOW_MS - WEEK_MS,
      });
    });

    /** @scenario "The worker runs the request log's retention sweep on a schedule" */
    it("does not fail the sweep when pruning its bookkeeping fails", async () => {
      const sweep = vi.fn(async () => 0);
      const deleteDispatchedBefore = vi.fn(async () => {
        throw new Error("process store unavailable");
      });

      await expect(
        runScimRequestLogRetention({ sweep, deleteDispatchedBefore, now: () => NOW_MS })(),
      ).resolves.toBeUndefined();
      expect(sweep).toHaveBeenCalledTimes(1);
    });
  });
});
