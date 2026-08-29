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

import { describe, expect, it } from "vitest";
import { EvaluationExecutionIntentService as ExecuteEvaluationCommand } from "@langwatch/evaluation-server";
import { HandledError } from "@langwatch/handled-error";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  buildMonitor,
} from "../ports/__tests__/support/evaluation-execution.fixtures";

class EvaluatorConfigError extends HandledError {
  constructor(message: string) {
    super("evaluator_config_error", message, { fault: "customer" });
  }
}

/** A config in the shape D6 repairs: settings at the top level, no `settings` key. */
const TOP_LEVEL_CONFIG = {
  evaluatorType: "langevals/llm_score",
  prompt: "Score this answer for factual accuracy.",
  model: "unconfigured-provider/some-model",
};

function buildDeps(error: Error) {
  return buildExecutionDeps({
    monitor: buildMonitor({
      id: "monitor_1",
      projectId: "project_ac0g",
      checkType: "langevals/llm_score",
      name: "Score evaluator",
      evaluatorId: "evaluator_1",
      evaluator: {
        id: "evaluator_1",
        projectId: "project_ac0g",
        name: "Score evaluator",
        slug: "score-evaluator",
        type: "evaluator",
        config: TOP_LEVEL_CONFIG,
        workflowId: null,
        copiedFromEvaluatorId: null,
        archivedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    }),
    executionError: error,
  });
}

function buildCommand() {
  return buildExecuteCommand({
    tenantId: "project_ac0g",
    traceId: "trace_1",
    evaluationId: "eval_1",
    evaluatorId: "monitor_1",
    evaluatorType: "langevals/llm_score",
  });
}

async function runWith(error: Error) {
  const command = ExecuteEvaluationCommand.create(buildDeps(error));
  const events = await command.handle(buildCommand());
  const event = events[0];
  if (!event || event.type !== "lw.evaluation.reported") {
    throw new Error("expected a reported evaluation event");
  }
  return event.data;
}

describe("ExecuteEvaluationCommand, given a recovered model naming an unconfigured provider", () => {
  describe("when the provider is not configured", () => {
    /** @scenario A recovered model naming an unconfigured provider degrades rather than erroring */
    it("reports the evaluation as skipped rather than errored", async () => {
      const data = await runWith(
        new EvaluatorConfigError("Provider unconfigured-provider is not configured"),
      );

      expect(data.status).toBe("skipped");
      expect(data.status).not.toBe("error");
    });

    it("carries the reason so the customer can act on it", async () => {
      const data = await runWith(
        new EvaluatorConfigError("Provider unconfigured-provider is not configured"),
      );

      expect(data.details).toContain("not configured");
    });

    it("does not throw out of the command, so the trace is not retried forever", async () => {
      await expect(
        runWith(new EvaluatorConfigError("Provider some-provider is not enabled")),
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
