import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";
import { recordBestEffort } from "../scenario-processor.service.ts";

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
      const { logger, lines } = createTestLogger();
      await expect(
        recordBestEffort({ what: "a detail", jobData: JOB, record, jobLogger: logger }),
      ).resolves.toBeUndefined();

      const warned = lines.findLine("warn", "Could not record a detail");
      expect(warned).toMatchObject({
        scenarioRunId: JOB.scenarioRunId,
        projectId: JOB.projectId,
      });
    });
  });
});
