import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { Trace } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, type Mock, vi } from "vitest";

import type { EvaluationLangevals, EvaluationModelEnv } from "../../app/evaluation.members.ts";
import {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
} from "../evaluation-execution.service.ts";

// A real, non-native builtin evaluator with no required fields, so the fixed
// trace's default input/output pass straight through.
const BUILTIN_EVALUATOR = "openai/moderation";

function buildTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    trace_id: "trace-1",
    project_id: "proj-1",
    input: { value: "hello" },
    output: { value: "world" },
    timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    spans: [],
    ...overrides,
  } as Trace;
}

function buildService(
  overrides: {
    resolveForEvaluator?: Mock<EvaluationModelEnv["resolveForEvaluator"]>;
    evaluate?: Mock<EvaluationLangevals["evaluate"]>;
  } = {},
) {
  const resolveForEvaluator =
    overrides.resolveForEvaluator ??
    vi.fn<EvaluationModelEnv["resolveForEvaluator"]>().mockResolvedValue({});
  const evaluate =
    overrides.evaluate ??
    vi
      .fn<EvaluationLangevals["evaluate"]>()
      .mockResolvedValue({ status: "processed", score: 0.95, passed: true });

  const traces = {
    readTracesWithSpans: vi.fn().mockResolvedValue([buildTrace()]),
    readThreadsTraces: vi.fn().mockResolvedValue([]),
    readEvaluations: vi.fn().mockResolvedValue({}),
  };
  const spanDigest = { format: vi.fn().mockResolvedValue("") };
  const modelEnvResolver = { resolveForEvaluator };
  const langevalsClient = { evaluate };

  const deps: EvaluationExecutionDeps = {
    traces,
    spanDigest,
    modelEnvResolver,
    langevalsClient,
    workflows: createApiFixture<WorkflowApi>({}),
    evaluators: createApiFixture<EvaluatorApi>({ augmentResult: ({ result }) => result }),
    workflowExecutor: {
      run: () => {
        throw new Error("the judge path never runs an evaluation workflow");
      },
    },
    installEnvironment: {},
  };

  return { service: EvaluationExecutionService.create(deps), resolveForEvaluator, evaluate };
}

const defaultParams = {
  projectId: "proj-1",
  traceId: "trace-1",
  evaluatorType: BUILTIN_EVALUATOR,
  settings: null as Record<string, unknown> | null,
  mappings: null,
};

describe("EvaluationExecutionService settings reach the judge", () => {
  describe("given settings recovered from a top-level config", () => {
    /** @scenario Model environment is resolved from the recovered settings */
    it("resolves the model environment from the settings that carry the prompt", async () => {
      const { service, resolveForEvaluator } = buildService();

      await service.executeForTrace({
        ...defaultParams,
        settings: {
          prompt: "Score this answer for factual accuracy.",
          model: "openai/gpt-5-mini",
        },
      });

      expect(resolveForEvaluator).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ model: "openai/gpt-5-mini" }),
        }),
      );
    });
  });

  describe("given a correctly configured evaluator", () => {
    const USER_SETTINGS = {
      prompt: "Score this answer for factual accuracy.",
      model: "openai/gpt-5-mini",
    } as const;

    /** @scenario A correctly configured evaluator's settings reach the judge unchanged */
    it("forwards the user's settings to the judge unchanged", async () => {
      const { service, evaluate } = buildService();

      await service.executeForTrace({ ...defaultParams, settings: { ...USER_SETTINGS } });

      const payload = evaluate.mock.calls[0]?.[0] as { settings?: Record<string, unknown> };

      // Guard first: an empty capture would make the equality below vacuous.
      expect(Object.keys(payload?.settings ?? {})).not.toHaveLength(0);
      expect(payload?.settings).toEqual(USER_SETTINGS);
    });

    it("reaches the judge at all with this fixture type", async () => {
      const { service, evaluate } = buildService();

      await service.executeForTrace({ ...defaultParams, settings: { ...USER_SETTINGS } });

      expect(evaluate).toHaveBeenCalledTimes(1);
    });
  });
});
