import type { Experiment, PrismaClient } from "@prisma/client";
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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: ExperimentRepository,
  ) {}

  static create(prisma: PrismaClient): ExperimentService {
    return new ExperimentService(prisma, new ExperimentRepository(prisma));
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
      throw new ExperimentNotFoundError();
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
      throw new ExperimentNotFoundError();
    }

    return experiment;
  }

  async getAll({ projectId }: { projectId: string }): Promise<Experiment[]> {
    return this.repository.findAll({ projectId });
  }

  async getLatest({
    projectId,
  }: {
    projectId: string;
  }): Promise<Experiment | null> {
    return this.repository.findLatest({ projectId });
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

    let draftName;
    let index = experiments.length + 1;
    while (true) {
      draftName = `Draft Evaluation (${index})`;
      if (!slugs.has(slugify(draftName))) {
        break;
      }
      index++;
    }

    return draftName;
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
