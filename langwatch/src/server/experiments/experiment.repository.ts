import type { Experiment, Prisma, PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";

/**
 * Repository layer for experiment data access.
 *
 * Every read method in this repository enforces `archivedAt: null` and that
 * is the only correct way to query Experiment in the codebase: route
 * handlers, tRPC procedures and other services must go through this
 * repository (typically via ExperimentService) and never call
 * `prisma.experiment.findFirst` etc. directly. The archive predicate is a
 * data-access concern and is intentionally not part of the public service
 * contract.
 *
 * The only operations that may legitimately touch archived rows live in
 * this file: the slug-prefix lookups used by slug deduplication (where we
 * want collisions to include archived rows so the renamed slug does not
 * accidentally clash) and the archive operation itself.
 */
export class ExperimentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Internal helper: merge the archive predicate into a caller-supplied
   * where clause. Always returns a new object so callers cannot inadvertently
   * mutate the predicate later.
   */
  private active(
    where: Prisma.ExperimentWhereInput,
  ): Prisma.ExperimentWhereInput {
    return { ...where, archivedAt: null };
  }

  /**
   * Generic find for one active experiment. Pass any Prisma
   * `findFirst`-shaped args (where / include / select / orderBy) and the
   * repository will merge `archivedAt: null` into the where clause. Use
   * this when one of the typed helpers does not match exactly.
   */
  async findFirstActive<A extends Prisma.ExperimentFindFirstArgs>(
    args: A,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Prisma.ExperimentGetPayload<A> | null> {
    const client = options?.tx ?? this.prisma;
    return (await client.experiment.findFirst({
      ...args,
      where: this.active(args.where ?? {}),
    })) as Prisma.ExperimentGetPayload<A> | null;
  }

  /**
   * Generic findMany for active experiments. Same args as Prisma's
   * `findMany`, with `archivedAt: null` merged into the where clause.
   */
  async findManyActive<A extends Prisma.ExperimentFindManyArgs>(
    args: A,
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Prisma.ExperimentGetPayload<A>[]> {
    const client = options?.tx ?? this.prisma;
    return (await client.experiment.findMany({
      ...args,
      where: this.active(args.where ?? {}),
    })) as Prisma.ExperimentGetPayload<A>[];
  }

  async findById(
    input: { id: string; projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment | null> {
    return this.findFirstActive(
      { where: { id: input.id, projectId: input.projectId } },
      options,
    );
  }

  async findBySlug(
    input: { slug: string; projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment | null> {
    return this.findFirstActive(
      { where: { slug: input.slug, projectId: input.projectId } },
      options,
    );
  }

  async findAll(
    input: { projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment[]> {
    return this.findManyActive(
      { where: { projectId: input.projectId } },
      options,
    );
  }

  async findPage(
    input: { projectId: string; skip: number; take: number },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment[]> {
    return this.findManyActive(
      {
        where: { projectId: input.projectId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: input.skip,
        take: input.take,
      },
      options,
    );
  }

  async countByProject(
    input: { projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<number> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.count({
      where: this.active({ projectId: input.projectId }),
    });
  }

  /**
   * Finds slugs matching a prefix, used by slug deduplication. Intentionally
   * INCLUDES archived rows so the slug we pick after an archive does not
   * later collide with the renamed `<slug>-archived-<nanoid>` row.
   */
  async findBySlugPrefix(input: {
    projectId: string;
    slugPrefix: string;
    excludeId?: string;
  }): Promise<Array<{ slug: string }>> {
    return await this.prisma.experiment.findMany({
      select: { slug: true },
      where: {
        projectId: input.projectId,
        slug: { startsWith: input.slugPrefix },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
    });
  }

  /**
   * Finds experiment names starting with "Draft" for draft name generation.
   * Excludes archived rows so a freshly-archived "Draft 3" frees its number
   * for the next draft.
   */
  async findDraftNames(input: {
    projectId: string;
  }): Promise<Array<{ name: string | null; slug: string }>> {
    return await this.prisma.experiment.findMany({
      select: { name: true, slug: true },
      where: this.active({
        projectId: input.projectId,
        name: { startsWith: "Draft" },
      }),
    });
  }

  /**
   * Returns every slug for a project including archived rows. Used by
   * draft-name generation to avoid producing a slug that collides with an
   * archived row's renamed slug.
   */
  async findAllSlugs(input: {
    projectId: string;
  }): Promise<Array<{ slug: string }>> {
    return await this.prisma.experiment.findMany({
      select: { slug: true },
      where: { projectId: input.projectId },
    });
  }

  async findLatest(
    input: { projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment | null> {
    return this.findFirstActive(
      {
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      },
      options,
    );
  }

  async upsertById(
    input: {
      id: string;
      projectId: string;
      create: Prisma.ExperimentUncheckedCreateInput;
      update: Prisma.ExperimentUpdateInput;
    },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.upsert({
      where: { id: input.id, projectId: input.projectId },
      create: input.create,
      update: input.update,
    });
  }

  async create(
    input: { data: Prisma.ExperimentUncheckedCreateInput },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.create({ data: input.data });
  }

  /**
   * Returns the row-existence status for `(id, projectId)` including
   * archived rows. This is the only public helper that does not filter
   * `archivedAt: null`, and it exists for one reason: the upsert path
   * needs to refuse to mutate an archived row through `prisma.upsert`.
   * Callers must not use this to surface archived rows to users.
   */
  async getRowStatusById(
    input: { id: string; projectId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<
    { exists: false } | { exists: true; archived: boolean; slug: string }
  > {
    const client = options?.tx ?? this.prisma;
    const row = await client.experiment.findUnique({
      where: { id: input.id, projectId: input.projectId },
      select: { slug: true, archivedAt: true },
    });
    if (!row) return { exists: false };
    return { exists: true, archived: row.archivedAt !== null, slug: row.slug };
  }

  async updateById(
    input: {
      id: string;
      projectId: string;
      data: Prisma.ExperimentUpdateInput;
    },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.update({
      where: { id: input.id, projectId: input.projectId },
      data: input.data,
    });
  }

  /**
   * Archives an experiment by id, atomically.
   *
   * Returns a discriminated kind:
   *   - `archived`        : this call performed the archive
   *   - `already-archived`: the row exists but `archivedAt` was already set
   *                         (idempotent no-op)
   *   - `not-found`       : no row matches (id, projectId)
   *
   * The race-safe contract is that two concurrent callers cannot both
   * observe `archived` for the same id.
   *
   * Cascade behaviour:
   *   - The owning Workflow (if any) is also archived (it has its own
   *     `archivedAt`).
   *   - The owning Monitor (if any) is hard-deleted (the Monitor model
   *     has no `archivedAt` column and is a tiny relational row with no
   *     ClickHouse / S3 footprint).
   *
   * The original slug is renamed to `<slug>-archived-<nanoid>` so the
   * unique `[projectId, slug]` index frees the original slug for a fresh
   * experiment. Mirrors the pattern in dataset.ts deleteById.
   */
  async archiveById(input: {
    id: string;
    projectId: string;
  }): Promise<{ kind: "archived" | "already-archived" | "not-found" }> {
    return await this.prisma.$transaction(async (tx) => {
      const experiment = await tx.experiment.findUnique({
        where: { id: input.id, projectId: input.projectId },
        select: { slug: true, workflowId: true, archivedAt: true },
      });

      if (!experiment) {
        return { kind: "not-found" as const };
      }

      const archivedSlug = `${experiment.slug}-archived-${nanoid()}`;

      const result = await tx.experiment.updateMany({
        where: {
          id: input.id,
          projectId: input.projectId,
          archivedAt: null,
        },
        data: { archivedAt: new Date(), slug: archivedSlug },
      });

      if (result.count === 0) {
        return { kind: "already-archived" as const };
      }

      if (experiment.workflowId) {
        await tx.workflow.update({
          where: {
            id: experiment.workflowId,
            projectId: input.projectId,
          },
          data: { archivedAt: new Date() },
        });
      }

      await tx.monitor.deleteMany({
        where: {
          experimentId: input.id,
          projectId: input.projectId,
        },
      });

      return { kind: "archived" as const };
    });
  }
}
