import type { EventingCommandSender } from "@langwatch/eventing";
import type {
  ComputeExperimentRunMetricsCommandData,
  StartExperimentRunInput,
} from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import { ExperimentRunCommandDispatcherService } from "../experiment-run-command-dispatcher.service.ts";

class RecordingSender<Payload> implements EventingCommandSender<Payload> {
  readonly sent: unknown[] = [];

  readonly send = (payload: Payload & Record<string, unknown>): Promise<void> => {
    this.sent.push(payload);
    return Promise.resolve();
  };

  readonly sendBatch = (payloads: (Payload & Record<string, unknown>)[]): Promise<void> => {
    this.sent.push(...payloads);
    return Promise.resolve();
  };

  readonly close = (): Promise<void> => Promise.resolve();

  readonly waitUntilReady = (): Promise<void> => Promise.resolve();
}

function connectedDispatcher() {
  const commands = {
    startExperimentRun: new RecordingSender(),
    recordTargetResult: new RecordingSender(),
    recordEvaluatorResult: new RecordingSender(),
    computeExperimentRunMetrics: new RecordingSender(),
    completeExperimentRun: new RecordingSender(),
  };
  const dispatcher = ExperimentRunCommandDispatcherService.create();
  dispatcher.connect(commands);
  return { dispatcher, commands };
}

const start: StartExperimentRunInput = {
  tenantId: "project_1",
  runId: "run_1",
  experimentId: "experiment_1",
  total: 2,
  targets: [],
  occurredAt: 1_700_000_000_000,
};

const metrics: ComputeExperimentRunMetricsCommandData = {
  tenantId: "project_1",
  runId: "run_1",
  experimentId: "experiment_1",
  traceId: "trace_1",
  totalCost: 0.25,
  occurredAt: 1_700_000_060_000,
};

describe("ExperimentRunCommandDispatcherService", () => {
  describe("when the run pipeline senders are not connected", () => {
    /** @scenario "A run write before the run pipeline is registered refuses by name" */
    it("refuses a run start and a trace cost, naming the pipeline", async () => {
      const dispatcher = ExperimentRunCommandDispatcherService.create();

      await expect(dispatcher.startExperimentRun(start)).rejects.toThrow(
        /experiment_run_processing/,
      );
      await expect(dispatcher.computeRunMetrics(metrics)).rejects.toThrow(
        /experiment_run_processing/,
      );
    });
  });

  describe("when the run pipeline senders are connected", () => {
    /** @scenario "Run writes and a trace's cost go out on the run pipeline's own senders" */
    it("sends each write on its own command's sender, unchanged", async () => {
      const { dispatcher, commands } = connectedDispatcher();

      await dispatcher.startExperimentRun(start);
      await dispatcher.computeRunMetrics(metrics);

      expect(commands.startExperimentRun.sent).toEqual([start]);
      expect(commands.computeExperimentRunMetrics.sent).toEqual([metrics]);
      expect(commands.recordTargetResult.sent).toEqual([]);
      expect(commands.completeExperimentRun.sent).toEqual([]);
    });
  });
});
