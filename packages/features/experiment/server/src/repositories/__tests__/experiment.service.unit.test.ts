import { describe, expect, it, vi } from "vitest";
import {
  ExperimentNotFoundError,
  ExperimentDspyStepNotFoundError,
  type ExperimentDspyStep,
  type Experiment,
  type ExperimentRun,
  type SaveExperimentInput,
  type PersistedEvaluationsV3State,
  persistedEvaluationsV3StateSchema,
} from "@langwatch/experiment-contract";
import type { ExperimentRepository, ExperimentRowState } from "../experiment.repository";
import { ExperimentRunRepository } from "../experiment-run.repository";
import { ExperimentDspyRepository } from "../experiment-dspy.repository";
import { ExperimentService } from "../../services/experiment.service";
import { ExperimentExecutionPort } from "../../ports/experiment-execution.port";
import { AgentService } from "@langwatch/agent-contract";
import { DatasetService } from "@langwatch/dataset-contract";
import { EvaluatorService } from "@langwatch/evaluator-contract";
import { PromptService } from "@langwatch/prompt-contract";
import { WorkflowService } from "@langwatch/workflow-contract";

const prompts: PromptService = Object.create(PromptService.prototype);
prompts.getAllPrompts = async () => [];
const agents: AgentService = Object.create(AgentService.prototype);
agents.exists = async () => false;
const evaluators: EvaluatorService = Object.create(EvaluatorService.prototype);
evaluators.getById = async () => {
  throw new Error("missing");
};
const workflows: WorkflowService = Object.create(WorkflowService.prototype);
workflows.getById = async () => {
  throw new Error("missing");
};
const dataset: DatasetService = Object.create(DatasetService.prototype);
dataset.getByIds = async () => [];
const references = { prompts, agents, evaluators, workflows, dataset };

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
  workbenchVersion: 0,
  ...overrides,
});

class MemoryExperimentRepository implements ExperimentRepository {
  values: Experiment[] = [];
  states = new Map<string, ExperimentRowState>();
  workbenches = new Map<
    string,
    {
      experimentId: string;
      slug: string;
      name: string | null;
      state: PersistedEvaluationsV3State | null;
      version: number;
      updatedAt: Date;
      actorLabel?: "user" | "langy" | "api";
      runId?: string;
      versions: Array<{ version: number; autoSaved: boolean; state: unknown }>;
    }
  >();

  async tryFindById(input: { id: string; projectId: string }) {
    return (
      this.values.find((value) => value.id === input.id && value.projectId === input.projectId) ??
      null
    );
  }
  async tryFindBySlug(input: { slug: string; projectId: string; type?: Experiment["type"] }) {
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
        (value) => value.projectId === input.projectId && value.workflowId === input.workflowId,
      ) ?? null
    );
  }
  async tryFindIdBySlug(input: { projectId: string; slug: string }) {
    const value = await this.tryFindBySlug(input);
    return value ? { id: value.id, slug: value.slug } : null;
  }
  getBySlugOrId(
    _input: Parameters<ExperimentRepository["getBySlugOrId"]>[0],
  ): ReturnType<ExperimentRepository["getBySlugOrId"]> {
    throw new Error("Experiment lookup is not configured for this test repository");
  }
  async tryGetRowState(input: { projectId: string; id: string }) {
    return this.states.get(`${input.projectId}:${input.id}`) ?? null;
  }
  async findSlugsByPrefix(input: { projectId: string; slugPrefix: string }) {
    return this.values
      .filter(
        (value) => value.projectId === input.projectId && value.slug.startsWith(input.slugPrefix),
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
  getWorkbenchState(
    input: Parameters<ExperimentRepository["getWorkbenchState"]>[0],
  ): ReturnType<ExperimentRepository["getWorkbenchState"]> {
    const workbench = [...this.workbenches.values()].find(
      (candidate) => candidate.experimentId === input.id || candidate.slug === input.slug,
    );
    if (
      !workbench ||
      !this.values.some(
        (value) => value.id === workbench.experimentId && value.projectId === input.projectId,
      )
    ) {
      throw new ExperimentNotFoundError(input.id ?? input.slug ?? "unknown");
    }
    return Promise.resolve({ ...workbench });
  }
  resolveWorkbenchSaveTarget(
    input: Parameters<ExperimentRepository["resolveWorkbenchSaveTarget"]>[0],
  ): ReturnType<ExperimentRepository["resolveWorkbenchSaveTarget"]> {
    const current = [...this.workbenches.values()].find(
      (candidate) => candidate.experimentId === input.id || candidate.slug === input.slug,
    );
    return Promise.resolve(
      current
        ? { kind: "update", state: { ...current } }
        : { kind: "create", ...(input.id ? { id: input.id } : {}) },
    );
  }
  writeWorkbenchState(
    input: Parameters<ExperimentRepository["writeWorkbenchState"]>[0],
  ): ReturnType<ExperimentRepository["writeWorkbenchState"]> {
    const workbench = this.workbenches.get(input.id);
    if (!workbench) throw new ExperimentNotFoundError(input.id);
    if (input.expectedVersion !== undefined && input.expectedVersion !== workbench.version) {
      return Promise.resolve({
        kind: "stale",
        currentVersion: workbench.version,
        actorLabel: workbench.actorLabel,
        ...(workbench.runId ? { runId: workbench.runId } : {}),
      });
    }
    workbench.version += 1;
    workbench.name = input.name;
    workbench.state = persistedEvaluationsV3StateSchema.parse(input.state);
    workbench.actorLabel = input.actor.label;
    workbench.runId = input.actor.runId;
    workbench.versions.push({
      version: workbench.version,
      autoSaved: !input.commitMessage,
      state: input.snapshot,
    });
    return Promise.resolve({
      kind: "saved",
      experimentId: input.id,
      slug: workbench.slug,
      version: workbench.version,
    });
  }
  createWorkbenchState(
    input: Parameters<ExperimentRepository["createWorkbenchState"]>[0],
  ): ReturnType<ExperimentRepository["createWorkbenchState"]> {
    this.values.push(
      row({ id: input.id, projectId: input.projectId, slug: input.slug, name: input.name }),
    );
    this.workbenches.set(input.id, {
      experimentId: input.id,
      slug: input.slug,
      name: input.name,
      state: persistedEvaluationsV3StateSchema.parse(input.state),
      version: 1,
      updatedAt: new Date(),
      actorLabel: input.actor.label,
      ...(input.actor.runId ? { runId: input.actor.runId } : {}),
      versions: [{ version: 1, autoSaved: !input.commitMessage, state: input.snapshot }],
    });
    return Promise.resolve({ id: input.id, slug: input.slug });
  }
  listWorkbenchVersions(
    input: Parameters<ExperimentRepository["listWorkbenchVersions"]>[0],
  ): ReturnType<ExperimentRepository["listWorkbenchVersions"]> {
    const workbench = this.workbenches.get(input.experimentId);
    return Promise.resolve(
      (workbench?.versions ?? [])
        .map((version) => ({
          counterVersion: version.version,
          version: version.version,
          autoSaved: version.autoSaved,
          commitMessage: null,
          authorId: null,
          authorLabel: "user",
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
        .reverse()
        .slice(0, input.take),
    );
  }
  getWorkbenchVersion(
    input: Parameters<ExperimentRepository["getWorkbenchVersion"]>[0],
  ): ReturnType<ExperimentRepository["getWorkbenchVersion"]> {
    const found = this.workbenches
      .get(input.experimentId)
      ?.versions.find((version) => version.version === input.version);
    if (!found) throw new Error("missing version");
    return Promise.resolve(found);
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
        (value) => value.tenantId === input.tenantId && value.experimentId === input.experimentId,
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
      references,
    }),
  };
};

describe("ExperimentService", () => {
  const workbenchState = (name = "Workbench"): PersistedEvaluationsV3State => ({
    name,
    datasets: [
      {
        id: "dataset_1",
        name: "Inline",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
      },
    ],
    activeDatasetId: "dataset_1",
    targets: [],
    evaluators: [],
  });
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

  it("refuses malformed workbench state before it can create a row", async () => {
    const { service, repository } = build();

    await expect(
      service.createEvaluationsV3({
        projectId: "project_1",
        state: { name: "Broken" },
        actor: { label: "user" },
      }),
    ).rejects.toMatchObject({ code: "experiment_invalid_workbench_state" });
    expect(repository.values).toEqual([]);
  });

  it("enforces expectedVersion as a compare-and-set", async () => {
    const { service } = build();
    const created = await service.createEvaluationsV3({
      projectId: "project_1",
      state: workbenchState(),
      actor: { label: "user" },
    });
    await service.saveWorkbenchState({
      projectId: "project_1",
      id: created.experimentId,
      state: workbenchState("First"),
      expectedVersion: created.version,
      actor: { label: "user" },
    });

    await expect(
      service.saveWorkbenchState({
        projectId: "project_1",
        id: created.experimentId,
        state: workbenchState("Stale"),
        expectedVersion: created.version,
        actor: { label: "user" },
      }),
    ).rejects.toMatchObject({
      code: "experiment_stale_workbench_state",
      meta: { currentVersion: 2 },
    });
  });

  it("keeps run results out of the version history", async () => {
    // The stored version is a SNAPSHOT of the setup, and results belong to a
    // run rather than to the setup that produced them. Keeping them would
    // make every version carry a copy of its outputs, and restoring one would
    // resurrect a run's results alongside its configuration.
    const { repository, service } = build();
    const created = await service.createEvaluationsV3({
      projectId: "project_1",
      state: workbenchState("Original"),
      actor: { label: "user" },
    });
    const results = {
      runId: "run_1",
      targetOutputs: {},
      targetMetadata: {},
      evaluatorResults: {},
      errors: {},
    };

    await service.saveWorkbenchState({
      projectId: "project_1",
      id: created.experimentId,
      state: { ...workbenchState("Changed"), results },
      expectedVersion: created.version,
      actor: { label: "user" },
    });

    const live = await service.getWorkbenchState({
      projectId: "project_1",
      id: created.experimentId,
    });
    const stored = [...repository.workbenches.values()][0]?.versions.at(-1);
    expect(live.state?.results?.runId).toBe("run_1");
    expect((stored?.state as { results?: unknown } | undefined)?.results).toBeUndefined();
  });

  it("restores setup without discarding current run results", async () => {
    const { service } = build();
    const created = await service.createEvaluationsV3({
      projectId: "project_1",
      state: workbenchState("Original"),
      actor: { label: "user" },
    });
    await service.saveWorkbenchState({
      projectId: "project_1",
      id: created.experimentId,
      state: {
        ...workbenchState("Changed"),
        results: {
          runId: "run_1",
          targetOutputs: {},
          targetMetadata: {},
          evaluatorResults: {},
          errors: {},
        },
      },
      expectedVersion: created.version,
      actor: { label: "user" },
    });
    await service.restoreWorkbenchVersion({
      projectId: "project_1",
      id: created.experimentId,
      version: created.version,
      actor: { label: "user" },
    });

    const restored = await service.getWorkbenchState({
      projectId: "project_1",
      id: created.experimentId,
    });
    expect(restored.state?.name).toBe("Original");
    expect(restored.state?.results?.runId).toBe("run_1");
  });

  /** @scenario "DSPy steps use the Experiment service" */
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

  /** @scenario "DSPy steps use the Experiment service" */
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

  describe("given a project that holds no such experiment", () => {
    describe("when a required read asks for it", () => {
      /** @scenario "Required reads throw on absence" */
      it("throws the Experiment's own not-found error instead of returning null", async () => {
        const { service } = build();

        await expect(
          service.getById({ projectId: "project_1", id: "missing" }),
        ).rejects.toBeInstanceOf(ExperimentNotFoundError);
        await expect(
          service.getBySlug({ projectId: "project_1", slug: "missing" }),
        ).rejects.toBeInstanceOf(ExperimentNotFoundError);
      });

      /** @scenario "Required reads throw on absence" */
      it("throws only for absence, and returns the row when the project holds it", async () => {
        const { repository, service } = build();
        repository.values.push(row());

        await expect(service.getById({ projectId: "project_1", id: "experiment_1" })).resolves
          .toMatchObject({ id: "experiment_1" });
      });
    });
  });

  describe("given an experiment that has already been archived", () => {
    describe("when a save is attempted against it", () => {
      /** @scenario "Archived experiments cannot be resurrected" */
      it("refuses the write and leaves the row archived", async () => {
        const { repository, service } = build();
        repository.values.push(row({ archivedAt: new Date(0) }));
        repository.states.set("project_1:experiment_1", {
          slug: "draft",
          workflowId: null,
          archived: true,
        });

        await expect(
          service.save({
            id: "experiment_1",
            projectId: "project_1",
            name: "Draft",
            type: "EVALUATIONS_V3",
            requestedSlug: "draft",
            slugMode: "preserve-existing",
            workflowId: null,
            workbenchState: null,
          }),
        ).rejects.toBeInstanceOf(ExperimentNotFoundError);
        expect(
          await repository.tryGetRowState({ projectId: "project_1", id: "experiment_1" }),
        ).toMatchObject({ archived: true });
      });
    });
  });

  /** @scenario "Slugs remain unique inside a project" */
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

  /** @scenario "Archive does not cross persistence boundaries" */
  it("archives only the Experiment row", async () => {
    const { repository, service } = build();
    repository.states.set("project_1:experiment_1", {
      slug: "draft",
      workflowId: "workflow_1",
      archived: false,
    });
    await expect(service.archive({ projectId: "project_1", id: "experiment_1" })).resolves.toEqual({
      success: true,
    });
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
