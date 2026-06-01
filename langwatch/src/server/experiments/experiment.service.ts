import type {
  Experiment,
  ExperimentType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { slugify } from "../../utils/slugify";
import { isUniqueConstraintError } from "../utils/prismaErrors";
import { ExperimentNotFoundError } from "./errors";
import { ExperimentRepository } from "./experiment.repository";

/**
 * Service layer for experiment business logic.
 * Owns slug generation, draft naming, lookups, and P2002 retry strategy.
 */
export class ExperimentService {
  constructor(private readonly repository: ExperimentRepository) {}

  static create(prisma: PrismaClient): ExperimentService {
    return new ExperimentService(new ExperimentRepository(prisma));
  }

  async getBySlug({
    projectId,
    slug,
  }: {
    projectId: string;
    slug: string;
  }): Promise<Experiment> {
    const experiment = await this.repository.findBySlug({
      slug,
      projectId,
    });

    if (!experiment) {
      throw new ExperimentNotFoundError(slug);
    }

    return experiment;
  }

  async getById({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<Experiment> {
    const experiment = await this.repository.findById({ id, projectId });

    if (!experiment) {
      throw new ExperimentNotFoundError(id);
    }

    return experiment;
  }

  async getAll({ projectId }: { projectId: string }): Promise<Experiment[]> {
    return this.repository.findAll({ projectId });
  }

  async getPage({
    projectId,
    page,
    pageSize,
  }: {
    projectId: string;
    page: number;
    pageSize: number;
  }): Promise<{ experiments: Experiment[]; totalHits: number }> {
    const skip = (page - 1) * pageSize;
    const [experiments, totalHits] = await Promise.all([
      this.repository.findPage({ projectId, skip, take: pageSize }),
      this.repository.countByProject({ projectId }),
    ]);

    return { experiments, totalHits };
  }

  async getLatest({
    projectId,
  }: {
    projectId: string;
  }): Promise<Experiment | null> {
    return this.repository.findLatest({ projectId });
  }

  /**
   * Returns the experiment with the given id if it is live, otherwise null.
   * Use this for tolerant lookups (the caller decides how to react to null).
   * For lookups that should throw on miss, use `getById`.
   */
  async findById({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<Experiment | null> {
    return this.repository.findById({ id, projectId });
  }

  /**
   * Returns the experiment with the given slug if it is live, otherwise null.
   */
  async findBySlug({
    projectId,
    slug,
  }: {
    projectId: string;
    slug: string;
  }): Promise<Experiment | null> {
    return this.repository.findBySlug({ slug, projectId });
  }

  /**
   * Returns the experiment with the given slug and type if it is live,
   * otherwise null. The EVALUATIONS_V3 routes use this to refuse to operate
   * on rows of the wrong type.
   */
  async findBySlugAndType({
    projectId,
    slug,
    type,
  }: {
    projectId: string;
    slug: string;
    type: ExperimentType;
  }): Promise<Experiment | null> {
    return this.repository.findFirstActive({
      where: { projectId, slug, type },
    });
  }

  /**
   * Returns `{ id, slug }` for an active experiment, or null. The execution
   * service needs the bare id for ClickHouse keying without paying for the
   * rest of the row.
   */
  async findIdBySlug({
    projectId,
    slug,
  }: {
    projectId: string;
    slug: string;
  }): Promise<{ id: string; slug: string } | null> {
    return this.repository.findFirstActive({
      where: { projectId, slug },
      select: { id: true, slug: true },
    });
  }

  /**
   * Returns true when an active experiment exists for `(id, projectId)`.
   * The routes use this to refuse to serve results once the owning
   * experiment is archived, without paying for the full row.
   */
  async isActive({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<boolean> {
    const row = await this.repository.findFirstActive({
      where: { projectId, id },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Returns the experiment by id with its Workflow joined (no version),
   * or null. Use when the caller just needs to confirm a workflow link
   * exists without paying for a version blob.
   */
  async findByIdWithWorkflow({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<Prisma.ExperimentGetPayload<{
    include: { workflow: true };
  }> | null> {
    return this.repository.findFirstActive({
      where: { id, projectId },
      include: { workflow: true },
    });
  }

  /**
   * Returns the experiment by id with its Workflow + `currentVersion`
   * joined, or null. Used by the saveAsMonitor flow.
   */
  async findByIdWithWorkflowCurrentVersion({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<Prisma.ExperimentGetPayload<{
    include: { workflow: { include: { currentVersion: true } } };
  }> | null> {
    return this.repository.findFirstActive({
      where: { id, projectId },
      include: { workflow: { include: { currentVersion: true } } },
    });
  }

  /**
   * Returns the experiment by id with its Workflow + `latestVersion`
   * joined, or null. Used by the copy-experiment flow (which needs the
   * latest DSL to clone).
   */
  async findByIdWithWorkflowLatestVersion({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<Prisma.ExperimentGetPayload<{
    include: { workflow: { include: { latestVersion: true } } };
  }> | null> {
    return this.repository.findFirstActive({
      where: { id, projectId },
      include: { workflow: { include: { latestVersion: true } } },
    });
  }

  /**
   * Returns the existing slug for an experiment that the caller is about to
   * upsert, or null if there is no active row yet. Active rows mean the
   * caller is doing an update; null means a create.
   */
  async getExistingSlugForUpsert({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<string | null> {
    const row = await this.repository.findFirstActive({
      where: { id, projectId },
      select: { slug: true },
    });
    return row?.slug ?? null;
  }

  /**
   * Returns the full project-wide list (with workflow+currentVersion
   * joined) and the total count, used by the evaluations list UI. Real-time
   * filtering is left to the caller because the discriminant lives in a
   * JSON column.
   */
  async listForEvaluationsBoard({
    projectId,
  }: {
    projectId: string;
  }): Promise<
    Prisma.ExperimentGetPayload<{
      include: { workflow: { include: { currentVersion: true } } };
    }>[]
  > {
    return this.repository.findManyActive({
      where: { projectId },
      include: {
        workflow: {
          include: { currentVersion: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * Archives an experiment by id. Throws ExperimentNotFoundError when no
   * active or archived row matches. Returns `{ success: true }` for both
   * a successful archive and an idempotent no-op (already archived).
   */
  async archive({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<{ success: true }> {
    const result = await this.repository.archiveById({ id, projectId });
    if (result.kind === "not-found") {
      throw new ExperimentNotFoundError(id);
    }
    return { success: true };
  }

  /**
   * Generates a unique slug for an experiment within a project.
   *
   * If the base slug already exists (belonging to a different experiment),
   * appends an incrementing numeric suffix (-2, -3, ...) until a unique
   * slug is found. Falls back to a random nanoid suffix after 100 candidates.
   *
   * NOTE: There is a TOCTOU race window between this slug check and the
   * subsequent insert/upsert. If two concurrent requests generate the same
   * slug, one will hit a P2002 constraint violation. Callers should use
   * `saveWithSlugRetry` to handle this.
   */
  async generateUniqueSlug({
    baseSlug,
    projectId,
    excludeExperimentId,
  }: {
    baseSlug: string;
    projectId: string;
    excludeExperimentId?: string;
  }): Promise<string> {
    // Fetch candidates that match the base slug or its numbered variants (baseSlug-N).
    // We use startsWith for the DB query, then filter in-memory with a regex
    // to avoid false positives (e.g., "my-exp" matching "my-experiment").
    const suffixPattern = new RegExp(
      `^${ExperimentService.escapeRegExpChars(baseSlug)}(-\\d+)?$`,
    );
    const existingSlugs = new Set(
      (
        await this.repository.findBySlugPrefix({
          projectId,
          slugPrefix: baseSlug,
          excludeId: excludeExperimentId,
        })
      )
        .map((e) => e.slug)
        .filter((slug) => suffixPattern.test(slug)),
    );

    if (!existingSlugs.has(baseSlug)) {
      return baseSlug;
    }

    let index = 2;
    while (index <= 102) {
      const candidate = `${baseSlug}-${index}`;
      if (!existingSlugs.has(candidate)) {
        return candidate;
      }
      index++;
    }

    return `${baseSlug}-${nanoid(8)}`;
  }

  /**
   * Finds the next available "Draft Evaluation (N)" name for a project.
   */
  async findNextDraftName({
    projectId,
  }: {
    projectId: string;
  }): Promise<string> {
    const experiments = await this.repository.findDraftNames({ projectId });

    const slugs = new Set(
      (await this.repository.findAllSlugs({ projectId })).map((e) => e.slug),
    );

    let index = experiments.length + 1;
    const maxIndex = index + 1000;
    while (index < maxIndex) {
      const draftName = `Draft Evaluation (${index})`;
      if (!slugs.has(slugify(draftName))) {
        return draftName;
      }
      index++;
    }

    return `Draft Evaluation (${nanoid(8)})`;
  }

  /**
   * Wraps an experiment write operation with P2002 slug-conflict retry.
   *
   * If the initial write fails with a unique constraint violation (P2002),
   * regenerates the slug and retries once. This handles the TOCTOU race
   * between `generateUniqueSlug` and the actual insert/upsert.
   */
  async saveWithSlugRetry<T>({
    initialSlug,
    execute,
    regenerateSlug,
  }: {
    initialSlug: string;
    execute: (slug: string) => Promise<T>;
    regenerateSlug: () => Promise<string>;
  }): Promise<{ result: T; slug: string }> {
    try {
      return { result: await execute(initialSlug), slug: initialSlug };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const newSlug = await regenerateSlug();
        return { result: await execute(newSlug), slug: newSlug };
      }
      throw error;
    }
  }

  private static escapeRegExpChars(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
