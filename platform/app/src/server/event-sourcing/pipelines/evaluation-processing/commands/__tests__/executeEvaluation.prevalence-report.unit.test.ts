/**
 * @vitest-environment node
 *
 * langwatch#6397 AC0d asks for the PREVALENCE of evaluator configs stored in
 * the shape that drops the user's prompt. A production database read was never
 * available to the investigation, so the running system reports it instead:
 * one line per affected evaluation, countable without credentials.
 *
 * This file owns the EMISSION — that it fires exactly on the affected shape,
 * and that it carries no prompt text. The classification it keys off
 * (`resolveEvaluatorSettingsWithSource`) is a pure function, covered without
 * mocks in executeEvaluation.settings-resolution.unit.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerSpy } = vi.hoisted(() => ({
  loggerSpy: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Only createLogger is replaced: the module also carries tracing/context
// helpers this command's import graph needs for real.
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/observability")>()),
  createLogger: () => loggerSpy,
}));

import type { Command } from "../../../../";
import { createTenantId } from "../../../../";
import type { ExecuteEvaluationCommandData } from "../../schemas/commands";
import {
  ExecuteEvaluationCommand,
  type ExecuteEvaluationCommandDeps,
} from "../executeEvaluation.command";

const USER_PROMPT = "Is the response empathetic and polite in tone?";

const REPORT_MESSAGE =
  "Recovered evaluator settings from the top level of config — langwatch#6397 affected config";

function buildMonitor(evaluatorConfig: Record<string, unknown> | null) {
  return {
    id: "monitor_1",
    checkType: "custom/settings-eval",
    level: "trace",
    sample: 1,
    preconditions: [],
    mappings: null,
    parameters: null,
    evaluator: evaluatorConfig
      ? { id: "evaluator_1", type: "evaluator", config: evaluatorConfig }
      : null,
  } as Record<string, unknown>;
}

async function execute(evaluatorConfig: Record<string, unknown> | null) {
  const deps = {
    monitors: {
      getMonitorById: vi.fn().mockResolvedValue(buildMonitor(evaluatorConfig)),
    },
    spanStorage: { getSpansByTraceId: vi.fn().mockResolvedValue([]) },
    traceEvents: { getEventsByTraceId: vi.fn().mockResolvedValue([]) },
    evaluationExecution: {
      executeForTrace: vi
        .fn()
        .mockResolvedValue({ status: "processed", score: 1, passed: true }),
    },
    costRecorder: { recordCost: vi.fn() },
  } as unknown as ExecuteEvaluationCommandDeps;

  await new ExecuteEvaluationCommand(deps).handle({
    tenantId: createTenantId("project_prevalence"),
    data: {
      tenantId: "project_prevalence",
      traceId: "trace_1",
      evaluationId: "eval_1",
      evaluatorId: "monitor_1",
      evaluatorType: "custom/settings-eval",
      occurredAt: 0,
    },
  } as unknown as Command<ExecuteEvaluationCommandData>);

  return loggerSpy.info.mock.calls.filter(
    (call) => call[1] === REPORT_MESSAGE,
  ) as [Record<string, unknown>, string][];
}

describe("ExecuteEvaluationCommand prevalence reporting", () => {
  beforeEach(() => {
    loggerSpy.info.mockClear();
  });

  describe("given an evaluator config in the shape that drops the prompt", () => {
    describe("when the online pipeline executes it for a trace", () => {
      /** @scenario An affected evaluator config is reported so its prevalence can be counted */
      it("reports the configuration so its prevalence can be counted", async () => {
        const reports = await execute({
          evaluatorType: "custom/settings-eval",
          prompt: USER_PROMPT,
        });

        expect(reports).toHaveLength(1);
        expect(reports[0]?.[0]).toMatchObject({
          evaluatorId: "monitor_1",
          traceId: "trace_1",
          recoveredKeys: ["prompt"],
        });
      });

      it("names the recovered keys without carrying the prompt text", async () => {
        const reports = await execute({
          evaluatorType: "custom/settings-eval",
          prompt: USER_PROMPT,
        });

        // Settings carry customer content. A prevalence counter that ships the
        // prompt into the log store turns a measurement into a data leak.
        expect(JSON.stringify(reports[0])).not.toContain(USER_PROMPT);
      });
    });
  });

  describe("given an evaluator config the previous rule already read correctly", () => {
    describe("when the online pipeline executes it for a trace", () => {
      it("reports nothing, so the count only ever names affected rows", async () => {
        const reports = await execute({
          evaluatorType: "custom/settings-eval",
          settings: { prompt: USER_PROMPT },
        });

        expect(reports).toHaveLength(0);
      });
    });
  });
});
