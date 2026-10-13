/** Spec: specs/identity/org-account-lockout.feature */
import { describe, expect, it, vi } from "vitest";

import { SIGN_IN_LOCK_REAP_PROCESS_NAME, runSignInLockReap } from "../sign-in-lock-reap.intent.ts";

const NOW_MS = 1_790_000_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

describe("runSignInLockReap", () => {
  describe("when the schedule fires", () => {
    /** @scenario "Finished lock-out rows are cleared a day after they settle" */
    it("reaps once and prunes its own week-old bookkeeping", async () => {
      const reap = vi.fn(async () => 2);
      const deleteDispatchedBefore = vi.fn(async () => 0);

      await runSignInLockReap({ reap, deleteDispatchedBefore, now: () => NOW_MS })();

      expect(reap).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: SIGN_IN_LOCK_REAP_PROCESS_NAME,
        before: NOW_MS - WEEK_MS,
      });
    });

    /** @scenario "Finished lock-out rows are cleared a day after they settle" */
    it("still counts the reap done when pruning its bookkeeping fails", async () => {
      const reap = vi.fn(async () => 0);
      const deleteDispatchedBefore = vi.fn(async () => {
        throw new Error("process store unavailable");
      });

      await expect(
        runSignInLockReap({ reap, deleteDispatchedBefore, now: () => NOW_MS })(),
      ).resolves.toBeUndefined();
      expect(reap).toHaveBeenCalledTimes(1);
    });
  });
});
