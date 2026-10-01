/**
 * What an evaluator reads when no mapping was saved: an LLM judge gets the
 * whole trace (tool calls and results included), every other evaluator keeps
 * the trace's own fields. Spec: specs/evaluators/judges-read-tool-evidence.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { MappingState } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { Trace } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
} from "../evaluation-execution.service.ts";
import type { EvaluationSpanDigestService } from "../evaluation-span-digest.service.ts";
import type { LangevalsEvaluatorService } from "../langevals-evaluator.service.ts";

const DIGEST = "get_quote -> total 1387.50";
const THREAD = "turn 1: get_quote -> 1387.50";

const trace: Trace = {
  trace_id: "trace-1",
  project_id: "proj-1",
  input: { value: "How much is the stay?" },
  output: { value: "The total is 1,200." },
  metadata: { thread_id: "thread-1" },
  timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
  spans: [],
};

function buildService() {
  const evaluated: Parameters<LangevalsEvaluatorService["evaluate"]>[0][] = [];
  const traceBudgets: number[] = [];
  const threadBudgets: number[] = [];
  const spanDigest: Pick<EvaluationSpanDigestService, "format" | "formatThread"> = {
    format: async ({ maxTokens }) => {
      traceBudgets.push(maxTokens);
      return DIGEST;
    },
    formatThread: async ({ maxTokens }) => {
      threadBudgets.push(maxTokens);
      return THREAD;
    },
  };
  const deps: EvaluationExecutionDeps = {
    traces: {
      readTracesWithSpans: async () => [trace],
      readThreadsTraces: async () => [trace],
      readEvaluations: async () => ({}),
    },
    spanDigest,
    modelEnvResolver: { resolveForEvaluator: async () => ({}) },
    langevalsClient: {
      evaluate: async (params) => {
        evaluated.push(params);
        return { status: "processed", score: 1, passed: true };
      },
    },
    workflows: createApiFixture<WorkflowApi>({}),
    evaluators: createApiFixture<EvaluatorApi>({ augmentResult: ({ result }) => result }),
    workflowExecutor: {
      run: () => {
        throw new Error("no workflow runs here");
      },
    },
    installEnvironment: {},
  };
  return {
    service: EvaluationExecutionService.create(deps),
    evaluated,
    traceBudgets,
    threadBudgets,
  };
}

const run = ({
  service,
  evaluatorType,
  mappings,
  level,
  settings = { model: "openai/gpt-5-mini" },
}: {
  service: EvaluationExecutionService;
  evaluatorType: string;
  mappings: MappingState | null;
  level?: "trace" | "thread";
  settings?: Record<string, unknown>;
}) =>
  service.executeForTrace({
    projectId: "proj-1",
    traceId: "trace-1",
    evaluatorType,
    settings,
    mappings,
    ...(level && { level }),
  });

const EMPTY: MappingState = { mapping: {}, expansions: [] };

describe("EvaluationExecutionService default mappings", () => {
  describe("given an LLM judge with no saved mapping at trace level", () => {
    /** @scenario "An LLM judge with no saved mapping reads the whole trace" */
    it("sends the AI-readable trace as the input and the trace output as the output", async () => {
      const { service, evaluated } = buildService();

      await run({ service, evaluatorType: "langevals/llm_boolean", mappings: null });

      expect(evaluated[0]!.data.input).toBe(DIGEST);
      expect(evaluated[0]!.data.output).toBe("The total is 1,200.");
    });
  });

  describe("given an LLM judge created with no mappings", () => {
    /** @scenario "A monitor created with no mappings still gives its judge the trace" */
    it("treats the stored empty mapping as unset instead of sending empty fields", async () => {
      const { service, evaluated } = buildService();

      await run({ service, evaluatorType: "langevals/llm_score", mappings: EMPTY });

      expect(evaluated[0]!.data.input).toBe(DIGEST);
      expect(evaluated[0]!.data.output).toBe("The total is 1,200.");
    });
  });

  describe("given an LLM judge with no saved mapping at thread level", () => {
    /** @scenario "A thread judge with no saved mapping reads the thread's steps view" */
    it("sends the thread's steps view as the input", async () => {
      const { service, evaluated } = buildService();

      await run({
        service,
        evaluatorType: "langevals/llm_category",
        mappings: null,
        level: "thread",
      });

      expect(evaluated[0]!.data.input).toBe(THREAD);
    });
  });

  describe("given an evaluator that is not an LLM judge", () => {
    /** @scenario "Other evaluators keep the trace's own input and output" */
    it("keeps the trace input and output", async () => {
      const { service, evaluated, traceBudgets } = buildService();

      await run({ service, evaluatorType: "openai/moderation", mappings: null });

      expect(evaluated[0]!.data.input).toBe("How much is the stay?");
      expect(evaluated[0]!.data.output).toBe("The total is 1,200.");
      expect(traceBudgets).toEqual([]);
    });
  });

  describe("given a saved mapping", () => {
    /** @scenario "A saved mapping is used as it is" */
    it("reads what the mapping names, even for an LLM judge", async () => {
      const { service, evaluated } = buildService();

      await run({
        service,
        evaluatorType: "langevals/llm_boolean",
        mappings: { mapping: { input: { source: "input" } }, expansions: [] },
      });

      expect(evaluated[0]!.data.input).toBe("How much is the stay?");
      expect(evaluated[0]!.data.output).toBe("");
    });
  });
});

describe("EvaluationExecutionService render budget", () => {
  describe("given a judge whose max tokens setting is raised", () => {
    /** @scenario "The render budget follows the judge's max tokens and its model's window" */
    it("renders the trace and the thread under half of that setting", async () => {
      const { service, traceBudgets, threadBudgets } = buildService();
      const settings = { model: "anthropic/claude-opus-5-5", max_tokens: 400_000 };

      await run({ service, evaluatorType: "langevals/llm_boolean", mappings: null, settings });
      await run({
        service,
        evaluatorType: "langevals/llm_boolean",
        mappings: null,
        level: "thread",
        settings,
      });

      expect(traceBudgets).toEqual([200_000]);
      expect(threadBudgets).toEqual([200_000]);
    });
  });
});
