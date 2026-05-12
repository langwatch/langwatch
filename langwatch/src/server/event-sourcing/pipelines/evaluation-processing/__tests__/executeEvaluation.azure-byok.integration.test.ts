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

import type { Command } from "../../..";
import type { EvaluationCostRecorder } from "../../../../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../../../../app-layer/evaluations/evaluation-execution.service";
import type { MonitorService } from "../../../../app-layer/monitors/monitor.service";
import { createTenantId } from "../../../domain/tenantId";
import { ExecuteEvaluationCommand } from "../commands/executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../schemas/commands";

const AZURE_EVALUATOR_TYPES = [
  "azure/content_safety",
  "azure/prompt_injection",
  "azure/jailbreak",
] as const;

function buildCommand(
  evaluatorType: string,
): Command<ExecuteEvaluationCommandData> {
  const tenantId = createTenantId("proj-byok-1");
  return {
    tenantId,
    data: {
      tenantId: "proj-byok-1",
      evaluationId: "eval_abc",
      evaluatorId: "mon_1",
      evaluatorType,
      evaluatorName: "Test Monitor",
      traceId: "trace_1",
      isGuardrail: false,
      occurredAt: Date.now(),
      threadIdleTimeout: undefined,
      threadId: undefined,
      userId: undefined,
      customerId: undefined,
      labels: [],
      origin: "application",
      hasError: false,
      promptIds: [],
      topicId: undefined,
      subTopicId: undefined,
      customMetadata: {},
      spanModels: undefined,
      computedInput: undefined,
      computedOutput: undefined,
    },
  } as unknown as Command<ExecuteEvaluationCommandData>;
}

function buildMonitor(checkType: string) {
  return {
    id: "mon_1",
    projectId: "proj-byok-1",
    checkType,
    name: "Test Monitor",
    enabled: true,
    sample: 1,
    preconditions: [],
    parameters: {},
    mappings: null,
    level: "trace",
    evaluator: null,
    threadIdleTimeout: null,
  };
}

function buildCommandWithMocks({
  azureConfigured,
  checkType,
}: {
  azureConfigured: boolean;
  checkType: string;
}) {
  const monitors = {
    getMonitorById: vi.fn().mockResolvedValue(buildMonitor(checkType)),
  } as unknown as MonitorService;

  const spanStorage = {
    getSpansByTraceId: vi.fn().mockResolvedValue([]),
  };

  const traceEvents = {
    getEventsByTraceId: vi.fn().mockResolvedValue([]),
  };

  const evaluationExecution = {
    executeForTrace: vi.fn().mockResolvedValue({
      status: "processed",
      score: 0.1,
      passed: true,
    }),
  } as unknown as EvaluationExecutionService;

  const costRecorder = {
    recordCost: vi.fn(),
  } as unknown as EvaluationCostRecorder;

  const azureSafetyEnvResolver = vi
    .fn()
    .mockResolvedValue(
      azureConfigured
        ? {
            AZURE_CONTENT_SAFETY_ENDPOINT:
              "https://byok.cognitiveservices.azure.com/",
            AZURE_CONTENT_SAFETY_KEY: "byok-key",
          }
        : null,
    );

  const command = new ExecuteEvaluationCommand({
    monitors,
    spanStorage,
    traceEvents,
    evaluationExecution,
    costRecorder,
    azureSafetyEnvResolver,
  });

  return {
    command,
    monitors,
    evaluationExecution,
    azureSafetyEnvResolver,
  };
}

describe("Feature: ExecuteEvaluationCommand — Azure Safety BYOK gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(AZURE_EVALUATOR_TYPES)(
    "given a monitor for %s",
    (evaluatorType) => {
      describe("and the project has NO azure_safety provider configured", () => {
        describe("when the command handles the evaluation", () => {
          it("emits a skipped event with the configure message", async () => {
            const { command } = buildCommandWithMocks({
              azureConfigured: false,
              checkType: evaluatorType,
            });

            const events = await command.handle(buildCommand(evaluatorType));

            expect(events).toHaveLength(1);
            const eventData = events[0]?.data as unknown as {
              status: string;
              details?: string;
            };
            expect(eventData.status).toBe("skipped");
            expect(eventData.details).toMatch(/not configured/i);
            expect(eventData.details).toMatch(/Model Providers/i);
          });

          it("does not call evaluationExecution.executeForTrace", async () => {
            const { command, evaluationExecution } = buildCommandWithMocks({
              azureConfigured: false,
              checkType: evaluatorType,
            });

            await command.handle(buildCommand(evaluatorType));

            expect(
              evaluationExecution.executeForTrace,
            ).not.toHaveBeenCalled();
          });

          it("resolves azure safety env only once", async () => {
            const { command, azureSafetyEnvResolver } = buildCommandWithMocks({
              azureConfigured: false,
              checkType: evaluatorType,
            });

            await command.handle(buildCommand(evaluatorType));

            expect(azureSafetyEnvResolver).toHaveBeenCalledTimes(1);
            expect(azureSafetyEnvResolver).toHaveBeenCalledWith(
              "proj-byok-1",
            );
          });
        });
      });

      describe("and the project has azure_safety configured", () => {
        describe("when the command handles the evaluation", () => {
          it("calls evaluationExecution.executeForTrace", async () => {
            const { command, evaluationExecution } = buildCommandWithMocks({
              azureConfigured: true,
              checkType: evaluatorType,
            });

            await command.handle(buildCommand(evaluatorType));

            expect(evaluationExecution.executeForTrace).toHaveBeenCalledTimes(
              1,
            );
          });
        });
      });
    },
  );

  describe("given a non-azure monitor", () => {
    describe("when the command handles the evaluation", () => {
      it("does not call the azure env resolver", async () => {
        const { command, azureSafetyEnvResolver } = buildCommandWithMocks({
          azureConfigured: false,
          checkType: "openai/moderation",
        });

        await command.handle(buildCommand("openai/moderation"));

        expect(azureSafetyEnvResolver).not.toHaveBeenCalled();
      });
    });
  });
});
