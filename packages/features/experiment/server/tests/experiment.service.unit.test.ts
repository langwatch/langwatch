import { describe, expect, it, vi } from "vitest";
import {
  ExperimentNotFoundError,
  ExperimentDspyStepNotFoundError,
  type ExperimentDspyStep,
  type Experiment,
  type ExperimentRun,
  type SaveExperimentInput,
} from "@langwatch/experiment-contract";
import type {
  ExperimentRepository,
  ExperimentRowState,
} from "../src/repositories/experiment.repository";
import { ExperimentRunRepository } from "../src/repositories/experiment-run.repository";
import { ExperimentDspyRepository } from "../src/repositories/experiment-dspy.repository";
import { ExperimentService } from "../src/services/experiment.service";
import { ExperimentExecutionPort } from "../src/ports/experiment-execution.port";

const row = (overrides: Partial<Experiment> = {}): Experiment => ({
  id: "experiment_1",
  name: "Draft",
  type: "EVALUATIONS_V3",
  slug: "draft",
  projectId: "project_1",
  workflowId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  workbenchState: null,
  ...overrides,
});

class MemoryExperimentRepository implements ExperimentRepository {
  values: Experiment[] = [];
  states = new Map<string, ExperimentRowState>();

  async tryFindById(input: { id: string; projectId: string }) {
    return (
      this.values.find(
        (value) => value.id === input.id && value.projectId === input.projectId,
      ) ?? null
    );
  }
  async tryFindBySlug(input: {
    slug: string;
    projectId: string;
    type?: Experiment["type"];
  }) {
    return (
      this.values.find(
        (value) =>
          value.slug === input.slug &&
          value.projectId === input.projectId &&
          (!input.type || value.type === input.type),
      ) ?? null
    );
  }
  async findAll(input: { projectId: string }) {
    return this.values.filter((value) => value.projectId === input.projectId);
  }
  async findPage(input: { projectId: string; skip: number; take: number }) {
    return (await this.findAll(input)).slice(input.skip, input.skip + input.take);
  }
  async count(input: { projectId: string }) {
    return (await this.findAll(input)).length;
  }
  async tryFindLatest(input: { projectId: string }) {
    return (await this.findAll(input)).at(-1) ?? null;
  }
  async tryFindForWorkflow(input: { projectId: string; workflowId: string }) {
    return (
      this.values.find(
        (value) =>
          value.projectId === input.projectId && value.workflowId === input.workflowId,
      ) ?? null
    );
  }
  async tryFindIdBySlug(input: { projectId: string; slug: string }) {
    const value = await this.tryFindBySlug(input);
    return value ? { id: value.id, slug: value.slug } : null;
  }
  async tryGetRowState(input: { projectId: string; id: string }) {
    return this.states.get(`${input.projectId}:${input.id}`) ?? null;
  }
  async findSlugsByPrefix(input: { projectId: string; slugPrefix: string }) {
    return this.values
      .filter(
        (value) =>
          value.projectId === input.projectId && value.slug.startsWith(input.slugPrefix),
      )
      .map((value) => value.slug);
  }
  async findDraftNames(input: { projectId: string }) {
    return (await this.findAll(input)).map((value) => ({ name: value.name }));
  }
  async findAllSlugs(input: { projectId: string }) {
    return (await this.findAll(input)).map((value) => value.slug);
  }
  async saveActive(input: SaveExperimentInput & { slug: string }) {
    const value = row({ ...input, slug: input.slug });
    this.values = this.values.filter((item) => item.id !== value.id);
    this.values.push(value);
    this.states.set(`${value.projectId}:${value.id}`, {
      slug: value.slug,
      workflowId: value.workflowId,
      archived: false,
    });
    return value;
  }
  async updateWorkbenchState(input: {
    projectId: string;
    id: string;
    workbenchState: SaveExperimentInput["workbenchState"];
  }) {
    const value = await this.tryFindById(input);
    if (value) value.workbenchState = input.workbenchState;
  }
  async archiveActive(input: {
    projectId: string;
    id: string;
    archivedSlug: string;
    archivedAt: Date;
  }) {
    const state = await this.tryGetRowState(input);
    if (!state || state.archived) return false;
    this.states.set(`${input.projectId}:${input.id}`, {
      ...state,
      slug: input.archivedSlug,
      archived: true,
    });
    return true;
  }
}

class MemoryExperimentRunRepository extends ExperimentRunRepository {
  values: Record<string, ExperimentRun[]> = {};
  async list() {
    return this.values;
  }
  async getAggregates() {
    return {};
  }
  async getPage(input: { experimentId: string }) {
    const runs = this.values[input.experimentId] ?? [];
    return { runs, totalHits: runs.length };
  }
  async tryGet() {
    return null;
  }
  async getWorkflowVersions() {
    return {};
  }
}

class MemoryExperimentExecutionPort extends ExperimentExecutionPort {
  startExperimentRun = vi.fn(async () => {});
  recordTargetResult = vi.fn(async () => {});
  recordEvaluatorResult = vi.fn(async () => {});
  completeExperimentRun = vi.fn(async () => {});
}

class MemoryExperimentDspyRepository extends ExperimentDspyRepository {
  values: ExperimentDspyStep[] = [];

  async upsert(input: ExperimentDspyStep): Promise<void> {
    this.values = this.values.filter(
      (value) =>
        !(
          value.tenantId === input.tenantId &&
          value.experimentId === input.experimentId &&
          value.runId === input.runId &&
          value.stepIndex === input.stepIndex
        ),
    );
    this.values.push(input);
  }

  async list(input: { tenantId: string; experimentId: string }) {
    return this.values
      .filter(
        (value) =>
          value.tenantId === input.tenantId && value.experimentId === input.experimentId,
      )
      .map((value) => ({
        tenantId: value.tenantId,
        experimentId: value.experimentId,
        runId: value.runId,
        stepIndex: value.stepIndex,
        workflowVersionId: value.workflowVersionId,
        score: value.score,
        label: value.label,
        optimizerName: value.optimizerName,
        llmCallsTotal: value.llmCalls.length,
        llmCallsTotalTokens: 0,
        llmCallsTotalCost: 0,
        createdAt: value.createdAt,
      }));
  }

  async tryGet(input: {
    tenantId: string;
    experimentId: string;
    runId: string;
    stepIndex: string;
  }) {
    return (
      this.values.find(
        (value) =>
          value.tenantId === input.tenantId &&
          value.experimentId === input.experimentId &&
          value.runId === input.runId &&
          value.stepIndex === input.stepIndex,
      ) ?? null
    );
  }
}

const build = (
  repository = new MemoryExperimentRepository(),
  execution = new MemoryExperimentExecutionPort(),
) => {
  const runRepository = new MemoryExperimentRunRepository();
  const dspyRepository = new MemoryExperimentDspyRepository();
  return {
    repository,
    runRepository,
    dspyRepository,
    execution,
    service: ExperimentService.create({
      repository,
      runRepository,
      dspyRepository,
      execution,
      slugify: (value) => value.toLowerCase().replaceAll(" ", "-"),
      newId: () => "generated",
      now: () => new Date(1),
    }),
  };
};

describe("ExperimentService", () => {
  const dspyStep: ExperimentDspyStep = {
    tenantId: "project_1",
    experimentId: "experiment_1",
    runId: "run_1",
    stepIndex: "0",
    score: 0.5,
    label: "score",
    optimizerName: "MIPROv2",
    optimizerParameters: {},
    predictors: [],
    examples: [],
    llmCalls: [],
    createdAt: 1,
    insertedAt: 1,
    updatedAt: 1,
  };

  it("owns DSPy step writes and reads", async () => {
    const { service } = build();
    await service.upsertDspyStep(dspyStep);

    await expect(
      service.getDspyStep({
        tenantId: "project_1",
        experimentId: "experiment_1",
        runId: "run_1",
        stepIndex: "0",
      }),
    ).resolves.toEqual(dspyStep);
    await expect(
      service.listDspySteps({
        tenantId: "project_1",
        experimentId: "experiment_1",
      }),
    ).resolves.toHaveLength(1);
  });

  it("throws the Experiment DSPy error when a step is absent", async () => {
    await expect(
      build().service.getDspyStep({
        tenantId: "project_1",
        experimentId: "experiment_1",
        runId: "missing",
        stepIndex: "0",
      }),
    ).rejects.toBeInstanceOf(ExperimentDspyStepNotFoundError);
  });

  it("validates and delegates the four Eventing run commands unchanged", async () => {
    const { service, execution } = build();
    const start = {
      tenantId: "project_1",
      runId: "run_1",
      experimentId: "experiment_1",
      total: 1,
      targets: [{ id: "target_1", name: "Target", type: "prompt" }],
      occurredAt: 1,
    };
    const target = {
      tenantId: "project_1",
      runId: "run_1",
      experimentId: "experiment_1",
      index: 0,
      targetId: "target_1",
      entry: { input: "hello" },
      occurredAt: 2,
    };
    const evaluator = {
      tenantId: "project_1",
      runId: "run_1",
      experimentId: "experiment_1",
      index: 0,
      targetId: "target_1",
      evaluatorId: "evaluator_1",
      status: "processed" as const,
      occurredAt: 3,
    };
    const complete = {
      tenantId: "project_1",
      runId: "run_1",
      experimentId: "experiment_1",
      occurredAt: 4,
    };

    await service.startExperimentRun(start);
    await service.recordTargetResult(target);
    await service.recordEvaluatorResult(evaluator);
    await service.completeExperimentRun(complete);

    expect(execution.startExperimentRun).toHaveBeenCalledWith(start);
    expect(execution.recordTargetResult).toHaveBeenCalledWith(target);
    expect(execution.recordEvaluatorResult).toHaveBeenCalledWith(evaluator);
    expect(execution.completeExperimentRun).toHaveBeenCalledWith(complete);
  });

  it("deduplicates slugs inside a project", async () => {
    const { repository, service } = build();
    repository.values.push(row());
    const saved = await service.save({
      id: "experiment_2",
      projectId: "project_1",
      name: "Draft",
      type: "EVALUATIONS_V3",
      requestedSlug: "draft",
      slugMode: "deduplicate",
      workflowId: null,
      workbenchState: null,
    });
    expect(saved.slug).toBe("draft-2");
  });

  it("archives only the Experiment row", async () => {
    const { repository, service } = build();
    repository.states.set("project_1:experiment_1", {
      slug: "draft",
      workflowId: "workflow_1",
      archived: false,
    });
    await expect(
      service.archive({ projectId: "project_1", id: "experiment_1" }),
    ).resolves.toEqual({ success: true });
    expect(
      await repository.tryGetRowState({
        projectId: "project_1",
        id: "experiment_1",
      }),
    ).toMatchObject({ archived: true });
  });

  it("keeps slug resolution and run reads behind one Experiment capability", async () => {
    const { repository, runRepository, service } = build();
    repository.values.push(row());
    runRepository.values.experiment_1 = [
      {
        experimentId: "experiment_1",
        runId: "run_1",
        workflowVersion: null,
        timestamps: { createdAt: 1, updatedAt: 1 },
        summary: { evaluations: {} },
      },
    ];

    await expect(
      service.getRunsPageBySlug({
        projectId: "project_1",
        experimentSlug: "draft",
        page: 1,
        pageSize: 50,
      }),
    ).resolves.toMatchObject({
      experiment: { id: "experiment_1", slug: "draft" },
      totalHits: 1,
    });
  });

  it("throws for a missing slug instead of returning a nullable page", async () => {
    const { service } = build();
    await expect(
      service.getRunsPageBySlug({
        projectId: "project_1",
        experimentSlug: "missing",
        page: 1,
        pageSize: 50,
      }),
    ).rejects.toBeInstanceOf(ExperimentNotFoundError);
  });
});
