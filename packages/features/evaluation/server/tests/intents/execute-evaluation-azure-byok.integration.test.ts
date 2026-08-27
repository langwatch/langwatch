/**
 * @vitest-environment node
 *
 * Integration tests for ExecuteEvaluationCommand — Azure Safety BYOK gate.
 *
 * Covers @integration scenarios from specs/evaluators/azure-safety-byok-gating.feature:
 * - "ON_MESSAGE monitor using azure/content_safety without provider emits skipped"
 * - "ON_MESSAGE monitor using azure/prompt_injection without provider emits skipped"
 * - "ON_MESSAGE monitor using azure/jailbreak without provider emits skipped"
 * - "Configured Azure provider passes keys to langevals at runtime"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationExecutionIntentService } from "@langwatch/evaluation-server";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  buildMonitor,
} from "../support/evaluation-execution.fixtures";

const AZURE_EVALUATOR_TYPES = [
  "azure/content_safety",
  "azure/prompt_injection",
  "azure/jailbreak",
] as const;

function buildCommand(evaluatorType: string) {
  return buildExecuteCommand({
    tenantId: "proj-byok-1",
    evaluationId: "eval_abc",
    evaluatorId: "mon_1",
    evaluatorType,
    traceId: "trace_1",
  });
}

function buildCommandWithMocks({
  azureConfigured,
  checkType,
}: {
  azureConfigured: boolean;
  checkType: string;
}) {
  const deps = buildExecutionDeps({
    monitor: buildMonitor({
      id: "mon_1",
      projectId: "proj-byok-1",
      checkType,
      name: "Test Monitor",
    }),
    azureCredentials: azureConfigured
      ? {
          AZURE_CONTENT_SAFETY_ENDPOINT: "https://byok.cognitiveservices.azure.com/",
          AZURE_CONTENT_SAFETY_KEY: "byok-key",
        }
      : null,
  });
  const command = EvaluationExecutionIntentService.create(deps);

  return {
    command,
    evaluations: deps.evaluations,
    azureSafetyCredentials: deps.azureSafetyCredentials.tryGetForTenant,
  };
}

describe("Feature: ExecuteEvaluationCommand — Azure Safety BYOK gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(AZURE_EVALUATOR_TYPES)("given a monitor for %s", (evaluatorType) => {
    describe("and the project has NO azure_safety provider configured", () => {
      describe("when the command handles the evaluation", () => {
        it("emits a skipped event with the configure message", async () => {
          const { command } = buildCommandWithMocks({
            azureConfigured: false,
            checkType: evaluatorType,
          });

          const events = await command.handle(buildCommand(evaluatorType));

          expect(events).toHaveLength(1);
          const event = events[0];
          if (!event || event.type !== "lw.evaluation.reported") {
            throw new Error("expected a reported evaluation event");
          }
          const eventData = event.data;
          expect(eventData.status).toBe("skipped");
          expect(eventData.details).toMatch(/not configured/i);
          expect(eventData.details).toMatch(/Model Providers/i);
        });

        it("does not call evaluations.executeForTrace", async () => {
          const { command, evaluations } = buildCommandWithMocks({
            azureConfigured: false,
            checkType: evaluatorType,
          });

          await command.handle(buildCommand(evaluatorType));

          expect(evaluations.executeForTrace).not.toHaveBeenCalled();
        });

        it("resolves azure safety env only once", async () => {
          const { command, azureSafetyCredentials } = buildCommandWithMocks({
            azureConfigured: false,
            checkType: evaluatorType,
          });

          await command.handle(buildCommand(evaluatorType));

          expect(azureSafetyCredentials).toHaveBeenCalledTimes(1);
          expect(azureSafetyCredentials).toHaveBeenCalledWith({ tenantId: "proj-byok-1" });
        });
      });
    });

    describe("and the project has azure_safety configured", () => {
      describe("when the command handles the evaluation", () => {
        it("calls evaluations.executeForTrace", async () => {
          const { command, evaluations } = buildCommandWithMocks({
            azureConfigured: true,
            checkType: evaluatorType,
          });

          await command.handle(buildCommand(evaluatorType));

          expect(evaluations.executeForTrace).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  describe("given a non-azure monitor", () => {
    describe("when the command handles the evaluation", () => {
      it("does not call the azure env resolver", async () => {
        const { command, azureSafetyCredentials } = buildCommandWithMocks({
          azureConfigured: false,
          checkType: "openai/moderation",
        });

        await command.handle(buildCommand("openai/moderation"));

        expect(azureSafetyCredentials).not.toHaveBeenCalled();
      });
    });
  });
});
