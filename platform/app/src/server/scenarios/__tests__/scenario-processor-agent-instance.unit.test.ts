/**
 * What a job that ran to the end records: the connected agent instance that
 * answered it, when one did.
 *
 * @see specs/scenarios/served-agent-instance-on-runs.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionJobData } from "../execution/execution-pool";
import type { ProcessorDependencies } from "../scenario.processor";
import { handleSucceededJobResult } from "../scenario.processor";

const JOB: ExecutionJobData = {
  projectId: "proj_123",
  scenarioId: "scen_456",
  setId: "set_789",
  batchRunId: "batch_abc",
  scenarioRunId: "scenariorun_test123",
  target: { type: "connected", referenceId: "agent_123" },
};

describe("handleSucceededJobResult", () => {
  let deps: ProcessorDependencies;
  let recordAgentInstance: ReturnType<typeof vi.fn>;
  let recordCutAtLimit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    recordAgentInstance = vi.fn().mockResolvedValue(undefined);
    recordCutAtLimit = vi.fn().mockResolvedValue(undefined);
    deps = {
      scenarioLookup: { getById: vi.fn().mockResolvedValue(null) },
      failureEmitter: {
        ensureFailureEventsEmitted: vi.fn().mockResolvedValue(undefined),
      },
      agentInstanceRecorder: {
        recordAgentInstance:
          recordAgentInstance as ProcessorDependencies["agentInstanceRecorder"]["recordAgentInstance"],
      },
      cutAtLimitRecorder: {
        recordCutAtLimit:
          recordCutAtLimit as ProcessorDependencies["cutAtLimitRecorder"]["recordCutAtLimit"],
      },
    };
  });

  describe("when the child named the instance that answered", () => {
    /** @scenario "A job that ran to the end records the instance that served it" */
    it("records it on the run", async () => {
      await handleSucceededJobResult({
        jobData: JOB,
        result: {
          success: true,
          agentInstance: { hostname: "worker-1", label: "blue" },
        },
        deps,
      });

      expect(recordAgentInstance).toHaveBeenCalledWith({
        projectId: "proj_123",
        scenarioRunId: "scenariorun_test123",
        agentInstance: { hostname: "worker-1", label: "blue" },
      });
    });

    it("does not fail the job when the record cannot be written", async () => {
      recordAgentInstance.mockRejectedValue(new Error("event log down"));

      await expect(
        handleSucceededJobResult({
          jobData: JOB,
          result: {
            success: true,
            agentInstance: { hostname: "worker-1", label: null },
          },
          deps,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the child named no instance", () => {
    /** @scenario "A job served by no connected agent records nothing" */
    it("records nothing", async () => {
      await handleSucceededJobResult({
        jobData: JOB,
        result: { success: true },
        deps,
      });

      expect(recordAgentInstance).not.toHaveBeenCalled();
    });
  });

  describe("when the child cut the call at the limit", () => {
    /** @scenario "A simulated voice run cut at the call limit records the cutoff marker" */
    it("records the cutoff marker on the run", async () => {
      await handleSucceededJobResult({
        jobData: JOB,
        result: { success: true, isCutAtLimit: true },
        deps,
      });

      expect(recordCutAtLimit).toHaveBeenCalledWith({
        projectId: "proj_123",
        scenarioRunId: "scenariorun_test123",
      });
    });

    it("does not fail the job when the marker cannot be written", async () => {
      recordCutAtLimit.mockRejectedValue(new Error("event log down"));

      await expect(
        handleSucceededJobResult({
          jobData: JOB,
          result: { success: true, isCutAtLimit: true },
          deps,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the child did not cut the call at the limit", () => {
    /** @scenario "A simulated voice run that finished normally records no cutoff marker" */
    it("records no cutoff marker", async () => {
      await handleSucceededJobResult({
        jobData: JOB,
        result: { success: true },
        deps,
      });

      expect(recordCutAtLimit).not.toHaveBeenCalled();
    });
  });
});
