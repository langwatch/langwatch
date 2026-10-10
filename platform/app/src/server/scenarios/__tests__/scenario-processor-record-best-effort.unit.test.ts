/**
 * The one try/catch/log shape shared by every post-exit recorder: a throwing
 * recorder is logged with the run and project ids and never fails the job
 * (#8029).
 */
import { describe, expect, it, vi } from "vitest";

import { recordBestEffort } from "../scenario.processor";

const JOB = {
  projectId: "proj_123",
  scenarioRunId: "scenariorun_test123",
};

describe("recordBestEffort", () => {
  describe("given a recorder that succeeds", () => {
    it("runs it once and resolves", async () => {
      const record = vi.fn().mockResolvedValue(undefined);

      await recordBestEffort({ what: "a detail", jobData: JOB, record });

      expect(record).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a recorder that throws", () => {
    it("swallows the failure so the completed job is never lost", async () => {
      const record = vi.fn().mockRejectedValue(new Error("side channel down"));

      await expect(
        recordBestEffort({ what: "a detail", jobData: JOB, record }),
      ).resolves.toBeUndefined();
    });
  });
});
