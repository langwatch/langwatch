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

import type { Command } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { DEFAULT_CODE_EVALUATOR_CONFIG } from "~/server/evaluators/codeEvaluator";
import type { ExecuteEvaluationCommandData } from "../../schemas/commands";
import {
  ExecuteEvaluationCommand,
  type ExecuteEvaluationCommandDeps,
} from "../executeEvaluation.command";

const USER_PROMPT = "Is the response empathetic and polite in tone?";

const REPORT_MESSAGE =
  "Recovered evaluator settings from the top level of config — langwatch#6397 affected config";

function buildMonitor({
  config,
  evaluatorRecordType,
}: {
  config: Record<string, unknown> | null;
  evaluatorRecordType: string;
}) {
  return {
    id: "monitor_1",
    checkType: "custom/settings-eval",
    level: "trace",
    sample: 1,
    preconditions: [],
    mappings: null,
    parameters: null,
    evaluator: config
      ? { id: "evaluator_1", type: evaluatorRecordType, config }
      : null,
  } as Record<string, unknown>;
}

async function execute({
  config,
  evaluatorRecordType = "evaluator",
}: {
  config: Record<string, unknown> | null;
  /** `Evaluator.type`: "evaluator" (built-in) | "code" | "workflow". */
  evaluatorRecordType?: string;
}) {
  const deps = {
    monitors: {
      getMonitorById: vi
        .fn()
        .mockResolvedValue(buildMonitor({ config, evaluatorRecordType })),
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
          config: {
            evaluatorType: "custom/settings-eval",
            prompt: USER_PROMPT,
          },
        });

        expect(reports).toHaveLength(1);
        expect(reports[0]?.[0]).toMatchObject({
          evaluatorId: "monitor_1",
          traceId: "trace_1",
          recoveredKeyCount: 1,
          recoveredPrompt: true,
        });
      });

      it("carries neither the prompt text nor customer-controlled key names", async () => {
        // `config` is written through `z.record(z.unknown())` with no schema for
        // the `evaluator` type, so a key NAME is as customer-controlled as a
        // value. This fixture puts customer content in both positions; a
        // prevalence counter that echoes either turns a measurement into a leak.
        const CUSTOMER_KEY = "contact-alex@example.com";
        const reports = await execute({
          config: {
            evaluatorType: "custom/settings-eval",
            prompt: USER_PROMPT,
            [CUSTOMER_KEY]: "arbitrary",
          },
        });

        expect(reports).toHaveLength(1);
        const serialized = JSON.stringify(reports[0]);
        expect(serialized).not.toContain(USER_PROMPT);
        expect(serialized).not.toContain(CUSTOMER_KEY);
        // Still counted — the report stays useful for AC0d.
        expect(reports[0]?.[0]).toMatchObject({ recoveredKeyCount: 2 });
      });
    });
  });

  describe("given an evaluator config the previous rule already read correctly", () => {
    describe("when the online pipeline executes it for a trace", () => {
      it("reports nothing, so the count only ever names affected rows", async () => {
        const reports = await execute({
          config: {
            evaluatorType: "custom/settings-eval",
            settings: { prompt: USER_PROMPT },
          },
        });

        expect(reports).toHaveLength(0);
      });
    });
  });

  describe("given a code evaluator, whose valid config is top-level by design", () => {
    describe("when the online pipeline executes it for a trace", () => {
      // A code evaluator stores `{ code, inputs, outputs }` at the top level
      // with no `settings` key — the same SHAPE the recovery branch keys off,
      // arrived at legitimately. Counting those would inflate AC0d's prevalence
      // number with rows that were never affected, and put an info line on the
      // hot path of an unrelated evaluator type.
      //
      // Prose in `//` lines, not the JSDoc: check-feature-parity's binding
      // scanner cannot walk past a `*/` that resumes a block it is already
      // inside, so a spec annotation buried in a multi-paragraph JSDoc reads
      // as UNBOUND. The single-line form below is the only one it follows.
      // (And the token itself must not appear in prose — the checker reads
      // any occurrence as a binding and fails on the unknown scenario name.)
      /** @scenario A code evaluator's own config is never mistaken for a lost prompt */
      it("reports nothing, so the count is not inflated by an unaffected type", async () => {
        const reports = await execute({
          evaluatorRecordType: "code",
          config: DEFAULT_CODE_EVALUATOR_CONFIG as unknown as Record<
            string,
            unknown
          >,
        });

        expect(reports).toHaveLength(0);
      });
    });
  });
});
