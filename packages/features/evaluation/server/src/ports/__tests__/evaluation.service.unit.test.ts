import { describe, expect, it, vi } from "vitest";
import {
  WorkflowService,
  type ArchiveWorkflowCommand,
  type CopyWorkflowCommand,
  type CreateWorkflowCommand,
  type PublishWorkflowCommand,
  type RunWorkflowCommand,
  type SaveWorkflowVersionCommand,
  type StudioClientEvent,
  type UpdateWorkflowCommand,
  type Workflow,
  type WorkflowEvaluatorFields,
  type WorkflowVersion,
  type WorkflowVersionHistoryEntry,
  type WorkflowVersionHistoryMode,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { EvaluationNotFoundError } from "@langwatch/evaluation-contract";
import { EvaluationService } from "../../services/evaluation.service";
import {
  EvaluationExecutionPort,
  EvaluationInputsResolutionPort,
} from "../evaluation.port";
import { EvaluationRunRepository } from "../../repositories/evaluation.repository";
import {
  MonitorPerformanceRepository,
  type MonitorPerformanceBucket,
} from "../../repositories/monitor-performance.repository";
import type { EvaluationRunData, TraceEvaluationData } from "@langwatch/evaluation-contract";

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
  async tryFindByEvaluationId(): Promise<EvaluationRunData | null> {
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
  async tryFindInputs(): Promise<Record<string, unknown> | null> {
    return null;
  }
}

class FakeExecution extends EvaluationExecutionPort {
  execute = vi.fn(async () => ({ status: "processed" as const, score: 1 }));
}

class FakeInputsResolution extends EvaluationInputsResolutionPort {
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

class TestWorkflowService extends WorkflowService {
  readonly assertInProject = vi.fn(async (_input: { workflowId: string; projectId: string }) => {});

  async enrichStudioEvent(_input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    throw new Error("unused workflow capability");
  }

  async prepareStudioEvent(_input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    throw new Error("unused workflow capability");
  }

  async getById(_input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
  }): Promise<WorkflowWithVersion> {
    throw new Error("unused workflow capability");
  }

  async getFields(_input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowEvaluatorFields> {
    throw new Error("unused workflow capability");
  }

  async list(_input: { projectId: string }): Promise<Workflow[]> {
    return [];
  }

  async getVersions(_input: {
    workflowId: string;
    projectId: string;
    includeDsl?: boolean;
  }): Promise<WorkflowVersion[]> {
    return [];
  }

  async getVersionHistory(_input: {
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]> {
    return [];
  }

  async restoreVersion(_input: { versionId: string; projectId: string }): Promise<WorkflowVersion> {
    throw new Error("unused workflow capability");
  }

  async getPublishedVersion(_input: {
    workflowId: string;
    projectId: string;
    versionId?: string;
  }): Promise<WorkflowVersion> {
    throw new Error("unused workflow capability");
  }

  async create(_input: CreateWorkflowCommand): Promise<{
    workflow: WorkflowWithVersion;
    version: WorkflowVersion;
  }> {
    throw new Error("unused workflow capability");
  }

  async update(_input: UpdateWorkflowCommand): Promise<Workflow> {
    throw new Error("unused workflow capability");
  }

  async saveVersion(_input: SaveWorkflowVersionCommand): Promise<WorkflowVersion> {
    throw new Error("unused workflow capability");
  }

  async publish(_input: PublishWorkflowCommand): Promise<Workflow> {
    throw new Error("unused workflow capability");
  }

  async unpublish(_input: { id: string; projectId: string }): Promise<Workflow> {
    throw new Error("unused workflow capability");
  }

  async archive(_input: ArchiveWorkflowCommand): Promise<Workflow> {
    throw new Error("unused workflow capability");
  }

  async copy(_input: CopyWorkflowCommand): Promise<{
    workflow: WorkflowWithVersion;
    version: WorkflowVersion;
  }> {
    throw new Error("unused workflow capability");
  }

  async getCopies(_input: { workflowId: string; projectId: string }): Promise<Workflow[]> {
    return [];
  }

  async pushToCopies(_input: {
    workflowId: string;
    projectId: string;
    copyIds?: string[];
    allowedProjectIds?: string[];
  }): Promise<{ pushedTo: number; selectedCopies: number }> {
    return { pushedTo: 0, selectedCopies: 0 };
  }

  async run(_input: RunWorkflowCommand): Promise<unknown> {
    throw new Error("unused workflow capability");
  }
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
      workflows: new TestWorkflowService(),
    });

  it("validates and persists runs through the private repository", async () => {
    const value = new FakeRepository();
    await service(value).upsertRun({ tenantId: "project_1", data: run });
    await expect(
      service(value).getRunByEvaluationId({
        tenantId: "project_1",
        evaluationId: run.evaluationId,
      }),
    ).resolves.toEqual(run);
  });

  it("throws when a run is absent", async () => {
    await expect(
      service().getRunByEvaluationId({ tenantId: "project_1", evaluationId: "missing" }),
    ).rejects.toBeInstanceOf(EvaluationNotFoundError);
  });

  it("validates workflow scope before dispatch", async () => {
    const workflows = new TestWorkflowService();
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
    expect(workflows.assertInProject).toHaveBeenCalledWith({
      workflowId: "workflow_1",
      projectId: "project_1",
    });
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

  it("resolves durable input markers inside the canonical service", async () => {
    const repository = new FakeRepository();
    repository.tryFindInputs = vi.fn(async () => ({ marker: "object_1" }));
    const inputResolution = new FakeInputsResolution();
    inputResolution.tryResolve.mockResolvedValue({ question: "whole input" });
    const evaluation = EvaluationService.create({
      repository,
      execution: new FakeExecution(),
      inputResolution,
      monitorPerformance: new FakeMonitorPerformanceRepository(),
      workflows: new TestWorkflowService(),
    });

    await expect(
      evaluation.tryGetInputs({
        tenantId: "project_1",
        evaluationId: "evaluation_1",
      }),
    ).resolves.toEqual({ question: "whole input" });
    expect(inputResolution.tryResolve).toHaveBeenCalledWith({
      tenantId: "project_1",
      inputs: { marker: "object_1" },
    });
  });

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
