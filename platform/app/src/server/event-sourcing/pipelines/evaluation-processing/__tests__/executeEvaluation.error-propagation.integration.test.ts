/**
 * @vitest-environment node
 *
 * Integration tests for ExecuteEvaluationCommand — error propagation.
 *
 * Covers @integration scenarios from
 * specs/evaluators/evaluator-error-propagation.feature:
 * - "langevals returns status=error with a detail message"
 * - "evaluator throws an exception mid-execution"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Command } from "../../..";
import type { EvaluationCostRecorder } from "../../../../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../../../../app-layer/evaluations/evaluation-execution.service";
import type { MonitorService } from "../../../../app-layer/monitors/monitor.service";
import { createTenantId } from "../../../domain/tenantId";
import { ExecuteEvaluationCommand } from "../commands/executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../schemas/commands";

function buildCommand(
  evaluatorType: string,
): Command<ExecuteEvaluationCommandData> {
  const tenantId = createTenantId("proj-err-1");
  return {
    tenantId,
    data: {
      tenantId: "proj-err-1",
      evaluationId: "eval_err",
      evaluatorId: "mon_err",
      evaluatorType,
      evaluatorName: "Test Monitor",
      traceId: "trace_err",
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
    id: "mon_err",
    projectId: "proj-err-1",
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
  executionResult,
  executionError,
}: {
  executionResult?: Record<string, unknown>;
  executionError?: Error;
}) {
  const monitors = {
    getMonitorById: vi
      .fn()
      .mockResolvedValue(buildMonitor("azure/content_safety")),
  } as unknown as MonitorService;

  const spanStorage = {
    getSpansByTraceId: vi.fn().mockResolvedValue([]),
  };

  const traceEvents = {
    getEventsByTraceId: vi.fn().mockResolvedValue([]),
  };

  const executeForTrace = executionError
    ? vi.fn().mockRejectedValue(executionError)
    : vi.fn().mockResolvedValue(executionResult);

  const evaluationExecution = {
    executeForTrace,
  } as unknown as EvaluationExecutionService;

  const costRecorder = {
    recordCost: vi.fn(),
  } as unknown as EvaluationCostRecorder;

  const azureSafetyEnvResolver = vi.fn().mockResolvedValue({
    AZURE_CONTENT_SAFETY_ENDPOINT: "https://byok.cognitiveservices.azure.com/",
    AZURE_CONTENT_SAFETY_KEY: "byok-key",
  });

  const command = new ExecuteEvaluationCommand({
    monitors,
    spanStorage,
    traceEvents,
    evaluationExecution,
    costRecorder,
    azureSafetyEnvResolver,
  });

  return { command };
}

describe("Feature: ExecuteEvaluationCommand — error propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given langevals returns status=error with a detail message", () => {
    describe("when the command handles the evaluation", () => {
      it("emits status=error with the failure message in the event error field", async () => {
        const failureMessage =
          "Azure Content Safety request failed: Could not connect to https://invalid.cognitiveservices.azure.com/ (ENOTFOUND)";

        const { command } = buildCommandWithMocks({
          executionResult: {
            status: "error",
            details: failureMessage,
          },
        });

        const events = await command.handle(buildCommand("azure/content_safety"));

        expect(events).toHaveLength(1);
        const eventData = events[0]?.data as unknown as {
          status: string;
          error?: string | null;
          details?: string | null;
        };

        expect(eventData.status).toBe("error");
        expect(eventData.error).toBe(failureMessage);
      });

      it("does not lose the failure message when both details and error could carry it", async () => {
        const failureMessage = "Invalid subscription key";

        const { command } = buildCommandWithMocks({
          executionResult: {
            status: "error",
            details: failureMessage,
          },
        });

        const events = await command.handle(buildCommand("azure/content_safety"));

        const eventData = events[0]?.data as unknown as {
          error?: string | null;
          details?: string | null;
        };

        const errorText = eventData.error ?? eventData.details ?? "";
        expect(errorText).toContain("Invalid subscription key");
      });
    });
  });

  describe("given the evaluator throws an exception mid-execution", () => {
    describe("when the command handles the evaluation", () => {
      it("emits status=error with the exception message and stack", async () => {
        const { command } = buildCommandWithMocks({
          executionError: new Error("boom"),
        });

        const events = await command.handle(buildCommand("azure/content_safety"));

        const eventData = events[0]?.data as unknown as {
          status: string;
          error?: string | null;
          errorDetails?: string | null;
        };

        expect(eventData.status).toBe("error");
        expect(eventData.error).toContain("boom");
        expect(eventData.errorDetails).toBeTruthy();
      });
    });
  });
});
