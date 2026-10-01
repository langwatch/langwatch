/**
 * @vitest-environment node
 * AC0g for langwatch#6397: recovered evaluator settings with unconfigured providers
 * degrade to skipped evaluations via EvaluatorConfigError (fault: "customer").
 * @see langwatch#6397
 */

import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { EvaluationExecutionIntentService as ExecuteEvaluationCommand } from "../services/evaluation-execution-intent.service.ts";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  buildMonitor,
} from "./support/evaluation-execution.fixtures.ts";

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
