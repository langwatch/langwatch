/**
 * @vitest-environment node
 *
 * AC0g for langwatch#6397.
 *
 * The D6 fix recovers an evaluator's settings when they were stored at the top
 * level of `config` instead of under `config.settings`. That recovery has a
 * consequence nobody had named: a recovered `model` key now reaches
 * `modelEnvResolver.resolveForEvaluator`, which calls `setupModelEnv`, which
 * THROWS `EvaluatorConfigError` when the named provider is not configured or not
 * enabled. Before the fix those rows resolved to `{}`, `"model" in {}` was false,
 * and `setupModelEnv` never ran — so precisely the rows D6 repairs are the rows
 * that could start failing.
 *
 * This pins the outcome: they degrade to a named `skipped` evaluation, they do
 * not error and they do not throw out of the command on every trace. The
 * mechanism is `EvaluatorConfigError`'s `fault: "customer"` plus the command's
 * `isCustomerFixable` branch — an existing contract, previously unasserted for
 * this path.
 */

import type { Command } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import { EvaluatorConfigError } from "../../../../../app-layer/evaluations/errors";
import type { ExecuteEvaluationCommandData } from "../../schemas/commands";
import {
  ExecuteEvaluationCommand,
  type ExecuteEvaluationCommandDeps,
} from "../executeEvaluation.command";

/** A config in the shape D6 repairs: settings at the top level, no `settings` key. */
const TOP_LEVEL_CONFIG = {
  evaluatorType: "langevals/llm_score",
  prompt: "Score this answer for factual accuracy.",
  model: "unconfigured-provider/some-model",
};

function buildDeps(
  executeForTrace: ReturnType<typeof vi.fn>,
): ExecuteEvaluationCommandDeps {
  return {
    monitors: {
      getMonitorById: vi.fn().mockResolvedValue({
        id: "monitor_1",
        checkType: "langevals/llm_score",
        level: "trace",
        sample: 1,
        preconditions: [],
        mappings: null,
        parameters: null,
        evaluator: {
          id: "evaluator_1",
          type: "evaluator",
          config: TOP_LEVEL_CONFIG,
        },
      }),
    } as unknown as ExecuteEvaluationCommandDeps["monitors"],
    spanStorage: { getSpansByTraceId: vi.fn().mockResolvedValue([]) },
    traceEvents: { getEventsByTraceId: vi.fn().mockResolvedValue([]) },
    evaluationExecution: {
      executeForTrace,
    } as unknown as ExecuteEvaluationCommandDeps["evaluationExecution"],
    costRecorder: {
      recordCost: vi.fn(),
    } as unknown as ExecuteEvaluationCommandDeps["costRecorder"],
  };
}

function buildCommand(): Command<ExecuteEvaluationCommandData> {
  return {
    tenantId: createTenantId("project_ac0g"),
    data: {
      tenantId: "project_ac0g",
      traceId: "trace_1",
      evaluationId: "eval_1",
      evaluatorId: "monitor_1",
      evaluatorType: "langevals/llm_score",
      occurredAt: Date.now(),
    },
  } as unknown as Command<ExecuteEvaluationCommandData>;
}

async function runWith(error: Error) {
  const executeForTrace = vi.fn().mockRejectedValue(error);
  const command = new ExecuteEvaluationCommand(buildDeps(executeForTrace));
  const events = await command.handle(buildCommand());
  return (events as { data?: Record<string, unknown> }[])[0]?.data ?? {};
}

describe("ExecuteEvaluationCommand, given a recovered model naming an unconfigured provider", () => {
  describe("when the provider is not configured", () => {
    /** @scenario A recovered model naming an unconfigured provider degrades rather than erroring */
    it("reports the evaluation as skipped rather than errored", async () => {
      const data = await runWith(
        new EvaluatorConfigError(
          "Provider unconfigured-provider is not configured",
        ),
      );

      expect(data.status).toBe("skipped");
      expect(data.status).not.toBe("error");
    });

    it("carries the reason so the customer can act on it", async () => {
      const data = await runWith(
        new EvaluatorConfigError(
          "Provider unconfigured-provider is not configured",
        ),
      );

      expect(data.details).toContain("not configured");
    });

    it("does not throw out of the command, so the trace is not retried forever", async () => {
      await expect(
        runWith(
          new EvaluatorConfigError("Provider some-provider is not enabled"),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("when the failure is genuinely ours", () => {
    it("still reports an error rather than silently skipping", async () => {
      const data = await runWith(new Error("langevals unreachable"));

      expect(data.status).toBe("error");
    });
  });
});
