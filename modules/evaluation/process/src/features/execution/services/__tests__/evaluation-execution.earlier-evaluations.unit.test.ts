import type { MappingState } from "@langwatch/dataset-contract";
import type { TraceEvaluationData } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import type { EvaluationRunRepository } from "../../../../repositories/evaluation.repository.ts";
import { EvaluationExecutionService } from "../evaluation-execution.service.ts";

const EARLIER: TraceEvaluationData = {
  evaluationId: "evaluation-1",
  evaluatorId: "evaluator-1",
  evaluatorType: "langevals/exact_match",
  evaluatorName: null,
  traceId: "trace-1",
  isGuardrail: false,
  status: "processed",
  score: 1,
  passed: true,
  label: null,
  details: null,
  error: "it broke",
  inputs: { input: "hello" },
  timestamps: { scheduledAt: 10, startedAt: 11, completedAt: null },
};

const READS_EVALUATIONS: MappingState = {
  mapping: { earlier: { source: "evaluations" } },
  expansions: [],
};

function buildService({ earlier }: { earlier: TraceEvaluationData[] }) {
  const trace: Trace = {
    trace_id: "trace-1",
    project_id: "proj-1",
    metadata: {},
    input: { value: "hello" },
    output: { value: "world" },
    timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
    spans: [],
  };
  const findTraceEvaluations = vi.fn<EvaluationRunRepository["findTraceEvaluations"]>(
    async () => earlier,
  );
  const authorizeInternal = vi.fn(async ({ projectId }: { projectId: string }) =>
    ownProof({ projectId }),
  );
  const service = EvaluationExecutionService.create({
    traces: {
      readTracesWithSpans: async () => [trace],
      readThreadsTraces: async () => [],
    },
    runs: { findTraceEvaluations },
    authz: { authorizeInternal },
    spanDigest: { format: async () => "", formatThread: async () => "" },
    modelEnvResolver: { resolveForEvaluator: async () => ({}) },
    langevalsClient: { evaluate: async () => ({ status: "processed", passed: true }) },
    evaluators: createApiFixture<EvaluatorApi>({ augmentResult: ({ result }) => result }),
    workflowExecutor: {
      run: () => {
        throw new Error("no workflow here");
      },
    },
    judges: {
      judge: () => {
        throw new Error("no judge here");
      },
    },
    installEnvironment: {},
  });
  return { service, trace, findTraceEvaluations, authorizeInternal };
}

const params = {
  projectId: "proj-1",
  traceId: "trace-1",
  evaluatorType: "openai/moderation",
  settings: null,
};

describe("a mapping that reads the trace's earlier evaluations", () => {
  /** @scenario "A mapping that reads earlier evaluations gets evaluation's own runs for the trace" */
  it("reads them from evaluation's own runs as the platform for that project, in the trace's shape", async () => {
    const { service, trace, findTraceEvaluations, authorizeInternal } = buildService({
      earlier: [EARLIER],
    });

    await service.executeForTrace({ ...params, mappings: READS_EVALUATIONS });

    expect(authorizeInternal).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", permission: "traces:view" }),
    );
    expect(findTraceEvaluations).toHaveBeenCalledWith({
      authorization: expect.anything(),
      traceIds: ["trace-1"],
    });
    expect(trace.evaluations).toEqual([
      {
        evaluation_id: "evaluation-1",
        evaluator_id: "evaluator-1",
        name: "",
        type: "langevals/exact_match",
        is_guardrail: false,
        status: "processed",
        passed: true,
        score: 1,
        label: null,
        details: null,
        error: { has_error: true, message: "it broke", stacktrace: [] },
        inputs: { input: "hello" },
        timestamps: { inserted_at: 10, started_at: 11, finished_at: null },
      },
    ]);
  });

  /** @scenario "A mapping that reads earlier evaluations gets evaluation's own runs for the trace" */
  it("attaches none when the trace has no earlier evaluations", async () => {
    const { service, trace } = buildService({ earlier: [] });

    await service.executeForTrace({ ...params, mappings: READS_EVALUATIONS });

    expect(trace.evaluations).toEqual([]);
  });

  /** @scenario "A mapping that reads no earlier evaluations does not read them" */
  it("reads nothing when no mapping reads the evaluations source", async () => {
    const { service, findTraceEvaluations, authorizeInternal } = buildService({
      earlier: [EARLIER],
    });

    await service.executeForTrace({ ...params, mappings: null });

    expect(findTraceEvaluations).not.toHaveBeenCalled();
    expect(authorizeInternal).not.toHaveBeenCalled();
  });
});
