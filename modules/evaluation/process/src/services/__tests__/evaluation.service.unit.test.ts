import { createApiFixture } from "@langwatch/api-fixture";
import { EvaluationNotFoundError } from "@langwatch/evaluation-contract";
import type { EvaluationRunData, TraceEvaluationData } from "@langwatch/evaluation-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import type {
  EvaluationExecution,
  EvaluationInputsResolution,
} from "../../app/evaluation.members.ts";
import { EvaluationRunRepository } from "../../repositories/evaluation.repository.ts";
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
  async findByTraceId(): Promise<EvaluationRunData[]> {
    return this.value ? [this.value] : [];
  }
  async findSummariesByTraceIds(): Promise<Record<string, never>> {
    return {};
  }
  async findTraceEvaluations(): Promise<Record<string, TraceEvaluationData[]>> {
    return {};
  }
  async findInputs(): Promise<Record<string, unknown> | null> {
    return null;
  }
}

class FakeExecution implements EvaluationExecution {
  execute = vi.fn(async () => ({ status: "processed" as const, score: 1 }));
}

class FakeInputsResolution implements EvaluationInputsResolution {
  tryResolve = vi.fn(
    async (input: { tenantId: string; inputs: Record<string, unknown> | null }) => input.inputs,
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
      workflows: createTestWorkflowApi().api,
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
      workflows,
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
    const repository = new FakeRepository();
    await expect(
      service(repository).findTraceEvaluations({
        tenantId: "project_1",
        traceIds: ["trace_1"],
      }),
    ).resolves.toEqual({});
    await expect(
      service(repository).findInputs({
        tenantId: "project_1",
        evaluationId: "evaluation_1",
      }),
    ).resolves.toBeNull();
  });

  /** @scenario "Per-trace evaluation reads use the same capability" */
  it("resolves durable input markers inside the canonical service", async () => {
    const repository = new FakeRepository();
    repository.findInputs = vi.fn(async () => ({ marker: "object_1" }));
    const inputResolution = new FakeInputsResolution();
    inputResolution.tryResolve.mockResolvedValue({ question: "whole input" });
    const evaluation = EvaluationService.create({
      repository,
      execution: new FakeExecution(),
      inputResolution,
      monitorPerformance: new FakeMonitorPerformanceRepository(),
      workflows: createTestWorkflowApi().api,
    });

    await expect(
      evaluation.findInputs({
        tenantId: "project_1",
        evaluationId: "evaluation_1",
      }),
    ).resolves.toEqual({ question: "whole input" });
    expect(inputResolution.tryResolve).toHaveBeenCalledWith({
      tenantId: "project_1",
      inputs: { marker: "object_1" },
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
