/** @see modules/scenario/specs/simulation-service.feature */
import type { ComputeRunMetricsCommandData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { SimulationCommandDispatcherService } from "../simulation-command-dispatcher.service.ts";

const payload: ComputeRunMetricsCommandData = {
  tenantId: "tenant-1",
  scenarioRunId: "run-1",
  traceId: "trace-1",
  retryCount: 0,
  occurredAt: 1_700_000_000_000,
};

describe("SimulationCommandDispatcherService.computeRunMetrics", () => {
  describe("given simulation_processing registered its senders", () => {
    describe("when trace asks for a run's metrics", () => {
      /** @scenario "A settled simulation trace's run metrics are sent onto simulation_processing" */
      it("sends the payload on computeRunMetrics without send options", async () => {
        const sent: { data: unknown; options: unknown }[] = [];
        const dispatcher = SimulationCommandDispatcherService.create();
        dispatcher.connect({
          computeRunMetrics: {
            send: async (data: unknown, options?: unknown) => {
              sent.push({ data, options });
            },
          },
        });

        await dispatcher.computeRunMetrics(payload);

        expect(sent).toEqual([{ data: payload, options: undefined }]);
      });
    });
  });

  describe("given simulation_processing has not registered", () => {
    describe("when trace asks for a run's metrics", () => {
      /** @scenario "Run metrics asked for before simulation_processing registers are refused by name" */
      it("refuses naming the command", async () => {
        const dispatcher = SimulationCommandDispatcherService.create();

        await expect(dispatcher.computeRunMetrics(payload)).rejects.toThrow(
          /its computeRunMetrics command/,
        );
      });
    });
  });
});
