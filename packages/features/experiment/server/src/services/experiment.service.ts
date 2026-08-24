import {
  ExperimentNotFoundError,
  ExperimentService as ExperimentServiceContract,
  experimentLookupSchema,
  experimentPageInputSchema,
  experimentSlugLookupSchema,
  findOrCreateWorkflowExperimentInputSchema,
  saveExperimentInputSchema,
  type Experiment,
  type ExperimentLookup,
  type ExperimentPage,
  type ExperimentPageInput,
  type ExperimentSlugLookup,
  type ExperimentType,
  type FindOrCreateWorkflowExperimentInput,
  type SaveExperimentInput,
} from "@langwatch/experiment-contract";
import {
  ArchivedExperimentWriteError,
} from "../repositories/prisma/prisma.experiment.repository";
import type { ExperimentRepository } from "../repositories/experiment.repository";

export type ExperimentServiceOptions = {
  repository: ExperimentRepository;
  slugify: (value: string) => string;
  newId: () => string;
  now?: () => Date;
};

const isUniqueConflict = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";

export class ExperimentService extends ExperimentServiceContract {
  static create(options: ExperimentServiceOptions): ExperimentService {
    return new ExperimentService(options);
  }

  private constructor(private readonly options: ExperimentServiceOptions) {
    super();
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

  async tryGetById(input: ExperimentLookup): Promise<Experiment | null> {
    return this.options.repository.tryFindById(
      experimentLookupSchema.parse(input),
    );
  }

  async tryGetBySlug(input: ExperimentSlugLookup): Promise<Experiment | null> {
    return this.options.repository.tryFindBySlug(
      experimentSlugLookupSchema.parse(input),
    );
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

  async tryGetLatest(input: {
    projectId: string;
  }): Promise<Experiment | null> {
    return this.options.repository.tryFindLatest(input);
  }

  async tryGetIdBySlug(
    input: ExperimentSlugLookup,
  ): Promise<{ id: string; slug: string } | null> {
    return this.options.repository.tryFindIdBySlug(
      experimentSlugLookupSchema.parse(input),
    );
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
      requestedSlug:
        this.options.slugify(command.name) || "workflow-evaluation",
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

  private async generateUniqueSlug(input: {
    baseSlug: string;
    projectId: string;
    excludeExperimentId?: string;
  }): Promise<string> {
    const suffixPattern = new RegExp(
      `^${ExperimentService.escapeRegExp(input.baseSlug)}(-\\d+)?$`,
    );
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
