/** @see modules/scenario/specs/simulation-service.feature */
import { createTenantId } from "@langwatch/eventing";
import {
  type ComputeRunMetricsCommandData,
  SIMULATION_RUN_COMMAND_TYPES,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsCommand,
} from "../../eventing/compute-run-metrics.commands.ts";
import { SimulationCommandDispatcherService } from "../simulation-command-dispatcher.service.ts";

type RetryOptions = {
  delay: number;
  deduplication: { makeId: (data: ComputeRunMetricsCommandData) => string; ttlMs: number };
};

/** A dispatcher whose computeRunMetrics sender records what it was handed. */
function recordingDispatcher() {
  const sent: { data: ComputeRunMetricsCommandData; options: RetryOptions }[] = [];
  const dispatcher = SimulationCommandDispatcherService.create();
  dispatcher.connect({
    computeRunMetrics: {
      send: async (data: unknown, options?: unknown) => {
        sent.push({ data: data as ComputeRunMetricsCommandData, options: options as RetryOptions });
      },
    },
  });
  return { dispatcher, sent };
}

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

  describe("given simulation_processing registered its senders", () => {
    describe("when a run's metrics retry is scheduled", () => {
      /** @scenario "A metrics retry is the computeRunMetrics command sent after the retry delay" */
      it("sends the payload on computeRunMetrics, delayed and deduplicated per run and trace", async () => {
        const { dispatcher, sent } = recordingDispatcher();

        await dispatcher.scheduleComputeRunMetricsRetry(payload);

        expect(sent).toHaveLength(1);
        const [{ data, options }] = sent as [(typeof sent)[number]];
        expect(data).toEqual(payload);
        expect(options.delay).toBe(COMPUTE_METRICS_RETRY_DELAY_MS);
        expect(options.deduplication.ttlMs).toBe(60_000);
        expect(options.deduplication.makeId({ ...payload, retryCount: 2 })).toBe(
          options.deduplication.makeId(payload),
        );
        expect(options.deduplication.makeId({ ...payload, traceId: "trace-2" })).not.toBe(
          options.deduplication.makeId(payload),
        );
      });
    });

    describe("when computeRunMetrics finds no trace summary yet", () => {
      /** @scenario "A run whose trace is not summarised yet asks for its metrics again" */
      it("sends computeRunMetrics again with the retry count raised and records nothing", async () => {
        const { dispatcher, sent } = recordingDispatcher();
        const handler = ComputeRunMetricsCommand.create({
          traceSummaryStore: { get: async () => ({ kind: "empty" as const }) },
          scheduleRetry: (data) => dispatcher.scheduleComputeRunMetricsRetry(data),
          deriveScenarioRoleMetrics: async () => ({
            scenarioRoleCosts: {},
            scenarioRoleLatencies: {},
          }),
        });

        const events = await handler.handle({
          tenantId: createTenantId(payload.tenantId),
          aggregateId: payload.scenarioRunId,
          type: SIMULATION_RUN_COMMAND_TYPES.COMPUTE_METRICS,
          data: payload,
        });

        expect(events).toEqual([]);
        expect(sent.map(({ data }) => data)).toEqual([{ ...payload, retryCount: 1 }]);
        expect(sent[0]?.options.delay).toBe(COMPUTE_METRICS_RETRY_DELAY_MS);
      });
    });
  });
});
