/**
 * What a job that ran to the end records: the connected agent instance that
 * answered it, when one did.
 *
 * Ported from
 * platform/app/src/server/scenarios/__tests__/scenario-processor-agent-instance.unit.test.ts.
 *
 * @see specs/scenarios/served-agent-instance-on-runs.feature
 */
import { ScenarioExecutionService } from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CancellationSubscriberPort } from "../../ports/cancellation-channel.port";
import { ScenarioChildBootstrapPort } from "../../ports/scenario-child-bootstrap.port";
import { ScenarioProcessorServiceMetricsPort } from "../../ports/scenario-processor-metrics.port";
import { ScenarioExecutionPoolService } from "../scenario-execution-pool.service";
import type { ExecutionJobData } from "../scenario-execution-pool.service";
import { ScenarioProcessorService } from "../scenario-processor.service";

const JOB: ExecutionJobData = {
  projectId: "proj_123",
  scenarioId: "scen_456",
  setId: "set_789",
  batchRunId: "batch_abc",
  scenarioRunId: "scenariorun_test123",
  target: { type: "connected", referenceId: "agent_123" },
};

class SilentCancellations extends CancellationSubscriberPort {
  subscribe(): Promise<() => Promise<void>> {
    return Promise.resolve(async () => {});
  }
}

class SilentMetrics extends ScenarioProcessorServiceMetricsPort {
  started(): void {}
  completed(): void {}
  failed(): void {}
}

describe("ScenarioProcessorService.handleSucceeded", () => {
  let recordAgentInstance: ReturnType<typeof vi.fn>;
  let processor: ScenarioProcessorService;

  beforeEach(() => {
    recordAgentInstance = vi.fn().mockResolvedValue(undefined);
    const execution = Object.create(ScenarioExecutionService.prototype) as ScenarioExecutionService;
    execution.recordAgentInstance = recordAgentInstance;
    processor = ScenarioProcessorService.create({
      execution,
      pool: ScenarioExecutionPoolService.create({ concurrency: 1 }),
      cancellations: new SilentCancellations(),
      childProcesses: Object.create(
        ScenarioChildBootstrapPort.prototype,
      ) as ScenarioChildBootstrapPort,
      metrics: new SilentMetrics(),
    });
  });

  describe("when the child named the instance that answered", () => {
    /** @scenario "A job that ran to the end records the instance that served it" */
    it("records it on the run", async () => {
      await processor.handleSucceeded({
        jobData: JOB,
        result: { success: true, agentInstance: { hostname: "worker-1", label: "blue" } },
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
        processor.handleSucceeded({
          jobData: JOB,
          result: { success: true, agentInstance: { hostname: "worker-1", label: null } },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the child named no instance", () => {
    /** @scenario "A job served by no connected agent records nothing" */
    it("records nothing", async () => {
      await processor.handleSucceeded({ jobData: JOB, result: { success: true } });

      expect(recordAgentInstance).not.toHaveBeenCalled();
    });
  });
});
