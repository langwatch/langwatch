import { describe, expect, it, vi } from "vitest";
import type { WorkflowService } from "@langwatch/workflow-contract";
import { EvaluationNotFoundError } from "@langwatch/evaluation-contract";
import { EvaluationService } from "../src/services/evaluation.service";
import { EvaluationExecutionPort } from "../src/ports/evaluation.port";
import { EvaluationRunRepository } from "../src/repositories/evaluation.repository";
import {
  MonitorPerformanceRepository,
  type MonitorPerformanceBucket,
} from "../src/repositories/monitor-performance.repository";
import type {
  EvaluationRunData,
  TraceEvaluationData,
} from "@langwatch/evaluation-contract";

const run: EvaluationRunData = {
  evaluationId: "evaluation_1", evaluatorId: "evaluator_1", evaluatorType: "native",
  evaluatorName: null, traceId: "trace_1", isGuardrail: false, status: "processed",
  score: 1, passed: true, label: null, details: null, inputs: null, error: null,
  errorDetails: null, createdAt: 1, updatedAt: 2, LastEventOccurredAt: 2,
  archivedAt: null, scheduledAt: 1, startedAt: 1, completedAt: 2, costId: null,
};

class FakeRepository extends EvaluationRunRepository {
  private value: EvaluationRunData | null = null;
  async upsert(input: { data: EvaluationRunData }): Promise<void> { this.value = input.data; }
  async upsertBatch(): Promise<void> {}
  async tryFindByEvaluationId(): Promise<EvaluationRunData | null> { return this.value; }
  async findByTraceId(): Promise<EvaluationRunData[]> { return this.value ? [this.value] : []; }
  async findSummariesByTraceIds(): Promise<Record<string, never>> { return {}; }
  async findTraceEvaluations(): Promise<Record<string, TraceEvaluationData[]>> { return {}; }
  async tryFindInputs(): Promise<Record<string, unknown> | null> { return null; }
}

class FakeExecution extends EvaluationExecutionPort {
  execute = vi.fn(async () => ({ status: "processed" as const, score: 1 }));
}

class FakeMonitorPerformanceRepository extends MonitorPerformanceRepository {
  constructor(private readonly buckets: MonitorPerformanceBucket[] = []) {
    super();
  }

  async findBuckets(): Promise<MonitorPerformanceBucket[]> {
    return this.buckets;
  }
}

describe("EvaluationService", () => {
  const service = (
    repository = new FakeRepository(),
    execution = new FakeExecution(),
    monitorPerformance = new FakeMonitorPerformanceRepository(),
  ) => EvaluationService.create({
    repository, execution, monitorPerformance,
    workflows: { assertInProject: vi.fn() } as unknown as WorkflowService,
  });

  it("validates and persists runs through the private repository", async () => {
    const value = new FakeRepository();
    await service(value).upsertRun({ tenantId: "project_1", data: run });
    await expect(service(value).getRunByEvaluationId({ tenantId: "project_1", evaluationId: run.evaluationId })).resolves.toEqual(run);
  });

  it("throws when a run is absent", async () => {
    await expect(service().getRunByEvaluationId({ tenantId: "project_1", evaluationId: "missing" })).rejects.toBeInstanceOf(EvaluationNotFoundError);
  });

  it("validates workflow scope before dispatch", async () => {
    const workflows = { assertInProject: vi.fn(async () => undefined) } as unknown as WorkflowService;
    const execution = new FakeExecution();
    const value = new FakeRepository();
    const evaluation = EvaluationService.create({
      repository: value,
      execution,
      monitorPerformance: new FakeMonitorPerformanceRepository(),
      workflows,
    });
    await evaluation.executeForTrace({ projectId: "project_1", traceId: "trace_1", evaluatorType: "workflow", settings: {}, mappings: null, workflowId: "workflow_1" });
    expect(workflows.assertInProject).toHaveBeenCalledWith({ workflowId: "workflow_1", projectId: "project_1" });
    expect(execution.execute).toHaveBeenCalled();
  });

  it("owns the per-trace evaluation read vocabulary", async () => {
    const repository = new FakeRepository();
    await expect(
      service(repository).findTraceEvaluations({
        tenantId: "project_1",
        traceIds: ["trace_1"],
      }),
    ).resolves.toEqual({});
    await expect(
      service(repository).tryGetInputs({
        tenantId: "project_1",
        evaluationId: "evaluation_1",
      }),
    ).resolves.toBeNull();
  });

  it("summarizes score and guardrail performance through its private read model", async () => {
    const performance = await service(
      new FakeRepository(),
      new FakeExecution(),
      new FakeMonitorPerformanceRepository([
        {
          evaluatorId: "score", period: "current", day: "2026-08-25",
          scoreSum: 1.5, scoreCount: 2, passSum: 0, passCount: 0,
        },
        {
          evaluatorId: "guardrail", period: "previous", day: "2026-08-24",
          scoreSum: 0, scoreCount: 0, passSum: 1, passCount: 2,
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
        monitorId: "score", metric: "score", points: [0.75],
        current: 0.75, previous: null,
      },
      {
        monitorId: "guardrail", metric: "pass_rate", points: [],
        current: null, previous: 0.5,
      },
    ]);
  });
});
