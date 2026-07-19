/**
 * @vitest-environment node
 *
 * Unit tests for ExecuteEvaluationCommand — evaluator misconfiguration is a
 * skip, not a failure. All deps injected via the constructor; the logger is
 * mocked because the log *level* is the behaviour under test.
 *
 * Covers scenarios from specs/evaluators/evaluator-config-skips.feature:
 * - "Monitor using a provider the project has disabled is skipped"
 * - "Monitor using a provider the project never configured is skipped"
 * - "Misconfiguration is logged at info with a stable kind for alerting"
 * - "Genuine evaluator faults are still reported as errors"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Command } from "../../../../";
import { createTenantId } from "../../../../";
import {
  EvaluatorConfigError,
  EvaluatorExecutionError,
} from "../../../../../app-layer/evaluations/errors";
import type { EvaluationCostRecorder } from "../../../../../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../../../../../app-layer/evaluations/evaluation-execution.service";
import type { MonitorService } from "../../../../../app-layer/monitors/monitor.service";
import { ExecuteEvaluationCommand } from "../executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../../schemas/commands";

const loggerSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => loggerSpies,
}));

function buildCommand(): Command<ExecuteEvaluationCommandData> {
  const tenantId = createTenantId("proj-cfg-1");
  return {
    tenantId,
    data: {
      tenantId: "proj-cfg-1",
      evaluationId: "eval_cfg",
      evaluatorId: "mon_cfg",
      evaluatorType: "openai/moderation",
      evaluatorName: "Test Monitor",
      traceId: "trace_cfg",
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

function buildCommandWithMocks({ thrown }: { thrown: Error }) {
  const monitors = {
    getMonitorById: vi.fn().mockResolvedValue({
      id: "mon_cfg",
      projectId: "proj-cfg-1",
      checkType: "openai/moderation",
      name: "Test Monitor",
      enabled: true,
      sample: 1,
      preconditions: [],
      parameters: {},
      mappings: null,
      level: "trace",
      evaluator: null,
      threadIdleTimeout: null,
    }),
  } as unknown as MonitorService;

  const evaluationExecution = {
    executeForTrace: vi.fn().mockRejectedValue(thrown),
  } as unknown as EvaluationExecutionService;

  const command = new ExecuteEvaluationCommand({
    monitors,
    spanStorage: { getSpansByTraceId: vi.fn().mockResolvedValue([]) },
    traceEvents: { getEventsByTraceId: vi.fn().mockResolvedValue([]) },
    evaluationExecution,
    costRecorder: { recordCost: vi.fn() } as unknown as EvaluationCostRecorder,
    azureSafetyEnvResolver: vi.fn().mockResolvedValue(null),
  });

  return { command };
}

function eventDataOf(events: { data: unknown }[]) {
  return events[0]?.data as unknown as { status: string; details?: string };
}

describe("Feature: Evaluator misconfiguration is a skip, not a failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the project has the provider configured but not enabled", () => {
    describe("when the command handles the evaluation", () => {
      it("emits a skipped event carrying the configure message", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorConfigError("Provider openai is not enabled"),
        });

        const events = await command.handle(buildCommand());

        expect(events).toHaveLength(1);
        expect(eventDataOf(events).status).toBe("skipped");
        expect(eventDataOf(events).details).toBe(
          "Provider openai is not enabled",
        );
      });

      it("does not log at error level", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorConfigError("Provider openai is not enabled"),
        });

        await command.handle(buildCommand());

        expect(loggerSpies.error).not.toHaveBeenCalled();
      });

      it("logs at info with the stable code and identifiers", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorConfigError("Provider openai is not enabled"),
        });

        await command.handle(buildCommand());

        expect(loggerSpies.info).toHaveBeenCalledWith(
          expect.objectContaining({
            code: "evaluator_config_error",
            tenantId: "proj-cfg-1",
            evaluatorId: "mon_cfg",
            traceId: "trace_cfg",
          }),
          expect.stringMatching(/skipping/i),
        );
      });
    });
  });

  describe("given the project never configured the provider", () => {
    describe("when the command handles the evaluation", () => {
      it("emits a skipped event carrying the configure message", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorConfigError(
            "Provider anthropic is not configured",
          ),
        });

        const events = await command.handle(buildCommand());

        expect(eventDataOf(events).status).toBe("skipped");
        expect(eventDataOf(events).details).toBe(
          "Provider anthropic is not configured",
        );
      });
    });
  });

  // Regression guard: EvaluatorExecutionError is ALSO a HandledError, but it
  // means langevals timed out / was unreachable / returned 5xx. Downgrading it
  // to a skip would silently hide an outage, so it must stay an error. A
  // blanket `HandledError.isHandled` check passes every other test in this
  // file and fails only these.
  describe("given langevals is unreachable", () => {
    describe("when the command handles the evaluation", () => {
      it("emits an error event, not a skip", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorExecutionError("Evaluator cannot be reached"),
        });

        const events = await command.handle(buildCommand());

        expect(eventDataOf(events).status).toBe("error");
      });

      it("logs at error level so the outage still pages us", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorExecutionError("Evaluator cannot be reached"),
        });

        await command.handle(buildCommand());

        expect(loggerSpies.error).toHaveBeenCalledTimes(1);
        expect(loggerSpies.info).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the evaluator throws an unexpected error", () => {
    describe("when the command handles the evaluation", () => {
      it("emits an error event", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new Error("connection reset by peer"),
        });

        const events = await command.handle(buildCommand());

        expect(eventDataOf(events).status).toBe("error");
      });

      it("still logs at error level", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new Error("connection reset by peer"),
        });

        await command.handle(buildCommand());

        expect(loggerSpies.error).toHaveBeenCalledTimes(1);
        expect(loggerSpies.info).not.toHaveBeenCalled();
      });
    });
  });
});
