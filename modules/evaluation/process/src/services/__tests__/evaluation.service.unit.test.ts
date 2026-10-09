import type { AuthzApi } from "@langwatch/authz-contract";
import { EvaluationNotFoundError } from "@langwatch/evaluation-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Protections, TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { aggregateProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import {
  EvaluationRunRepository,
  type EvaluationInputsRead,
} from "../../repositories/evaluation.repository.ts";
import {
  MonitorPerformanceRepository,
  type MonitorPerformanceBucket,
} from "../../repositories/monitor-performance.repository.ts";
import { EvaluationService } from "../evaluation.service.ts";

const run: EvaluationRunData = {
  evaluationId: "evaluation_1",
  evaluatorId: "evaluator_1",
  evaluatorType: "native",
  evaluatorName: null,
  traceId: "trace_1",
  isGuardrail: false,
  status: "processed",
  score: 1,
  passed: true,
  label: null,
  details: null,
  inputs: null,
  error: null,
  errorDetails: null,
  createdAt: 1,
  updatedAt: 2,
  LastEventOccurredAt: 2,
  archivedAt: null,
  scheduledAt: 1,
  startedAt: 1,
  completedAt: 2,
  costId: null,
};

class FakeRepository extends EvaluationRunRepository {
  private value: EvaluationRunData | null = null;
  async upsert(input: { data: EvaluationRunData }): Promise<void> {
    this.value = input.data;
  }
  async upsertBatch(): Promise<void> {}
  async getByEvaluationId(input: { evaluationId: string }): Promise<EvaluationRunData> {
    if (!this.value) throw new EvaluationNotFoundError(input.evaluationId);
    return this.value;
  }
  async findByTraceId(
    _input: Parameters<EvaluationRunRepository["findByTraceId"]>[0],
  ): Promise<EvaluationRunData[]> {
    return this.value ? [this.value] : [];
  }
  async findInputs(): Promise<EvaluationInputsRead | null> {
    return null;
  }
}

/** Mints the own-only proof the `*Api` run reads are fenced by, as the authz module would. */
function createTestAuthz() {
  const authorizeInternal = vi.fn<AuthzApi["authorizeInternal"]>(async ({ projectId }) =>
    ownProof({ projectId }),
  );
  return { api: createApiFixture<AuthzApi>({ authorizeInternal }), authorizeInternal };
}

/** A viewer who may read captured input and output, and one who may not read input. */
const VISIBLE: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};
const INPUT_HIDDEN: Protections = { ...VISIBLE, canSeeCapturedInput: false };
const INPUTS_QUERY = { projectId: "project_1", evaluationId: "evaluation_1", userId: "user_1" };

function inputsHarness({ protections }: { protections: Protections }) {
  const repository = new FakeRepository();
  const findInputs = vi.fn(async (): Promise<EvaluationInputsRead | null> => ({
    tenantId: "member_1",
    inputs: { marker: "object_1" },
  }));
  repository.findInputs = findInputs;
  const inputResolution = new FakeInputsResolution();
  inputResolution.resolveInputs.mockResolvedValue({ question: "whole input" });
  const resolveViewerProtections = vi.fn(async () => protections);
  const evaluation = EvaluationService.create({
    repository,
    execution: new FakeExecution(),
    inputResolution,
    monitorPerformance: new FakeMonitorPerformanceRepository(),
    retention: { getPlatformDefaultRetentionDays: () => 30, findRetentionDays: async () => [] },
    workflows: createTestWorkflowApi().api,
    traces: createApiFixture<TraceApi>({ resolveViewerProtections }),
    authz: createTestAuthz().api,
  });
  return { evaluation, findInputs, inputResolution, resolveViewerProtections };
}

class FakeExecution {
  execute = vi.fn(async () => ({ status: "processed" as const, score: 1 }));
}

class FakeInputsResolution {
  resolveInputs = vi.fn(
    async (input: { tenantId: string; inputs: Record<string, unknown> }) => input.inputs,
  );
}

class FakeMonitorPerformanceRepository extends MonitorPerformanceRepository {
  constructor(private readonly buckets: MonitorPerformanceBucket[] = []) {
    super();
  }

  async findBuckets(): Promise<MonitorPerformanceBucket[]> {
    return this.buckets;
  }
}

function createTestWorkflowApi() {
  const assertInProject = vi.fn<WorkflowApi["assertInProject"]>(async () => {});
  return { api: createApiFixture<WorkflowApi>({ assertInProject }), assertInProject };
}

describe("EvaluationService", () => {
  const service = (
    repository = new FakeRepository(),
    execution = new FakeExecution(),
    monitorPerformance = new FakeMonitorPerformanceRepository(),
  ) =>
    EvaluationService.create({
      repository,
      execution,
      inputResolution: new FakeInputsResolution(),
      monitorPerformance,
      retention: { getPlatformDefaultRetentionDays: () => 30, findRetentionDays: async () => [] },
      traces: createApiFixture<TraceApi>({ resolveViewerProtections: async () => VISIBLE }),
      workflows: createTestWorkflowApi().api,
      authz: createTestAuthz().api,
    });

  /** @scenario "Evaluation runs use private ClickHouse persistence" */
  it("validates and persists runs through the private repository", async () => {
    const value = new FakeRepository();
    await service(value).upsertRun({ tenantId: "project_1", data: run });
    await expect(
      service(value).getRunByEvaluationId({
        tenantId: "project_1",
        evaluationId: run.evaluationId,
      }),
    ).resolves.toEqual(run);

    // The run contract is parsed at the boundary, so a malformed run never
    // reaches the repository at all.
    const rejected = new FakeRepository();
    await expect(
      service(rejected).upsertRun({ tenantId: "project_1", data: {} as never }),
    ).rejects.toThrow(ZodError);
    await expect(
      service(rejected).getRunByEvaluationId({
        tenantId: "project_1",
        evaluationId: run.evaluationId,
      }),
    ).rejects.toBeInstanceOf(EvaluationNotFoundError);
  });

  /** @scenario "Missing evaluation runs throw a domain error" */
  it("throws when a run is absent", async () => {
    await expect(
      service().getRunByEvaluationId({ tenantId: "project_1", evaluationId: "missing" }),
    ).rejects.toBeInstanceOf(EvaluationNotFoundError);
  });

  it("fences the Api run reads by an own-only proof it mints for the named tenant", async () => {
    const repository = new FakeRepository();
    await repository.upsert({ data: run });
    const getByEvaluationId = vi.spyOn(repository, "getByEvaluationId");
    const findByTraceId = vi.spyOn(repository, "findByTraceId");
    const authz = createTestAuthz();
    const evaluation = EvaluationService.create({
      repository,
      execution: new FakeExecution(),
      inputResolution: new FakeInputsResolution(),
      monitorPerformance: new FakeMonitorPerformanceRepository(),
      retention: { getPlatformDefaultRetentionDays: () => 30, findRetentionDays: async () => [] },
      traces: createApiFixture<TraceApi>({ resolveViewerProtections: async () => VISIBLE }),
      workflows: createTestWorkflowApi().api,
      authz: authz.api,
    });

    await evaluation.findRunByEvaluationId({ tenantId: "project_1", evaluationId: "evaluation_1" });
    await evaluation.findRunsByTraceId({ tenantId: "project_1", traceId: "trace_1" });

    expect(authz.authorizeInternal.mock.calls.map(([args]) => args)).toEqual([
      expect.objectContaining({
        actor: { type: "internal", codePath: "evaluation.run-read" },
        projectId: "project_1",
        permission: "traces:view",
      }),
      expect.objectContaining({ projectId: "project_1", permission: "traces:view" }),
    ]);
    const proofs = await Promise.all(
      authz.authorizeInternal.mock.results.map((result) => result.value),
    );
    expect(getByEvaluationId.mock.calls[0]?.[0]).toMatchObject({
      authorization: proofs[0],
      evaluationId: "evaluation_1",
    });
    expect(getByEvaluationId.mock.calls[0]?.[0]).not.toHaveProperty("tenantId");
    expect(findByTraceId.mock.calls[0]?.[0]).toEqual({
      authorization: proofs[1],
      traceId: "trace_1",
    });
  });

  /** @scenario "Evaluation execution is delegated through one capability" */
  it("validates workflow scope before dispatch", async () => {
    const { api: workflows, assertInProject } = createTestWorkflowApi();
    const execution = new FakeExecution();
    const value = new FakeRepository();
    const evaluation = EvaluationService.create({
      repository: value,
      execution,
      inputResolution: new FakeInputsResolution(),
      monitorPerformance: new FakeMonitorPerformanceRepository(),
      retention: { getPlatformDefaultRetentionDays: () => 30, findRetentionDays: async () => [] },
      traces: createApiFixture<TraceApi>({ resolveViewerProtections: async () => VISIBLE }),
      workflows,
      authz: createTestAuthz().api,
    });
    await evaluation.executeForTrace({
      projectId: "project_1",
      traceId: "trace_1",
      evaluatorType: "workflow",
      settings: {},
      mappings: null,
      workflowId: "workflow_1",
    });
    expect(assertInProject).toHaveBeenCalledWith({
      workflowId: "workflow_1",
      projectId: "project_1",
    });
    expect(execution.execute).toHaveBeenCalled();
  });

  /** @scenario "Per-trace evaluation reads use the same capability" */
  it("owns the per-trace evaluation read vocabulary", async () => {
    await expect(
      service(new FakeRepository()).findInputs({
        ...INPUTS_QUERY,
        authorization: ownProof({ projectId: "project_1" }),
      }),
    ).resolves.toBeNull();
  });

  /** @scenario "Per-trace evaluation reads use the same capability" */
  it("resolves durable input markers under the project the row was read from", async () => {
    const { evaluation, inputResolution } = inputsHarness({ protections: VISIBLE });

    await expect(
      evaluation.findInputs({
        ...INPUTS_QUERY,
        authorization: ownProof({ projectId: "project_1" }),
      }),
    ).resolves.toEqual({ question: "whole input" });
    expect(inputResolution.resolveInputs).toHaveBeenCalledWith({
      tenantId: "member_1",
      inputs: { marker: "object_1" },
    });
  });

  describe("given a viewer who may not read captured input", () => {
    it("answers no inputs without reading or resolving them", async () => {
      const { evaluation, findInputs, inputResolution } = inputsHarness({
        protections: INPUT_HIDDEN,
      });

      await expect(
        evaluation.findInputs({
          ...INPUTS_QUERY,
          authorization: ownProof({ projectId: "project_1" }),
        }),
      ).resolves.toBeNull();
      expect(findInputs).not.toHaveBeenCalled();
      expect(inputResolution.resolveInputs).not.toHaveBeenCalled();
    });
  });

  describe("given an aggregate whose drawer is on a member", () => {
    it("narrows the proof to the member for the protections and the read", async () => {
      const { evaluation, findInputs, resolveViewerProtections } = inputsHarness({
        protections: VISIBLE,
      });
      const authorization = aggregateProof({
        projectId: "aggregate_1",
        members: [{ projectId: "member_1", from: 0 }],
      });

      await evaluation.findInputs({
        ...INPUTS_QUERY,
        projectId: "aggregate_1",
        tenantId: "member_1",
        authorization,
      });

      const narrowed = expect.objectContaining({ narrowedTo: "member_1" });
      expect(resolveViewerProtections).toHaveBeenCalledWith({
        projectId: "aggregate_1",
        userId: "user_1",
        authorization: narrowed,
      });
      expect(findInputs).toHaveBeenCalledWith({
        authorization: narrowed,
        evaluationId: "evaluation_1",
      });
    });

    it("refuses a member the proof does not read as not found", async () => {
      const { evaluation, findInputs } = inputsHarness({ protections: VISIBLE });

      await expect(
        evaluation.findInputs({
          ...INPUTS_QUERY,
          tenantId: "member_elsewhere",
          authorization: ownProof({ projectId: "project_1" }),
        }),
      ).rejects.toBeInstanceOf(EvaluationNotFoundError);
      expect(findInputs).not.toHaveBeenCalled();
    });
  });

  /** @scenario "Monitor performance uses the same capability" */
  it("summarizes score and guardrail performance through its private read model", async () => {
    const performance = await service(
      new FakeRepository(),
      new FakeExecution(),
      new FakeMonitorPerformanceRepository([
        {
          evaluatorId: "score",
          period: "current",
          day: "2026-08-25",
          scoreSum: 1.5,
          scoreCount: 2,
          passSum: 0,
          passCount: 0,
        },
        {
          evaluatorId: "guardrail",
          period: "previous",
          day: "2026-08-24",
          scoreSum: 0,
          scoreCount: 0,
          passSum: 1,
          passCount: 2,
        },
      ]),
    ).getMonitorPerformance({
      tenantId: "project_1",
      monitors: [
        { id: "score", isGuardrail: false },
        { id: "guardrail", isGuardrail: true },
      ],
      previousStartMs: 1,
      currentStartMs: 2,
      endMs: 3,
      timeZone: "UTC",
    });

    expect(performance).toEqual([
      {
        monitorId: "score",
        metric: "score",
        points: [0.75],
        current: 0.75,
        previous: null,
      },
      {
        monitorId: "guardrail",
        metric: "pass_rate",
        points: [],
        current: null,
        previous: 0.5,
      },
    ]);
  });
});
