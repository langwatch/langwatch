import {
  completeExperimentRunInputSchema,
  experimentDspyStepLookupSchema,
  experimentDspyStepSchema,
  experimentDspyStepSummarySchema,
  experimentDspyStepsLookupSchema,
  ExperimentDspyStepNotFoundError,
  ExperimentNotFoundError,
  InvalidExperimentConfigurationError,
  StaleWorkbenchStateError,
  ExperimentService as ExperimentServiceContract,
  experimentLookupSchema,
  experimentPageInputSchema,
  experimentSlugLookupSchema,
  experimentRunListInputSchema,
  experimentRunLookupSchema,
  experimentRunPageInputSchema,
  experimentRunSlugPageInputSchema,
  findOrCreateWorkflowExperimentInputSchema,
  recordEvaluatorResultInputSchema,
  recordTargetResultInputSchema,
  saveExperimentInputSchema,
  startExperimentRunInputSchema,
  type Experiment,
  type DSPyRunsSummary,
  type ExperimentDspyStep,
  type ExperimentDspyStepLookup,
  type ExperimentDspyStepSummary,
  type ExperimentDspyStepsLookup,
  type ExperimentLookup,
  type ExperimentPage,
  type ExperimentPageInput,
  type ExperimentSlugLookup,
  type ExperimentType,
  type ExperimentRun,
  type ExperimentRunAggregate,
  type ExperimentRunListInput,
  type ExperimentRunLookup,
  type ExperimentRunPageInput,
  type ExperimentRunSlugPageInput,
  type ExperimentRunWithItems,
  type CompleteExperimentRunInput,
  type FindOrCreateWorkflowExperimentInput,
  type SaveExperimentInput,
  type RecordEvaluatorResultInput,
  type RecordTargetResultInput,
  type StartExperimentRunInput,
  createEvaluationsV3InputSchema,
  getWorkbenchStateInputSchema,
  saveWorkbenchStateInputSchema,
  commitWorkbenchVersionInputSchema,
  listWorkbenchVersionsInputSchema,
  restoreWorkbenchVersionInputSchema,
  recordWorkbenchRunResultsInputSchema,
  collectWorkbenchReferences,
  WorkbenchMissingReferenceError,
  parseWorkbenchState,
  repairWorkbenchState,
  stripWorkbenchResults,
  type CommitWorkbenchVersionInput,
  type CreateEvaluationsV3Input,
  type GetWorkbenchStateInput,
  type ListWorkbenchVersionsInput,
  type RestoreWorkbenchVersionInput,
  type RecordWorkbenchRunResultsInput,
  type SaveWorkbenchStateInput,
  type WorkbenchSaveResult,
  type WorkbenchStateView,
  type WorkbenchVersionsPage,
  type WorkbenchActor,
} from "@langwatch/experiment-contract";
import type { AgentService } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import { EvaluatorNotFoundError, type EvaluatorService } from "@langwatch/evaluator-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import { WorkflowNotFoundError, type WorkflowService } from "@langwatch/workflow-contract";
import { z } from "zod";
import {
  ArchivedExperimentWriteError,
  type ExperimentRepository,
} from "../repositories/experiment.repository";
import type { ExperimentRunRepository } from "../repositories/experiment-run.repository";
import type { ExperimentDspyRepository } from "../repositories/experiment-dspy.repository";
import type { ExperimentExecutionPort } from "../ports/experiment-execution.port";
import type { ExperimentWorkbenchUpdatesPort } from "../ports/experiment-workbench-updates.port";
import { UnavailableExperimentExecutionAdapter } from "../adapters/unavailable-experiment-execution.adapter";
import { NoopExperimentWorkbenchUpdatesAdapter } from "../adapters/noop-experiment-workbench-updates.adapter";

export type ExperimentServiceOptions = {
  repository: ExperimentRepository;
  runRepository: ExperimentRunRepository;
  dspyRepository: ExperimentDspyRepository;
  execution?: ExperimentExecutionPort;
  slugify: (value: string) => string;
  newId: () => string;
  now?: () => Date;
  references: {
    prompts: PromptService;
    agents: AgentService;
    evaluators: EvaluatorService;
    workflows: WorkflowService;
    dataset: DatasetService;
  };
  updates?: ExperimentWorkbenchUpdatesPort;
};

const uniqueConflictSchema = z.object({
  code: z.literal("P2002"),
  meta: z
    .object({
      target: z.union([z.string(), z.array(z.string())]).optional(),
      driverAdapterError: z
        .object({
          cause: z
            .object({
              constraint: z
                .object({
                  fields: z.array(z.string()).optional(),
                  index: z.string().optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

const isUniqueConflict = (error: unknown): boolean => uniqueConflictSchema.safeParse(error).success;

const uniqueConflictTargets = (error: unknown): string[] => {
  const parsed = uniqueConflictSchema.safeParse(error);
  if (!parsed.success) return [];

  const target = parsed.data.meta?.target;
  if (Array.isArray(target)) {
    return target.map(String);
  }

  if (typeof target === "string") {
    return [target];
  }

  const constraint = parsed.data.meta?.driverAdapterError?.cause?.constraint;
  if (!constraint) return [];
  if (constraint.fields) {
    return constraint.fields.map(String);
  }

  return constraint.index ? [constraint.index] : [];
};

export class ExperimentService extends ExperimentServiceContract {
  static create(options: ExperimentServiceOptions): ExperimentService {
    return new ExperimentService(options);
  }

  private readonly execution: ExperimentExecutionPort;
  private readonly updates: ExperimentWorkbenchUpdatesPort;

  private constructor(private readonly options: ExperimentServiceOptions) {
    super();
    this.execution = options.execution ?? new UnavailableExperimentExecutionAdapter();
    this.updates = options.updates ?? new NoopExperimentWorkbenchUpdatesAdapter();
  }

  async getById(input: ExperimentLookup): Promise<Experiment> {
    const lookup = experimentLookupSchema.parse(input);
    const experiment = await this.options.repository.tryFindById(lookup);
    if (!experiment) throw new ExperimentNotFoundError(lookup.id);
    return experiment;
  }

  async getBySlug(input: ExperimentSlugLookup): Promise<Experiment> {
    const lookup = experimentSlugLookupSchema.parse(input);
    const experiment = await this.options.repository.tryFindBySlug(lookup);
    if (!experiment) throw new ExperimentNotFoundError(lookup.slug);
    return experiment;
  }

  getBySlugOrId(input: { projectId: string; slugOrId: string }): Promise<Experiment> {
    return this.options.repository.getBySlugOrId(input);
  }

  async tryGetById(input: ExperimentLookup): Promise<Experiment | null> {
    return this.options.repository.tryFindById(experimentLookupSchema.parse(input));
  }

  async tryGetBySlug(input: ExperimentSlugLookup): Promise<Experiment | null> {
    return this.options.repository.tryFindBySlug(experimentSlugLookupSchema.parse(input));
  }

  async tryGetBySlugAndType(
    input: ExperimentSlugLookup & { type: ExperimentType },
  ): Promise<Experiment | null> {
    const lookup = experimentSlugLookupSchema.parse(input);
    return this.options.repository.tryFindBySlug({
      ...lookup,
      type: input.type,
    });
  }

  async list(input: { projectId: string }): Promise<Experiment[]> {
    return this.options.repository.findAll(input);
  }

  async getPage(input: ExperimentPageInput): Promise<ExperimentPage> {
    const query = experimentPageInputSchema.parse(input);
    const skip = (query.page - 1) * query.pageSize;
    const [experiments, totalHits] = await Promise.all([
      this.options.repository.findPage({
        projectId: query.projectId,
        skip,
        take: query.pageSize,
      }),
      this.options.repository.count({ projectId: query.projectId }),
    ]);
    return { experiments, totalHits };
  }

  async tryGetLatest(input: { projectId: string }): Promise<Experiment | null> {
    return this.options.repository.tryFindLatest(input);
  }

  async tryGetIdBySlug(input: ExperimentSlugLookup): Promise<{ id: string; slug: string } | null> {
    return this.options.repository.tryFindIdBySlug(experimentSlugLookupSchema.parse(input));
  }

  async isActive(input: ExperimentLookup): Promise<boolean> {
    return (await this.tryGetById(input)) !== null;
  }

  async save(input: SaveExperimentInput): Promise<Experiment> {
    const command = saveExperimentInputSchema.parse(input);
    const state = await this.options.repository.tryGetRowState(command);
    if (state?.archived) throw new ExperimentNotFoundError(command.id);

    const slug =
      command.slugMode === "preserve-existing" && state
        ? state.slug
        : await this.generateUniqueSlug({
            baseSlug: command.requestedSlug,
            projectId: command.projectId,
            excludeExperimentId: state ? command.id : undefined,
          });

    try {
      return await this.options.repository.saveActive({ ...command, slug });
    } catch (error) {
      if (error instanceof ArchivedExperimentWriteError) {
        throw new ExperimentNotFoundError(command.id, { reasons: [error] });
      }
      if (!isUniqueConflict(error)) throw error;
      const retrySlug = await this.generateUniqueSlug({
        baseSlug: command.requestedSlug,
        projectId: command.projectId,
        excludeExperimentId: command.id,
      });
      return this.options.repository.saveActive({
        ...command,
        slug: retrySlug,
      });
    }
  }

  async findOrCreateForWorkflow(
    input: FindOrCreateWorkflowExperimentInput,
  ): Promise<{ id: string; slug: string }> {
    const command = findOrCreateWorkflowExperimentInputSchema.parse(input);
    const existing = await this.options.repository.tryFindForWorkflow(command);
    if (existing) {
      await this.options.repository.updateWorkbenchState({
        projectId: command.projectId,
        id: existing.id,
        workbenchState: command.workbenchState,
      });
      return { id: existing.id, slug: existing.slug };
    }

    const experiment = await this.save({
      id: `experiment_${command.workflowId}`,
      projectId: command.projectId,
      name: command.name,
      type: "EVALUATIONS_V3",
      requestedSlug: this.options.slugify(command.name) || "workflow-evaluation",
      slugMode: "deduplicate",
      workflowId: command.workflowId,
      workbenchState: command.workbenchState,
    });
    return { id: experiment.id, slug: experiment.slug };
  }

  async findNextDraftName(input: { projectId: string }): Promise<string> {
    const [drafts, existingSlugs] = await Promise.all([
      this.options.repository.findDraftNames(input),
      this.options.repository.findAllSlugs(input),
    ]);
    const slugs = new Set(existingSlugs);
    let index = drafts.length + 1;
    const maximum = index + 1_000;
    while (index < maximum) {
      const name = `Draft Evaluation (${index})`;
      if (!slugs.has(this.options.slugify(name))) return name;
      index += 1;
    }
    return `Draft Evaluation (${this.options.newId()})`;
  }

  async archive(input: ExperimentLookup): Promise<{ success: true }> {
    const command = experimentLookupSchema.parse(input);
    const state = await this.options.repository.tryGetRowState(command);
    if (!state) throw new ExperimentNotFoundError(command.id);

    await this.options.repository.archiveActive({
      ...command,
      archivedSlug: `${state.slug}-archived-${this.options.newId()}`,
      archivedAt: this.options.now?.() ?? new Date(),
    });

    return { success: true };
  }

  async startExperimentRun(input: StartExperimentRunInput): Promise<void> {
    await this.execution.startExperimentRun(startExperimentRunInputSchema.parse(input));
  }

  async recordTargetResult(input: RecordTargetResultInput): Promise<void> {
    await this.execution.recordTargetResult(recordTargetResultInputSchema.parse(input));
  }

  async recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void> {
    await this.execution.recordEvaluatorResult(recordEvaluatorResultInputSchema.parse(input));
  }

  async completeExperimentRun(input: CompleteExperimentRunInput): Promise<void> {
    await this.execution.completeExperimentRun(completeExperimentRunInputSchema.parse(input));
  }

  async upsertDspyStep(input: ExperimentDspyStep): Promise<void> {
    await this.options.dspyRepository.upsert(experimentDspyStepSchema.parse(input));
  }

  async listDspySteps(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]> {
    const values = await this.options.dspyRepository.list(
      experimentDspyStepsLookupSchema.parse(input),
    );
    return values.map((value) => experimentDspyStepSummarySchema.parse(value));
  }

  async listDspyRuns(input: ExperimentDspyStepsLookup): Promise<DSPyRunsSummary[]> {
    const query = experimentDspyStepsLookupSchema.parse(input);
    const steps = await this.listDspySteps(query);
    const versionIds = steps.flatMap((step) =>
      step.workflowVersionId ? [step.workflowVersionId] : [],
    );
    const versions = await this.options.runRepository.getWorkflowVersions(
      query.tenantId,
      versionIds,
    );
    const stepsByRun = new Map<string, ExperimentDspyStepSummary[]>();
    for (const step of steps) {
      const runSteps = stepsByRun.get(step.runId) ?? [];
      runSteps.push(step);
      stepsByRun.set(step.runId, runSteps);
    }

    return Array.from(stepsByRun, ([runId, runSteps]) => {
      const versionId = runSteps.find((step) => step.workflowVersionId)?.workflowVersionId;
      return {
        runId,
        workflow_version: versionId ? versions[versionId] : void 0,
        steps: runSteps
          .map((step) => ({
            run_id: step.runId,
            index: step.stepIndex,
            score: step.score,
            label: step.label,
            optimizer: { name: step.optimizerName },
            llm_calls_summary: {
              total: step.llmCallsTotal,
              total_tokens: step.llmCallsTotalTokens,
              total_cost: step.llmCallsTotalCost,
            },
            timestamps: { created_at: step.createdAt },
          }))
          .sort((a, b) => a.timestamps.created_at - b.timestamps.created_at),
        created_at: Math.min(...runSteps.map((step) => step.createdAt)),
      };
    }).sort((a, b) => b.created_at - a.created_at);
  }

  async getDspyStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep> {
    const lookup = experimentDspyStepLookupSchema.parse(input);
    const value = await this.options.dspyRepository.tryGet(lookup);
    if (!value) {
      throw new ExperimentDspyStepNotFoundError(
        `${lookup.tenantId}/${lookup.experimentId}/${lookup.runId}/${lookup.stepIndex}`,
      );
    }
    return experimentDspyStepSchema.parse(value);
  }

  async getWorkbenchState(input: GetWorkbenchStateInput): Promise<WorkbenchStateView> {
    const query = getWorkbenchStateInputSchema.parse(input);
    const state = await this.options.repository.getWorkbenchState(query);

    return { ...state, state: repairWorkbenchState(state.state) };
  }

  async saveWorkbenchState(input: SaveWorkbenchStateInput): Promise<WorkbenchSaveResult> {
    const command = saveWorkbenchStateInputSchema.parse(input);
    const state = parseWorkbenchState(command.state);
    const target = await this.options.repository.resolveWorkbenchSaveTarget(command);
    if (target.kind === "create") {
      return await this.createEvaluationsV3({
        ...command,
        ...(target.id ? { id: target.id } : {}),
      });
    }
    const current = target.state;
    await this.assertWorkbenchReferencesExist({ projectId: command.projectId, state });

    const written = await this.options.repository.writeWorkbenchState({
      projectId: command.projectId,
      id: current.experimentId,
      name: state.name || (await this.findNextDraftName({ projectId: command.projectId })),
      state,
      snapshot: stripWorkbenchResults(state),
      expectedVersion: command.expectedVersion,
      actor: command.actor,
      commitMessage: command.commitMessage,
    });
    if (written.kind === "stale") {
      throw new StaleWorkbenchStateError(written);
    }

    await this.publishWorkbenchUpdate({
      projectId: command.projectId,
      saved: written,
      actor: command.actor,
    });
    return written;
  }

  async createEvaluationsV3(input: CreateEvaluationsV3Input): Promise<WorkbenchSaveResult> {
    const command = createEvaluationsV3InputSchema.parse(input);
    const state = parseWorkbenchState(command.state);
    await this.assertWorkbenchReferencesExist({ projectId: command.projectId, state });
    const id = command.id ?? this.options.newId();
    const name =
      state.name ||
      command.name ||
      (await this.findNextDraftName({ projectId: command.projectId }));
    const baseSlug = state.experimentSlug ?? id.slice(-8);
    const slug = await this.generateUniqueSlug({ baseSlug, projectId: command.projectId });
    const created = await this.createWorkbenchState({
      projectId: command.projectId,
      id,
      requestedId: command.id,
      slug,
      baseSlug,
      name,
      state,
      actor: command.actor,
      commitMessage: command.commitMessage,
    });
    const result = { experimentId: created.id, slug: created.slug, version: 1 };
    await this.publishWorkbenchUpdate({
      projectId: command.projectId,
      saved: result,
      actor: command.actor,
    });
    return result;
  }

  async commitWorkbenchVersion(input: CommitWorkbenchVersionInput): Promise<WorkbenchSaveResult> {
    const command = commitWorkbenchVersionInputSchema.parse(input);
    const current = await this.getWorkbenchState(command);
    if (!current.state) {
      throw new InvalidExperimentConfigurationError(current.slug);
    }

    return await this.saveWorkbenchState({
      ...command,
      state: current.state,
      expectedVersion: current.version,
    });
  }

  async listWorkbenchVersions(input: ListWorkbenchVersionsInput): Promise<WorkbenchVersionsPage> {
    const query = listWorkbenchVersionsInputSchema.parse(input);
    const current = await this.getWorkbenchState({ projectId: query.projectId, id: query.id });
    const take = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const versions = await this.options.repository.listWorkbenchVersions({
      projectId: query.projectId,
      experimentId: current.experimentId,
      take,
      ...(query.cursor === undefined ? {} : { beforeCounterVersion: query.cursor }),
    });
    const last = versions.at(-1);

    return { versions, nextCursor: versions.length === take && last ? last.counterVersion : null };
  }

  async restoreWorkbenchVersion(input: RestoreWorkbenchVersionInput): Promise<WorkbenchSaveResult> {
    const command = restoreWorkbenchVersionInputSchema.parse(input);
    const current = await this.getWorkbenchState(command);
    const version = await this.options.repository.getWorkbenchVersion({
      projectId: command.projectId,
      experimentId: current.experimentId,
      version: command.version,
    });
    const restored = parseWorkbenchState(version.state);

    return await this.saveWorkbenchState({
      projectId: command.projectId,
      id: current.experimentId,
      state: current.state?.results ? { ...restored, results: current.state.results } : restored,
      expectedVersion: current.version,
      actor: command.actor,
      commitMessage: version.autoSaved
        ? "Restored from the autosave"
        : `Restored from v${command.version}`,
    });
  }

  async recordWorkbenchRunResults(
    input: RecordWorkbenchRunResultsInput,
  ): Promise<WorkbenchSaveResult> {
    const command = recordWorkbenchRunResultsInputSchema.parse(input);
    const current = await this.getWorkbenchState({
      projectId: command.projectId,
      id: command.id,
    });
    if (!current.state) {
      throw new InvalidExperimentConfigurationError(current.slug);
    }

    return await this.saveWorkbenchState({
      projectId: command.projectId,
      id: current.experimentId,
      state: { ...current.state, results: command.results },
      expectedVersion: command.expectedVersion,
      actor: command.actor,
      commitMessage: command.commitMessage,
    });
  }

  private async createWorkbenchState(input: {
    projectId: string;
    id: string;
    requestedId?: string;
    slug: string;
    baseSlug: string;
    name: string;
    state: ReturnType<typeof parseWorkbenchState>;
    actor: CreateEvaluationsV3Input["actor"];
    commitMessage?: string;
  }): Promise<{ id: string; slug: string }> {
    try {
      return await this.options.repository.createWorkbenchState({
        projectId: input.projectId,
        id: input.id,
        slug: input.slug,
        name: input.name,
        state: input.state,
        snapshot: stripWorkbenchResults(input.state),
        actor: input.actor,
        commitMessage: input.commitMessage,
      });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }

      const retrySlug = await this.generateUniqueSlug({
        baseSlug: input.baseSlug,
        projectId: input.projectId,
      });
      try {
        return await this.options.repository.createWorkbenchState({
          projectId: input.projectId,
          id: input.id,
          slug: retrySlug,
          name: input.name,
          state: input.state,
          snapshot: stripWorkbenchResults(input.state),
          actor: input.actor,
          commitMessage: input.commitMessage,
        });
      } catch (retryError) {
        const targets = uniqueConflictTargets(retryError).map((target) => target.toLowerCase());
        const slugConflict = targets.some((target) => target.includes("slug"));
        if (input.requestedId && isUniqueConflict(retryError) && !slugConflict) {
          const reasons = retryError instanceof Error ? [retryError] : [];

          throw new ExperimentNotFoundError(input.requestedId, { reasons });
        }

        throw retryError;
      }
    }
  }

  listRuns(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>> {
    return this.options.runRepository.list(experimentRunListInputSchema.parse(input));
  }

  getRunAggregates(input: ExperimentRunListInput): Promise<Record<string, ExperimentRunAggregate>> {
    return this.options.runRepository.getAggregates(experimentRunListInputSchema.parse(input));
  }

  getRunsPage(
    input: ExperimentRunPageInput,
  ): Promise<{ runs: ExperimentRun[]; totalHits: number }> {
    return this.options.runRepository.getPage(experimentRunPageInputSchema.parse(input));
  }

  tryGetRun(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null> {
    return this.options.runRepository.tryGet(experimentRunLookupSchema.parse(input));
  }

  async getRunsPageBySlug(input: ExperimentRunSlugPageInput): Promise<{
    experiment: { id: string; slug: string };
    runs: ExperimentRun[];
    totalHits: number;
  }> {
    const query = experimentRunSlugPageInputSchema.parse(input);
    const experiment = await this.tryGetIdBySlug({
      projectId: query.projectId,
      slug: query.experimentSlug,
    });
    if (!experiment) throw new ExperimentNotFoundError(query.experimentSlug);
    const page = await this.getRunsPage({
      projectId: query.projectId,
      experimentId: experiment.id,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { experiment, ...page };
  }

  private async publishWorkbenchUpdate({
    projectId,
    saved,
    actor,
  }: {
    projectId: string;
    saved: WorkbenchSaveResult;
    actor: WorkbenchActor;
  }): Promise<void> {
    await this.updates.publish({
      projectId,
      experimentId: saved.experimentId,
      slug: saved.slug,
      version: saved.version,
      actorLabel: actor.label,
      ...(actor.runId ? { runId: actor.runId } : {}),
    });
  }

  private async assertWorkbenchReferencesExist({
    projectId,
    state,
  }: {
    projectId: string;
    state: ReturnType<typeof parseWorkbenchState>;
  }): Promise<void> {
    const references = collectWorkbenchReferences(state);
    const prompts = references.has("prompt")
      ? await this.options.references.prompts.getAllPrompts({ projectId, version: "latest" })
      : [];

    for (const [type, ids] of references) {
      for (const id of ids) {
        const exists = await this.workbenchReferenceExists({ projectId, type, id, prompts });
        if (!exists) throw new WorkbenchMissingReferenceError({ refType: type, refId: id });
      }
    }
  }

  private async workbenchReferenceExists({
    projectId,
    type,
    id,
    prompts,
  }: {
    projectId: string;
    type: "prompt" | "agent" | "evaluator" | "workflow" | "dataset";
    id: string;
    prompts: Awaited<ReturnType<PromptService["getAllPrompts"]>>;
  }): Promise<boolean> {
    switch (type) {
      case "prompt":
        return prompts.some((prompt) => prompt.id === id || prompt.handle === id);
      case "agent":
        return await this.options.references.agents.exists({ id, projectId });
      case "dataset":
        return (
          (await this.options.references.dataset.getByIds({ projectId, datasetIds: [id] }))
            .length === 1
        );
      case "evaluator":
        return await this.options.references.evaluators
          .getById({ id, projectId })
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof EvaluatorNotFoundError) return false;
            throw error;
          });
      case "workflow":
        return await this.options.references.workflows
          .getById({ id, projectId })
          .then(() => true)
          .catch((error: unknown) => {
            if (error instanceof WorkflowNotFoundError) return false;
            throw error;
          });
    }
  }

  private async generateUniqueSlug(input: {
    baseSlug: string;
    projectId: string;
    excludeExperimentId?: string;
  }): Promise<string> {
    const suffixPattern = new RegExp(`^${ExperimentService.escapeRegExp(input.baseSlug)}(-\\d+)?$`);
    const existing = new Set(
      (
        await this.options.repository.findSlugsByPrefix({
          projectId: input.projectId,
          slugPrefix: input.baseSlug,
          excludeId: input.excludeExperimentId,
        })
      ).filter((slug) => suffixPattern.test(slug)),
    );
    if (!existing.has(input.baseSlug)) return input.baseSlug;
    for (let index = 2; index <= 102; index += 1) {
      const candidate = `${input.baseSlug}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${input.baseSlug}-${this.options.newId()}`;
  }

  private static escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
