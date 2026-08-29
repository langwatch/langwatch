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
import { EvaluationExecutionIntentService } from "@langwatch/evaluation-server";
import type { EvaluationExecutionResult } from "@langwatch/evaluation-contract";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  buildMonitor,
} from "../ports/__tests__/support/evaluation-execution.fixtures";

function buildCommandWithMocks({
  executionResult,
  executionError,
}: {
  executionResult?: EvaluationExecutionResult;
  executionError?: Error;
}) {
  const deps = buildExecutionDeps({
    monitor: buildMonitor({
      id: "mon_err",
      projectId: "proj-err-1",
      checkType: "azure/content_safety",
      name: "Test Monitor",
    }),
    executionResult,
    executionError,
    azureCredentials: {
      AZURE_CONTENT_SAFETY_ENDPOINT: "https://byok.cognitiveservices.azure.com/",
      AZURE_CONTENT_SAFETY_KEY: "byok-key",
    },
  });
  const command = EvaluationExecutionIntentService.create(deps);

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

        const events = await command.handle(
          buildExecuteCommand({
            tenantId: "proj-err-1",
            evaluationId: "eval_err",
            evaluatorId: "mon_err",
            evaluatorType: "azure/content_safety",
            traceId: "trace_err",
          }),
        );

        expect(events).toHaveLength(1);
        const event = events[0];
        if (!event || event.type !== "lw.evaluation.reported") {
          throw new Error("expected a reported evaluation event");
        }
        const eventData = event.data;

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

        const events = await command.handle(
          buildExecuteCommand({ evaluatorType: "azure/content_safety" }),
        );

        const event = events[0];
        if (!event || event.type !== "lw.evaluation.reported") {
          throw new Error("expected a reported evaluation event");
        }
        const eventData = event.data;

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

        const events = await command.handle(
          buildExecuteCommand({ evaluatorType: "azure/content_safety" }),
        );

        const event = events[0];
        if (!event || event.type !== "lw.evaluation.reported") {
          throw new Error("expected a reported evaluation event");
        }
        const eventData = event.data;

        expect(eventData.status).toBe("error");
        expect(eventData.error).toContain("boom");
        expect(eventData.errorDetails).toBeTruthy();
      });
    });
  });
});
