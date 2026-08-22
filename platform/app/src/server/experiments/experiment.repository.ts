import { nanoid } from "nanoid";
import type {
  Experiment,
  ExperimentType,
  Prisma,
  PrismaClient,
} from "~/generated/prisma/client";

/**
 * Max wall-clock a workbench save may run before Prisma aborts it with P2028.
 *
 * The body is four indexed statements, but two of them write a whole workbench
 * state, and an inline dataset makes that state megabytes rather than
 * kilobytes. On top of that, a second writer on the same experiment waits on
 * the row lock the first one holds until it commits, so the wait is bounded by
 * the slowest write ahead of it and not by this transaction's own work.
 *
 * 20 seconds is the same budget `invite.service.ts` gives its batch: enough
 * that only a database in real trouble reaches it, small enough that one save
 * cannot pin a pool connection for a minute. `dataset-lock.ts` sits at 120s
 * because its body does object-storage round-trips, which nothing here does.
 */
const WORKBENCH_TXN_TIMEOUT_MS = 20_000;

/**
 * How long to wait for a pool connection before starting, raised from Prisma's
 * 2s default for the same reason the dataset and invite transactions raise it:
 * a busy pool must not fail a save before it has done any work.
 */
const WORKBENCH_TXN_MAX_WAIT_MS = 10_000;

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

  /**
   * Runs `fn` inside one transaction. The seam's compare-and-set needs it.
   *
   * The options are not tuning. Prisma's 5s default would abort a legitimate
   * save with P2028, which is an unnamed failure the caller cannot act on, and
   * it would do so from inside the compare-and-set, so the caller loses the
   * 409 that tells it to reload. The body is four indexed statements, but two
   * of them carry a whole workbench state, and a second writer on the same
   * experiment waits on the row lock until the first commits.
   */
  async runInTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return await this.prisma.$transaction(fn, {
      timeout: WORKBENCH_TXN_TIMEOUT_MS,
      maxWait: WORKBENCH_TXN_MAX_WAIT_MS,
      isolationLevel: "ReadCommitted",
    });
  }

  /**
   * The columns the workbench seam reads, for an active row addressed by id
   * or by slug. Archived rows are excluded like every other read here, which
   * is what makes an archived experiment read as gone rather than editable.
   */
  async findWorkbenchRow(
    input: { projectId: string; id?: string; slug?: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<{
    id: string;
    slug: string;
    name: string | null;
    type: ExperimentType;
    workbenchState: Prisma.JsonValue;
    workbenchVersion: number;
    updatedAt: Date;
  } | null> {
    if (!input.id && !input.slug) return null;
    return this.findFirstActive(
      {
        where: {
          projectId: input.projectId,
          ...(input.id ? { id: input.id } : {}),
          ...(input.slug ? { slug: input.slug } : {}),
        },
        select: {
          id: true,
          slug: true,
          name: true,
          type: true,
          workbenchState: true,
          workbenchVersion: true,
          updatedAt: true,
        },
      },
      options,
    );
  }

  /**
   * Writes the workbench state only while the stored version still equals
   * `expectedVersion`, which is the compare-and-set itself: the version rides
   * in the WHERE, so a racing writer that already bumped it makes this update
   * match no row and Prisma raises P2025 rather than overwriting newer state.
   */
  async casUpdateWorkbenchState(
    input: {
      id: string;
      projectId: string;
      expectedVersion: number;
      nextVersion: number;
      name?: string | null;
      workbenchState: Prisma.InputJsonValue;
    },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<Experiment> {
    const client = options?.tx ?? this.prisma;
    return await client.experiment.update({
      where: {
        id: input.id,
        projectId: input.projectId,
        archivedAt: null,
        workbenchVersion: input.expectedVersion,
      },
      data: {
        workbenchState: input.workbenchState,
        workbenchVersion: input.nextVersion,
        ...(input.name === undefined ? {} : { name: input.name }),
      },
    });
  }

  /**
   * The single rolling autosave row for an experiment, if it has one. There
   * is at most one by construction: the seam updates it in place instead of
   * inserting, so a long editing session leaves one row behind, not hundreds.
   */
  async findRollingAutosaveVersion(
    input: { projectId: string; experimentId: string },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<{ id: string } | null> {
    const client = options?.tx ?? this.prisma;
    return await client.experimentVersion.findFirst({
      where: {
        projectId: input.projectId,
        experimentId: input.experimentId,
        autoSaved: true,
      },
      select: { id: true },
      orderBy: { version: "desc" },
    });
  }

  async createVersion(
    input: { data: Prisma.ExperimentVersionUncheckedCreateInput },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<void> {
    const client = options?.tx ?? this.prisma;
    await client.experimentVersion.create({ data: input.data });
  }

  async updateVersionById(
    input: {
      id: string;
      projectId: string;
      data: Prisma.ExperimentVersionUncheckedUpdateInput;
    },
    options?: { tx?: Prisma.TransactionClient },
  ): Promise<void> {
    const client = options?.tx ?? this.prisma;
    await client.experimentVersion.update({
      where: { id: input.id, projectId: input.projectId },
      data: input.data,
    });
  }

  async findVersionByNumber(input: {
    projectId: string;
    experimentId: string;
    version: number;
  }): Promise<{ version: number; state: Prisma.JsonValue } | null> {
    return await this.prisma.experimentVersion.findFirst({
      where: {
        projectId: input.projectId,
        experimentId: input.experimentId,
        version: input.version,
      },
      select: { version: true, state: true },
    });
  }

  /** Version list, newest first. `beforeVersion` pages backwards through it. */
  async findVersions(input: {
    projectId: string;
    experimentId: string;
    take: number;
    beforeVersion?: number;
  }): Promise<
    Array<{
      version: number;
      autoSaved: boolean;
      commitMessage: string | null;
      authorId: string | null;
      authorLabel: string;
      createdAt: Date;
    }>
  > {
    return await this.prisma.experimentVersion.findMany({
      where: {
        projectId: input.projectId,
        experimentId: input.experimentId,
        ...(input.beforeVersion === undefined
          ? {}
          : { version: { lt: input.beforeVersion } }),
      },
      select: {
        version: true,
        autoSaved: true,
        commitMessage: true,
        authorId: true,
        authorLabel: true,
        createdAt: true,
      },
      orderBy: { version: "desc" },
      take: input.take,
    });
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
