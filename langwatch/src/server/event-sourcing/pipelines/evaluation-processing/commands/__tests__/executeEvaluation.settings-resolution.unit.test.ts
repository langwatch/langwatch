/**
 * @vitest-environment node
 *
 * Unit tests for ExecuteEvaluationCommand's evaluator settings + workflowId
 * resolution. Re-homes the coverage that lived in the deleted
 * background/workers/evaluationsWorker.integration.test.ts (see
 * specs/monitors/monitor-execution-backend.feature):
 *
 *   1. evaluator.config.settings takes precedence over monitor.parameters
 *   2. monitor.parameters is the fallback when the monitor has no evaluator
 *   3. monitor.parameters is the fallback when the config lacks a settings key
 *   4. workflowId resolves from the evaluator record for workflow evaluators
 *
 * All deps injected via constructor — zero vi.mock calls, no DBs.
 */

import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../../../";
import type { Command } from "../../../../";
import {
  ExecuteEvaluationCommand,
  type ExecuteEvaluationCommandDeps,
} from "../executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../../schemas/commands";

const EVALUATOR_SETTINGS = { model: "gpt-5-mini", temperature: 0.7 };
const MONITOR_PARAMETERS = { model: "gpt-5-mini", temperature: 0.5 };

type MonitorFixture = Record<string, unknown>;

function buildMonitor(overrides: MonitorFixture = {}): MonitorFixture {
  return {
    id: "monitor_1",
    checkType: "custom/settings-eval",
    level: "trace",
    sample: 1,
    preconditions: [],
    mappings: null,
    parameters: MONITOR_PARAMETERS,
    evaluator: null,
    ...overrides,
  };
}

function buildDeps(monitor: MonitorFixture): ExecuteEvaluationCommandDeps {
  return {
    monitors: {
      getMonitorById: vi.fn().mockResolvedValue(monitor),
    } as unknown as ExecuteEvaluationCommandDeps["monitors"],
    spanStorage: {
      getSpansByTraceId: vi.fn().mockResolvedValue([]),
    },
    traceEvents: {
      getEventsByTraceId: vi.fn().mockResolvedValue([]),
    },
    evaluationExecution: {
      executeForTrace: vi.fn().mockResolvedValue({
        status: "processed",
        score: 1,
        passed: true,
      }),
    } as unknown as ExecuteEvaluationCommandDeps["evaluationExecution"],
    costRecorder: {
      recordCost: vi.fn(),
    } as unknown as ExecuteEvaluationCommandDeps["costRecorder"],
  };
}

function buildCommand(): Command<ExecuteEvaluationCommandData> {
  return {
    tenantId: createTenantId("project_settings"),
    data: {
      tenantId: "project_settings",
      traceId: "trace_1",
      evaluationId: "eval_1",
      evaluatorId: "monitor_1",
      evaluatorType: "custom/settings-eval",
      occurredAt: Date.now(),
    },
  } as unknown as Command<ExecuteEvaluationCommandData>;
}

async function executeWith(monitor: MonitorFixture) {
  const deps = buildDeps(monitor);
  const command = new ExecuteEvaluationCommand(deps);
  await command.handle(buildCommand());
  const executeForTrace = deps.evaluationExecution
    .executeForTrace as ReturnType<typeof vi.fn>;
  expect(executeForTrace).toHaveBeenCalledTimes(1);
  return executeForTrace.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("ExecuteEvaluationCommand settings resolution", () => {
  describe("given a monitor linked to an evaluator with config.settings", () => {
    it("passes evaluator.config.settings, taking precedence over monitor.parameters", async () => {
      const call = await executeWith(
        buildMonitor({
          evaluator: {
            id: "evaluator_1",
            type: "evaluator",
            config: {
              evaluatorType: "custom/settings-eval",
              settings: EVALUATOR_SETTINGS,
            },
          },
        }),
      );

      expect(call.settings).toEqual(EVALUATOR_SETTINGS);
      expect(call.settings).not.toEqual(MONITOR_PARAMETERS);
    });
  });

  describe("given a legacy monitor with no linked evaluator", () => {
    it("falls back to monitor.parameters", async () => {
      const call = await executeWith(buildMonitor({ evaluator: null }));

      expect(call.settings).toEqual(MONITOR_PARAMETERS);
    });
  });

  describe("given an evaluator whose config has no settings key", () => {
    it("falls back to monitor.parameters", async () => {
      const call = await executeWith(
        buildMonitor({
          evaluator: {
            id: "evaluator_1",
            type: "evaluator",
            config: { evaluatorType: "custom/settings-eval" },
          },
        }),
      );

      expect(call.settings).toEqual(MONITOR_PARAMETERS);
    });
  });

  describe("given a workflow evaluator", () => {
    it("resolves workflowId from the evaluator record", async () => {
      const call = await executeWith(
        buildMonitor({
          checkType: "workflow",
          evaluator: {
            id: "evaluator_wf",
            type: "workflow",
            config: {},
            workflowId: "workflow_123",
          },
        }),
      );

      expect(call.workflowId).toBe("workflow_123");
    });
  });

  describe("given a non-workflow evaluator", () => {
    it("passes no workflowId", async () => {
      const call = await executeWith(
        buildMonitor({
          evaluator: {
            id: "evaluator_1",
            type: "evaluator",
            config: {
              evaluatorType: "custom/settings-eval",
              settings: EVALUATOR_SETTINGS,
            },
          },
        }),
      );

      expect(call.workflowId).toBeUndefined();
    });
  });
});
