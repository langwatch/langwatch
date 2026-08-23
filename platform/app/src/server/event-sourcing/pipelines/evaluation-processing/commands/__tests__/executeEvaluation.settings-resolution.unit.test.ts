/**
 * @vitest-environment node
 *
 * Unit tests for ExecuteEvaluationCommand's evaluator settings + workflowId
 * resolution. Re-homes the coverage that lived in the deleted
 * background/workers/evaluationsWorker.integration.test.ts (see
 * specs/monitors/monitor-execution-backend.feature):
 *
 *   1. evaluator.config.settings takes precedence over monitor.parameters
 *   2. monitor.parameters is the fallback when the monitor has NO evaluator
 *   3. a top-level prompt is recovered rather than dropped (langwatch#6397)
 *   4. an EMPTY settings key does not shadow a recoverable prompt
 *   5. the operator rollback flag, including when it cannot be read
 *   6. workflowId resolves from the evaluator record for workflow evaluators
 *
 * All deps injected via constructor — zero vi.mock calls, no DBs. That property
 * is why AC0d's prevalence-LOG coverage lives in the sibling
 * executeEvaluation.prevalence-report.unit.test.ts instead of here: observing
 * the log needs a module mock, and this file is the one that stays mock-free.
 */

import type { Command } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CODE_EVALUATOR_CONFIG } from "~/server/evaluators/codeEvaluator";
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

function buildDeps({
  monitor,
  isSettingsRecoveryDisabled,
}: {
  monitor: MonitorFixture;
  isSettingsRecoveryDisabled?: () => Promise<boolean>;
}): ExecuteEvaluationCommandDeps {
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
  const deps = buildDeps({ monitor, isSettingsRecoveryDisabled });
  const command = new ExecuteEvaluationCommand(deps);
  await command.handle(buildCommand());
  const executeForTrace = deps.evaluationExecution
    .executeForTrace as ReturnType<typeof vi.fn>;
  expect(executeForTrace).toHaveBeenCalledTimes(1);
  return executeForTrace.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("ExecuteEvaluationCommand settings resolution", () => {
  describe("given a monitor linked to an evaluator with config.settings", () => {
    describe("when the online pipeline executes it for a trace", () => {
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
  });

  describe("given a legacy monitor with no linked evaluator", () => {
    describe("when the online pipeline executes it for a trace", () => {
      /** @scenario A monitor with no evaluator still falls back to its own parameters */
      it("falls back to monitor.parameters", async () => {
        const call = await executeWith(buildMonitor({ evaluator: null }));

        expect(call.settings).toEqual(MONITOR_PARAMETERS);
      });
    });
  });

  describe("given an evaluator whose config has no settings key and nothing to recover", () => {
    describe("when the online pipeline executes it for a trace", () => {
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
  });

  describe("given a config whose settings sit at the top level with no settings key", () => {
    describe("when the online pipeline executes it for a trace", () => {
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
            parameters: {
              prompt: "the stale monitor prompt",
              temperature: 0.5,
            },
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
  });

  describe("given the operator rollback flag", () => {
    describe("when the online pipeline executes it for a trace", () => {
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
  });

  describe("given an EMPTY settings key alongside a top-level prompt", () => {
    describe("when the online pipeline executes it for a trace", () => {
      // `{}` is truthy and an object, so a presence-only check hands the judge an
      // empty payload — the exact input that scored every trace 0. The shape is
      // reachable from the customer's own UI: the evaluator editor loads
      // `settings: config?.settings ?? {}` and saves it back, so the P1 reporter
      // opening their evaluator to CONFIRM the fix would re-break the row.
      /** @scenario An empty settings key does not shadow a recoverable prompt */
      it("recovers the top-level prompt instead of sending the empty object", async () => {
        const call = await executeWith(
          buildMonitor({
            parameters: null,
            evaluator: {
              id: "evaluator_1",
              type: "evaluator",
              config: {
                evaluatorType: "custom/settings-eval",
                settings: {},
                prompt: "the prompt the editor round-trip would have buried",
              },
            },
          }),
        );

        expect(call.settings).toMatchObject({
          prompt: "the prompt the editor round-trip would have buried",
        });
        expect(call.settings).not.toEqual({});
      });

      it("falls back to monitor.parameters when there is nothing to recover", async () => {
        const call = await executeWith(
          buildMonitor({
            evaluator: {
              id: "evaluator_1",
              type: "evaluator",
              config: { evaluatorType: "custom/settings-eval", settings: {} },
            },
          }),
        );

        // Not `{}` — an empty payload is never a legitimate thing to send.
        expect(call.settings).toEqual(MONITOR_PARAMETERS);
      });
    });
  });

  describe("given the rollback flag cannot be read", () => {
    describe("when the online pipeline executes it for a trace", () => {
      const topLevelConfig = {
        id: "evaluator_1",
        type: "evaluator",
        config: {
          evaluatorType: "custom/settings-eval",
          prompt: "the evaluator's own prompt",
        },
      };

      // The flag is resolved BEFORE handle()'s try block, so an unguarded failure
      // escapes the handler entirely — no skipped and no error event for the
      // trace. A safety valve would become a new way for every evaluation to
      // fail. `executeWith` asserts the judge was reached exactly once, so these
      // go red on a throw as well as on a wrong fallback.

      /** @scenario The rollback flag failing to answer leaves recovery active */
      it("stays on the shipped behaviour when the lookup rejects", async () => {
        const call = await executeWith(
          buildMonitor({ evaluator: topLevelConfig }),
          () => Promise.reject(new Error("flag service unreachable")),
        );

        expect(call.settings).toMatchObject({
          prompt: "the evaluator's own prompt",
        });
      });

      it("stays on the shipped behaviour when the lookup throws synchronously", async () => {
        const call = await executeWith(
          buildMonitor({ evaluator: topLevelConfig }),
          () => {
            throw new Error("flag client misconfigured");
          },
        );

        expect(call.settings).toMatchObject({
          prompt: "the evaluator's own prompt",
        });
      });
    });
  });

  describe("given a settings-less config and no monitor parameters", () => {
    describe("when the online pipeline executes it for a trace", () => {
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
  });

  describe("given an evaluator row already stored in the unreadable shape", () => {
    describe("when the online pipeline executes it for a trace", () => {
      /** @scenario An evaluator already stored in the unreadable shape still resolves its prompt */
      it("resolves its prompt at read time, without needing a migration", async () => {
        // Write-side normalisation was tried and reverted (it broke code
        // evaluators), so nothing converts this row. Read-time recovery is the
        // only thing that covers the customer's actual evaluator.
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
  });

  describe("given a code evaluator, whose valid config is top-level by design", () => {
    describe("when the online pipeline executes it for a trace", () => {
      /** @scenario A code evaluator's own config is never mistaken for a lost prompt */
      it("leaves the config alone and falls back to monitor.parameters", async () => {
        const call = await executeWith(
          buildMonitor({
            checkType: "code",
            evaluator: {
              id: "evaluator_code",
              type: "code",
              // The shape the editor seeds and `codeEvaluatorConfigSchema`
              // accepts — imported, not retyped, so a change to the persisted
              // shape reaches this test instead of drifting past it.
              config: DEFAULT_CODE_EVALUATOR_CONFIG,
            },
          }),
        );

        expect(call.settings).toEqual(MONITOR_PARAMETERS);
        expect(call.settings).not.toHaveProperty("code");
      });
    });
  });

  describe("given an evaluator type that did not exist when recovery was written", () => {
    describe("when the online pipeline executes it for a trace", () => {
      // The gate is an ALLOWLIST on purpose, and `type: "code"` alone cannot
      // prove that: `=== "evaluator"` and `!== "code"` agree on every case a
      // code evaluator produces. Only a type outside the current enum
      // separates them, which is exactly the case a fourth evaluator type
      // would create — and it must inherit the safe behaviour rather than a
      // recovery rule written before it existed.
      it("does not recover its config, so a later type inherits the safe path", async () => {
        const call = await executeWith(
          buildMonitor({
            evaluator: {
              id: "evaluator_future",
              type: "some-type-added-later",
              config: { prompt: "not a judge prompt", threshold: 0.8 },
            },
          }),
        );

        expect(call.settings).toEqual(MONITOR_PARAMETERS);
        expect(call.settings).not.toHaveProperty("threshold");
      });
    });
  });

  describe("given a workflow evaluator", () => {
    describe("when the online pipeline executes it for a trace", () => {
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
  });

  describe("given a non-workflow evaluator", () => {
    describe("when the online pipeline executes it for a trace", () => {
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
});
