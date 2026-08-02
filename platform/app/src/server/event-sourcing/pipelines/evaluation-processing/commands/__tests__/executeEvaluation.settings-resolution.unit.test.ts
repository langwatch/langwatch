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
import type { Command } from "../../../../";
import { createTenantId } from "../../../../";
import type { ExecuteEvaluationCommandData } from "../../schemas/commands";
import {
  ExecuteEvaluationCommand,
  type ExecuteEvaluationCommandDeps,
} from "../executeEvaluation.command";

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

function buildDeps(
  monitor: MonitorFixture,
  isSettingsRecoveryDisabled?: () => Promise<boolean>,
): ExecuteEvaluationCommandDeps {
  return {
    ...(isSettingsRecoveryDisabled ? { isSettingsRecoveryDisabled } : {}),
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

async function executeWith(
  monitor: MonitorFixture,
  isSettingsRecoveryDisabled?: () => Promise<boolean>,
) {
  const deps = buildDeps(monitor, isSettingsRecoveryDisabled);
  const command = new ExecuteEvaluationCommand(deps);
  await command.handle(buildCommand());
  const executeForTrace = deps.evaluationExecution
    .executeForTrace as ReturnType<typeof vi.fn>;
  expect(executeForTrace).toHaveBeenCalledTimes(1);
  return executeForTrace.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("ExecuteEvaluationCommand settings resolution", () => {
  describe("given a monitor linked to an evaluator with config.settings", () => {
    /** @scenario A prompt saved under config.settings reaches the judge */
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
    /** @scenario A monitor with no evaluator still falls back to its own parameters */
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

  describe("given a config whose settings sit at the top level with no settings key", () => {
    /** @scenario A prompt saved at the top level of config still reaches the judge */
    it("recovers them instead of falling through to monitor.parameters", async () => {
      const call = await executeWith(
        buildMonitor({
          evaluator: {
            id: "evaluator_1",
            type: "evaluator",
            config: {
              evaluatorType: "custom/settings-eval",
              prompt: "Score this answer for factual accuracy.",
              model: "gpt-5-mini",
            },
          },
        }),
      );

      expect(call.settings).toMatchObject({
        prompt: "Score this answer for factual accuracy.",
        model: "gpt-5-mini",
      });
    });

    /** @scenario The evaluator's own prompt wins over the monitor's parameters */
    it("prefers the evaluator's recovered config over monitor.parameters", async () => {
      const call = await executeWith(
        buildMonitor({
          parameters: { prompt: "the stale monitor prompt", temperature: 0.5 },
          evaluator: {
            id: "evaluator_1",
            type: "evaluator",
            config: {
              evaluatorType: "custom/settings-eval",
              prompt: "the evaluator's own prompt",
            },
          },
        }),
      );

      expect(call.settings).toMatchObject({
        prompt: "the evaluator's own prompt",
      });
    });

    it("does not leak evaluatorType into the settings sent to the judge", async () => {
      const call = await executeWith(
        buildMonitor({
          evaluator: {
            id: "evaluator_1",
            type: "evaluator",
            config: {
              evaluatorType: "custom/settings-eval",
              prompt: "Score this.",
            },
          },
        }),
      );

      expect(call.settings).not.toHaveProperty("evaluatorType");
    });
  });

  describe("given the operator rollback flag", () => {
    const topLevelConfig = {
      id: "evaluator_1",
      type: "evaluator",
      config: {
        evaluatorType: "custom/settings-eval",
        prompt: "the evaluator's own prompt",
      },
    };

    /** @scenario The new settings resolution is active in the shipped default configuration */
    it("recovers the prompt when nothing sets the flag at all", async () => {
      // No flag dep is passed: this is the SHIPPED default, asserted by OUTCOME
      // (the prompt reaches the judge), not by reading a flag value. A
      // flag-state assertion would pass even if production resolved the flag
      // somewhere else and shipped this fix inert.
      const call = await executeWith(
        buildMonitor({ evaluator: topLevelConfig }),
      );

      expect(call.settings).toMatchObject({
        prompt: "the evaluator's own prompt",
      });
    });

    /** @scenario The new settings resolution can be switched off for rollback */
    it("falls back to the previous behaviour when an operator disables it", async () => {
      const call = await executeWith(
        buildMonitor({ evaluator: topLevelConfig }),
        () => Promise.resolve(true),
      );

      expect(call.settings).toEqual(MONITOR_PARAMETERS);
    });
  });

  describe("given a settings-less config and no monitor parameters", () => {
    /** @scenario A settings-less config never reaches the judge as an empty object */
    it("recovers the evaluator's own settings rather than sending an empty object", async () => {
      const call = await executeWith(
        buildMonitor({
          parameters: null,
          evaluator: {
            id: "evaluator_1",
            type: "evaluator",
            config: {
              evaluatorType: "custom/settings-eval",
              prompt: "Score this answer for factual accuracy.",
            },
          },
        }),
      );

      // The failure this guards is the judge silently applying its OWN default
      // prompt, which is what scored every trace 0. Assert the prompt is present
      // — "the payload is not {}" would pass on a fix that merges defaults while
      // still losing the prompt.
      expect(call.settings).toMatchObject({
        prompt: "Score this answer for factual accuracy.",
      });
    });
  });

  describe("given an evaluator row stored before normalisation existed", () => {
    /** @scenario An evaluator already stored in the unreadable shape still resolves its prompt */
    it("resolves its prompt at read time, without needing a migration", async () => {
      // Write-time normalisation cannot help this row: it was written before the
      // normaliser existed. Read-time recovery is what covers the customer's
      // actual evaluator.
      const call = await executeWith(
        buildMonitor({
          parameters: null,
          evaluator: {
            id: "evaluator_legacy",
            type: "evaluator",
            config: {
              evaluatorType: "custom/settings-eval",
              prompt: "a prompt saved long before the settings key existed",
            },
          },
        }),
      );

      expect(call.settings).toMatchObject({
        prompt: "a prompt saved long before the settings key existed",
      });
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
