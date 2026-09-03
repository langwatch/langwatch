import {
  completeExperimentRunInputSchema,
  experimentDspyStepLookupSchema,
  experimentDspyStepSchema,
  experimentDspyStepSummarySchema,
  experimentDspyStepsLookupSchema,
  ExperimentDspyStepNotFoundError,
  ExperimentNotFoundError,
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
} from "@langwatch/experiment-contract";
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
import { PostgresUniqueConflict } from "../adapters/postgres.unique-conflict.adapter";
import { ExperimentSlugService } from "./experiment-slug.service";
import { ExperimentWorkbenchService } from "./experiment-workbench.service";
import {
  ExperimentWorkbenchReferencesService,
  type ExperimentWorkbenchReferenceServices,
} from "./experiment-workbench-references.service";

export type ExperimentServiceOptions = {
  repository: ExperimentRepository;
  runRepository: ExperimentRunRepository;
  dspyRepository: ExperimentDspyRepository;
  execution?: ExperimentExecutionPort;
  slugify: (value: string) => string;
  newId: () => string;
  now?: () => Date;
  references: ExperimentWorkbenchReferenceServices;
  updates?: ExperimentWorkbenchUpdatesPort;
};

export class ExperimentService extends ExperimentServiceContract {
  static create(options: ExperimentServiceOptions): ExperimentService {
    return new ExperimentService(options);
  }

  private readonly execution: ExperimentExecutionPort;
  private readonly updates: ExperimentWorkbenchUpdatesPort;
  private readonly slugs: ExperimentSlugService;
  private readonly workbenchReferences: ExperimentWorkbenchReferencesService;
  private readonly workbench: ExperimentWorkbenchService;

  private constructor(private readonly options: ExperimentServiceOptions) {
    super();
    this.execution = options.execution ?? new UnavailableExperimentExecutionAdapter();
    this.updates = options.updates ?? new NoopExperimentWorkbenchUpdatesAdapter();
    this.slugs = new ExperimentSlugService(options.repository, options.newId);
    this.workbenchReferences = new ExperimentWorkbenchReferencesService(options.references);
    this.workbench = new ExperimentWorkbenchService({
      repository: options.repository,
      newId: options.newId,
      updates: this.updates,
      slugs: this.slugs,
      references: this.workbenchReferences,
      draftNames: { findNextDraftName: (input) => this.findNextDraftName(input) },
    });
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
        : await this.slugs.generateUnique({
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
      if (!PostgresUniqueConflict.matches(error)) throw error;
      const retrySlug = await this.slugs.generateUnique({
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

  getWorkbenchState(input: GetWorkbenchStateInput): Promise<WorkbenchStateView> {
    return this.workbench.getWorkbenchState(input);
  }

  saveWorkbenchState(input: SaveWorkbenchStateInput): Promise<WorkbenchSaveResult> {
    return this.workbench.saveWorkbenchState(input);
  }

  createEvaluationsV3(input: CreateEvaluationsV3Input): Promise<WorkbenchSaveResult> {
    return this.workbench.createEvaluationsV3(input);
  }

  commitWorkbenchVersion(input: CommitWorkbenchVersionInput): Promise<WorkbenchSaveResult> {
    return this.workbench.commitWorkbenchVersion(input);
  }

  listWorkbenchVersions(input: ListWorkbenchVersionsInput): Promise<WorkbenchVersionsPage> {
    return this.workbench.listWorkbenchVersions(input);
  }

  restoreWorkbenchVersion(input: RestoreWorkbenchVersionInput): Promise<WorkbenchSaveResult> {
    return this.workbench.restoreWorkbenchVersion(input);
  }

  recordWorkbenchRunResults(input: RecordWorkbenchRunResultsInput): Promise<WorkbenchSaveResult> {
    return this.workbench.recordWorkbenchRunResults(input);
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
}
