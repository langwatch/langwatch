/**
 * @vitest-environment node
 *
 * Unit tests for ExecuteEvaluationCommand — evaluator misconfiguration is a
 * skip, not a failure. All deps injected via the constructor; the logger is
 * mocked because the log *level* is the behaviour under test.
 *
 * Scenarios from specs/evaluators/evaluator-config-skips.feature are bound
 * individually via the `@scenario` annotations below.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationExecutionIntentService } from "@langwatch/evaluation-server";
import type { EvaluationProcessingEvent } from "@langwatch/evaluation-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  buildMonitor,
} from "../support/evaluation-execution.fixtures";

class EvaluatorConfigError extends HandledError {
  constructor(message: string) {
    super("evaluator_config_error", message, { fault: "customer" });
  }
}

class EvaluatorInputTooLargeError extends HandledError {
  constructor() {
    super("evaluator_input_too_large", "Evaluator input is too large — shorten the text", {
      fault: "customer",
    });
  }
}

class EvaluatorExecutionError extends HandledError {
  constructor(message: string) {
    super("evaluator_execution_error", message, { fault: "platform" });
  }
}

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

function buildCommandWithMocks({ thrown }: { thrown: Error }) {
  const deps = buildExecutionDeps({
    monitor: buildMonitor({
      id: "mon_cfg",
      projectId: "proj-cfg-1",
      checkType: "openai/moderation",
      name: "Test Monitor",
      slug: "test-monitor",
    }),
    executionError: thrown,
  });
  const command = EvaluationExecutionIntentService.create(deps);

  return { command };
}

function eventDataOf(events: EvaluationProcessingEvent[]) {
  const event = events[0];
  if (!event || event.type !== "lw.evaluation.reported") {
    throw new Error("expected a reported evaluation event");
  }
  return event.data;
}

/*
 * Keep the test command complete at the eventing boundary. In particular,
 * aggregateId and type are required by Command even though this handler only
 * consumes data.
 */
function buildCommand() {
  return buildExecuteCommand({
    tenantId: "proj-cfg-1",
    evaluationId: "eval_cfg",
    evaluatorId: "mon_cfg",
    evaluatorType: "openai/moderation",
    evaluatorName: "Test Monitor",
    traceId: "trace_cfg",
    isGuardrail: false,
  });
}

describe("Feature: Evaluator misconfiguration is a skip, not a failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the project has the provider configured but not enabled", () => {
    describe("when the command handles the evaluation", () => {
      /** @scenario Monitor using a provider the project has disabled is skipped */
      it("emits a skipped event carrying the configure message", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorConfigError("Provider openai is not enabled"),
        });

        const events = await command.handle(buildCommand());

        expect(events).toHaveLength(1);
        expect(eventDataOf(events).status).toBe("skipped");
        expect(eventDataOf(events).details).toBe("Provider openai is not enabled");
      });

      it("does not log at error level", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorConfigError("Provider openai is not enabled"),
        });

        await command.handle(buildCommand());

        expect(loggerSpies.error).not.toHaveBeenCalled();
      });

      /** @scenario Misconfiguration is logged at info with a stable code for alerting */
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
      /** @scenario Monitor using a provider the project never configured is skipped */
      it("emits a skipped event carrying the configure message", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorConfigError("Provider anthropic is not configured"),
        });

        const events = await command.handle(buildCommand());

        expect(eventDataOf(events).status).toBe("skipped");
        expect(eventDataOf(events).details).toBe("Provider anthropic is not configured");
      });
    });
  });

  describe("given the evaluator input exceeds the size limit", () => {
    describe("when the command handles the evaluation", () => {
      /** @scenario An oversized evaluator payload is skipped with an actionable message */
      it("skips with a message telling the customer to shorten the input", async () => {
        const { command } = buildCommandWithMocks({
          thrown: new EvaluatorInputTooLargeError(),
        });

        const events = await command.handle(buildCommand());

        expect(eventDataOf(events).status).toBe("skipped");
        expect(eventDataOf(events).details).toMatch(/too large|shorten/i);
        expect(loggerSpies.error).not.toHaveBeenCalled();
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
      /** @scenario An evaluator service outage is reported as an error, not a skip */
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
      /** @scenario Genuine evaluator faults are still reported as errors */
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
