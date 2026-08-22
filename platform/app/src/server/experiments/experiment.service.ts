import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type {
  Experiment,
  Prisma,
  PrismaClient,
} from "~/generated/prisma/client";
import { ExperimentType } from "~/generated/prisma/client";
import type { PersistedEvaluationsV3State } from "../../experiments-v3/types/persistence";
import { KSUID_RESOURCES } from "../../utils/constants";
import { slugify } from "../../utils/slugify";
import {
  isRecordNotFoundError,
  isUniqueConstraintError,
  uniqueConstraintTargets,
} from "../utils/prismaErrors";
import {
  ExperimentNotFoundError,
  ExperimentTypeMismatchError,
  ExperimentVersionNotFoundError,
  InvalidExperimentConfigurationError,
  StaleWorkbenchStateError,
  WorkbenchMissingReferenceError,
} from "./errors";
import { ExperimentRepository } from "./experiment.repository";
import { WorkbenchReferenceRepository } from "./workbenchReference.repository";
import {
  collectWorkbenchReferences,
  parseWorkbenchState,
  stripResults,
  toJsonValue,
} from "./workbenchValidation";

const logger = createLogger("langwatch:experiments:service");

/** Who a workbench write is attributed to. */
export type WorkbenchActorLabel = "user" | "langy" | "api";

export interface WorkbenchActor {
  userId?: string;
  label: WorkbenchActorLabel;
}

/** What a caller reads before it edits. `version` is what it saves back. */
export interface WorkbenchStateView {
  experimentId: string;
  slug: string;
  name: string | null;
  state: PersistedEvaluationsV3State | null;
  version: number;
  updatedAt: Date;
}

export interface WorkbenchSaveResult {
  experimentId: string;
  slug: string;
  version: number;
}

export interface WorkbenchVersionSummary {
  version: number;
  autoSaved: boolean;
  commitMessage: string | null;
  authorId: string | null;
  authorLabel: string;
  createdAt: Date;
}

/**
 * The one thing the seam needs from the broadcaster. Narrow on purpose: the
 * service publishes a single event type and must not be able to reach the
 * rest of the tenant channel.
 */
export interface ExperimentBroadcaster {
  broadcastToTenant(
    tenantId: string,
    event: string,
    eventType: "experiment_updated",
  ): Promise<void>;
}

export interface ExperimentServiceOptions {
  broadcaster?: ExperimentBroadcaster | null;
}

/** Default page size for the version list, and the ceiling a caller can ask. */
const DEFAULT_VERSION_PAGE_SIZE = 50;
const MAX_VERSION_PAGE_SIZE = 100;

/** The schema version every state written by this build carries. */
const WORKBENCH_SCHEMA_VERSION = "1";

/**
 * Service layer for experiment business logic.
 * Owns slug generation, draft naming, lookups, and P2002 retry strategy.
 *
 * It also owns every write to the evaluations workbench state. That is the
 * point of the seam: validation, the version compare-and-set, the version row
 * and the invalidation signal happen once here, so a tRPC caller, a REST
 * caller and the agent executor cannot each get a different subset of them.
 */
export class ExperimentService {
  constructor(
    private readonly repository: ExperimentRepository,
    private readonly references: WorkbenchReferenceRepository,
    private readonly options: ExperimentServiceOptions = {},
  ) {}

  static create(
    prisma: PrismaClient,
    options: ExperimentServiceOptions = {},
  ): ExperimentService {
    return new ExperimentService(
      new ExperimentRepository(prisma),
      new WorkbenchReferenceRepository(prisma),
      options,
    );
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
   * Finds the EVALUATIONS_V3 experiment that backs a studio workflow, or
   * creates one. There is exactly one such experiment per workflow, so every
   * workflow evaluation (studio button or API) lands on the same results page.
   * The workbenchState is refreshed each call so the page reflects the
   * evaluated version's dataset and target.
   */
  async findOrCreateForWorkflow({
    projectId,
    workflowId,
    name,
    workbenchState,
  }: {
    projectId: string;
    workflowId: string;
    name: string;
    workbenchState: unknown;
  }): Promise<{ id: string; slug: string }> {
    const workbenchStateJson = JSON.parse(
      JSON.stringify(workbenchState),
    ) as Prisma.InputJsonValue;

    const existing = await this.repository.findFirstActive({
      where: { projectId, workflowId, type: ExperimentType.EVALUATIONS_V3 },
      select: { id: true, slug: true },
    });

    if (existing) {
      await this.repository.updateById({
        id: existing.id,
        projectId,
        data: {
          workbenchState: workbenchStateJson,
          // The state changed, so the counter has to move even though this
          // write is the platform refreshing a workflow's own evaluation
          // rather than a person editing it. A client holding the old version
          // must still be told it is behind. No version row: there is nothing
          // here a person would want to restore.
          workbenchVersion: { increment: 1 },
        },
      });
      return existing;
    }

    const baseSlug = slugify(name) || "workflow-evaluation";
    const initialSlug = await this.generateUniqueSlug({ baseSlug, projectId });
    // A deterministic id keeps the create idempotent under concurrent
    // evaluations: two requests that both miss the lookup above upsert the same
    // row instead of creating two experiments for one workflow.
    const id = `experiment_${workflowId}`;
    const { slug } = await this.saveWithSlugRetry({
      initialSlug,
      execute: (candidateSlug) =>
        this.repository.upsertById({
          id,
          projectId,
          create: {
            id,
            name,
            slug: candidateSlug,
            projectId,
            type: ExperimentType.EVALUATIONS_V3,
            workflowId,
            workbenchState: workbenchStateJson,
          },
          update: {
            name,
            slug: candidateSlug,
            workbenchState: workbenchStateJson,
          },
        }),
      regenerateSlug: () => this.generateUniqueSlug({ baseSlug, projectId }),
    });
    return { id, slug };
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
   * upsert, or null if no row exists yet (active or archived).
   *
   * Throws `ExperimentNotFoundError` when an archived row matches the id:
   * we cannot let `prisma.experiment.upsert` reach the `update` branch on
   * an archived row, because that would silently resurrect or mutate an
   * archived experiment. From the user's perspective the row is gone,
   * which is exactly what `NOT_FOUND` means.
   */
  async getExistingSlugForUpsert({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<string | null> {
    const status = await this.repository.getRowStatusById({ id, projectId });
    if (!status.exists) return null;
    if (status.archived) throw new ExperimentNotFoundError(id);
    return status.slug;
  }

  /**
   * Returns the full project-wide list (with workflow+currentVersion
   * joined) and the total count, used by the evaluations list UI. Real-time
   * filtering is left to the caller because the discriminant lives in a
   * JSON column.
   */
  async listForEvaluationsBoard({ projectId }: { projectId: string }): Promise<
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

  // -------------------------------------------------------------------------
  // Workbench state: the server-owned write seam.
  // -------------------------------------------------------------------------

  /**
   * Reads an evaluations workbench, with the version a writer must send back.
   * Archived rows read as missing and a row of another experiment type is
   * refused, the same two answers the workbench route has always given.
   */
  async getWorkbenchState({
    projectId,
    id,
    slug,
  }: {
    projectId: string;
    id?: string;
    slug?: string;
  }): Promise<WorkbenchStateView> {
    const row = await this.repository.findWorkbenchRow({ projectId, id, slug });
    if (!row) {
      throw new ExperimentNotFoundError(id ?? slug ?? "");
    }
    if (row.type !== ExperimentType.EVALUATIONS_V3) {
      throw new ExperimentTypeMismatchError();
    }

    return {
      experimentId: row.id,
      slug: row.slug,
      name: row.name,
      state: (row.workbenchState as PersistedEvaluationsV3State | null) ?? null,
      version: row.workbenchVersion,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Writes a workbench state, or refuses.
   *
   * The order matters and is the whole contract: the state is parsed and its
   * references are checked BEFORE the transaction opens, then one transaction
   * reads the row, compares the caller's expected version with the stored one,
   * updates under a compare-and-set, and records the new version row. Nothing
   * is written for a save that fails any of those, so a refused save leaves
   * the reader's own copy the only copy that changed.
   *
   * With no id and no slug this creates a new experiment, which is what the
   * "new evaluation" buttons do.
   */
  async saveWorkbenchState({
    projectId,
    id,
    slug,
    state,
    expectedVersion,
    actor,
    commitMessage,
  }: {
    projectId: string;
    id?: string;
    slug?: string;
    state: unknown;
    expectedVersion?: number;
    actor: WorkbenchActor;
    commitMessage?: string;
  }): Promise<WorkbenchSaveResult> {
    const parsed = parseWorkbenchState(state);
    await this.assertWorkbenchReferencesExist({ projectId, state: parsed });

    const existingId = await this.resolveWorkbenchTargetId({
      projectId,
      id,
      slug,
    });

    if (!existingId) {
      return await this.createEvaluationsV3({
        projectId,
        id,
        state: parsed,
        actor,
        commitMessage,
        validated: true,
      });
    }

    // Resolved outside the transaction: naming a draft reads the project's
    // other experiments, which has no business holding a row lock.
    const name = parsed.name || (await this.findNextDraftName({ projectId }));

    const saved = await this.repository.runInTransaction((tx) =>
      this.writeWorkbenchState({
        tx,
        projectId,
        experimentId: existingId,
        name,
        state: parsed,
        expectedVersion,
        actor,
        commitMessage,
      }),
    );

    await this.publishExperimentUpdated({
      projectId,
      ...saved,
      actorLabel: actor.label,
    });

    return saved;
  }

  /**
   * The transactional half of a save: read, compare versions, update under the
   * compare-and-set, record the version row. Every throw here is a refusal
   * that leaves the row exactly as it was.
   */
  private async writeWorkbenchState({
    tx,
    projectId,
    experimentId,
    name,
    state,
    expectedVersion,
    actor,
    commitMessage,
  }: {
    tx: Prisma.TransactionClient;
    projectId: string;
    experimentId: string;
    name: string;
    state: PersistedEvaluationsV3State;
    expectedVersion?: number;
    actor: WorkbenchActor;
    commitMessage?: string;
  }): Promise<WorkbenchSaveResult> {
    const row = await this.repository.findWorkbenchRow(
      { projectId, id: experimentId },
      { tx },
    );
    if (!row) throw new ExperimentNotFoundError(experimentId);
    if (row.type !== ExperimentType.EVALUATIONS_V3) {
      throw new ExperimentTypeMismatchError();
    }

    const stale = new StaleWorkbenchStateError({
      currentVersion: row.workbenchVersion,
    });

    // Refused before the write, not rolled back after it.
    if (
      expectedVersion !== undefined &&
      expectedVersion !== row.workbenchVersion
    ) {
      throw stale;
    }

    const nextVersion = row.workbenchVersion + 1;

    try {
      await this.repository.casUpdateWorkbenchState(
        {
          id: row.id,
          projectId,
          expectedVersion: row.workbenchVersion,
          nextVersion,
          name,
          workbenchState: toJsonValue(state),
        },
        { tx },
      );
    } catch (error) {
      if (isRecordNotFoundError(error)) throw stale;
      throw error;
    }

    await this.writeVersionRow({
      tx,
      projectId,
      experimentId: row.id,
      version: nextVersion,
      state,
      actor,
      commitMessage,
    });

    return { experimentId: row.id, slug: row.slug, version: nextVersion };
  }

  /**
   * Creates an evaluations workbench at version 1, with a numbered version row
   * so its history starts where the experiment does.
   *
   * `state` is required: the shape a blank workbench starts from is the
   * client's to decide (it is what the "new evaluation" buttons build), and a
   * server-side guess at it would be a second definition of the same thing.
   * `name` is the fallback when the state does not carry one.
   */
  async createEvaluationsV3({
    projectId,
    id,
    name,
    state,
    actor,
    commitMessage,
    validated = false,
  }: {
    projectId: string;
    id?: string;
    name?: string;
    state: unknown;
    actor: WorkbenchActor;
    commitMessage?: string;
    /** Set by `saveWorkbenchState`, which has already parsed and checked. */
    validated?: boolean;
  }): Promise<WorkbenchSaveResult> {
    const parsed = validated
      ? (state as PersistedEvaluationsV3State)
      : parseWorkbenchState(state);
    if (!validated) {
      await this.assertWorkbenchReferencesExist({ projectId, state: parsed });
    }

    const experimentId = id ?? generate(KSUID_RESOURCES.EXPERIMENT).toString();
    const resolvedName =
      parsed.name || name || (await this.findNextDraftName({ projectId }));
    const baseSlug = parsed.experimentSlug ?? experimentId.slice(-8);
    const initialSlug = await this.generateUniqueSlug({
      baseSlug,
      projectId,
    });

    const { slug } = await this.createWithSlugRetry({
      id,
      initialSlug,
      baseSlug,
      projectId,
      execute: (candidateSlug) =>
        this.repository.runInTransaction(async (tx) => {
          await this.repository.create(
            {
              data: {
                id: experimentId,
                projectId,
                name: resolvedName,
                slug: candidateSlug,
                type: ExperimentType.EVALUATIONS_V3,
                workbenchState: toJsonValue(parsed),
                workbenchVersion: 1,
              },
            },
            { tx },
          );
          await this.repository.createVersion(
            {
              data: {
                experimentId,
                projectId,
                version: 1,
                autoSaved: false,
                commitMessage: commitMessage ?? null,
                authorId: actor.userId ?? null,
                authorLabel: actor.label,
                state: toJsonValue(stripResults(parsed)),
                schemaVersion: WORKBENCH_SCHEMA_VERSION,
              },
            },
            { tx },
          );
        }),
    });

    const created = { experimentId, slug, version: 1 };
    await this.publishExperimentUpdated({
      projectId,
      ...created,
      actorLabel: actor.label,
    });
    return created;
  }

  /**
   * Reads the current state, hands it to `transform`, and saves the result
   * back at the version it was read at. This is the one entry point an
   * automated editor needs: it cannot skip validation, cannot skip the version
   * check, and cannot write a state the workbench would refuse to load.
   */
  async applyWorkbenchTransform({
    projectId,
    id,
    slug,
    expectedVersion,
    actor,
    commitMessage,
    transform,
  }: {
    projectId: string;
    id?: string;
    slug?: string;
    expectedVersion?: number;
    actor: WorkbenchActor;
    commitMessage?: string;
    transform: (
      state: PersistedEvaluationsV3State,
    ) => PersistedEvaluationsV3State | Promise<PersistedEvaluationsV3State>;
  }): Promise<{ version: number; state: PersistedEvaluationsV3State }> {
    const current = await this.getWorkbenchState({ projectId, id, slug });
    if (!current.state) {
      throw new InvalidExperimentConfigurationError(current.slug);
    }

    const next = await transform(current.state);
    const saved = await this.saveWorkbenchState({
      projectId,
      id: current.experimentId,
      state: next,
      expectedVersion: expectedVersion ?? current.version,
      actor,
      commitMessage,
    });

    return { version: saved.version, state: parseWorkbenchState(next) };
  }

  /**
   * Snapshots the live state as a numbered version. The state does not change;
   * only the version advances, which is what puts a named entry in the list.
   */
  async commitWorkbenchVersion({
    projectId,
    id,
    commitMessage,
    actor,
  }: {
    projectId: string;
    id: string;
    commitMessage: string;
    actor: WorkbenchActor;
  }): Promise<WorkbenchSaveResult> {
    const current = await this.getWorkbenchState({ projectId, id });
    if (!current.state) {
      throw new InvalidExperimentConfigurationError(current.slug);
    }

    return await this.saveWorkbenchState({
      projectId,
      id: current.experimentId,
      state: current.state,
      expectedVersion: current.version,
      actor,
      commitMessage,
    });
  }

  /** The version list, newest first. `cursor` is the version to page below. */
  async listWorkbenchVersions({
    projectId,
    id,
    limit,
    cursor,
  }: {
    projectId: string;
    id: string;
    limit?: number;
    cursor?: number;
  }): Promise<{
    versions: WorkbenchVersionSummary[];
    nextCursor: number | null;
  }> {
    const row = await this.repository.findWorkbenchRow({ projectId, id });
    if (!row) throw new ExperimentNotFoundError(id);

    const take = Math.min(
      Math.max(limit ?? DEFAULT_VERSION_PAGE_SIZE, 1),
      MAX_VERSION_PAGE_SIZE,
    );
    const versions = await this.repository.findVersions({
      projectId,
      experimentId: row.id,
      take,
      beforeVersion: cursor,
    });

    const last = versions[versions.length - 1];
    return {
      versions,
      nextCursor: versions.length === take && last ? last.version : null,
    };
  }

  /**
   * Brings an old version back by writing it FORWARD as a new save. History is
   * never rewritten: the version you restored from is still there, and the
   * restore itself is one more entry in the list.
   */
  async restoreWorkbenchVersion({
    projectId,
    id,
    version,
    actor,
  }: {
    projectId: string;
    id: string;
    version: number;
    actor: WorkbenchActor;
  }): Promise<WorkbenchSaveResult> {
    const current = await this.getWorkbenchState({ projectId, id });
    const found = await this.repository.findVersionByNumber({
      projectId,
      experimentId: current.experimentId,
      version,
    });
    if (!found) {
      throw new ExperimentVersionNotFoundError({
        experimentId: current.experimentId,
        version,
      });
    }

    return await this.saveWorkbenchState({
      projectId,
      id: current.experimentId,
      state: found.state,
      expectedVersion: current.version,
      actor,
      commitMessage: `Restored from v${version}`,
    });
  }

  /**
   * `saveWithSlugRetry` with one extra answer.
   *
   * A create can hit a unique violation for two very different reasons. On the
   * slug it is a race between two people naming an evaluation the same thing,
   * and regenerating the slug is the fix. On the primary key it means the
   * caller named an id that exists OUTSIDE this project, and no retry helps:
   * that row is not theirs to write, which is the same answer as a row that
   * does not exist, said without confirming which ids other tenants hold.
   */
  private async createWithSlugRetry({
    id,
    initialSlug,
    baseSlug,
    projectId,
    execute,
  }: {
    id?: string;
    initialSlug: string;
    baseSlug: string;
    projectId: string;
    execute: (slug: string) => Promise<void>;
  }): Promise<{ slug: string }> {
    try {
      const { slug } = await this.saveWithSlugRetry({
        initialSlug,
        execute,
        regenerateSlug: () => this.generateUniqueSlug({ baseSlug, projectId }),
      });
      return { slug };
    } catch (error) {
      const targets = uniqueConstraintTargets(error).map((target) =>
        target.toLowerCase(),
      );
      const isSlugClash = targets.some((target) => target.includes("slug"));
      if (id && isUniqueConstraintError(error) && !isSlugClash) {
        throw new ExperimentNotFoundError(id, { reasons: [error as Error] });
      }
      throw error;
    }
  }

  /**
   * Resolves which existing row a save targets, or null when there is none to
   * update. An archived row is refused rather than resurrected: from outside
   * it is gone, and a stale client autosaving into it must not bring it back.
   */
  private async resolveWorkbenchTargetId({
    projectId,
    id,
    slug,
  }: {
    projectId: string;
    id?: string;
    slug?: string;
  }): Promise<string | null> {
    if (id) {
      const status = await this.repository.getRowStatusById({ id, projectId });
      if (!status.exists) return null;
      if (status.archived) throw new ExperimentNotFoundError(id);
      return id;
    }

    if (slug) {
      const row = await this.repository.findWorkbenchRow({ projectId, slug });
      if (!row) throw new ExperimentNotFoundError(slug);
      return row.id;
    }

    return null;
  }

  /**
   * One lookup per kind of reference, and the first one that is missing stops
   * the save. Naming the kind and the id lets a client point at the offending
   * target instead of asking the person to hunt for it.
   */
  private async assertWorkbenchReferencesExist({
    projectId,
    state,
  }: {
    projectId: string;
    state: PersistedEvaluationsV3State;
  }): Promise<void> {
    for (const [refType, ids] of collectWorkbenchReferences(state)) {
      const existing = await this.references.findExistingIds({
        refType,
        ids,
        projectId,
      });
      const missing = ids.find((refId) => !existing.has(refId));
      if (missing) {
        throw new WorkbenchMissingReferenceError({ refType, refId: missing });
      }
    }
  }

  /**
   * Records the version row for an accepted write.
   *
   * A person typing gets ONE rolling row, updated in place: the workbench
   * autosaves constantly and a row per keystroke would bury the versions that
   * mean something. Everything else (a named commit, an agent write, a
   * restore) inserts a numbered row, because each of those is an event
   * somebody will want to find again.
   */
  private async writeVersionRow({
    tx,
    projectId,
    experimentId,
    version,
    state,
    actor,
    commitMessage,
  }: {
    tx: Prisma.TransactionClient;
    projectId: string;
    experimentId: string;
    version: number;
    state: PersistedEvaluationsV3State;
    actor: WorkbenchActor;
    commitMessage?: string;
  }): Promise<void> {
    const snapshot = toJsonValue(stripResults(state));
    const isRollingAutosave = actor.label === "user" && !commitMessage;

    if (isRollingAutosave) {
      const rolling = await this.repository.findRollingAutosaveVersion(
        { projectId, experimentId },
        { tx },
      );
      if (rolling) {
        await this.repository.updateVersionById(
          {
            id: rolling.id,
            projectId,
            data: {
              version,
              state: snapshot,
              authorId: actor.userId ?? null,
              authorLabel: actor.label,
              commitMessage: null,
              schemaVersion: WORKBENCH_SCHEMA_VERSION,
            },
          },
          { tx },
        );
        return;
      }
    }

    await this.repository.createVersion(
      {
        data: {
          experimentId,
          projectId,
          version,
          autoSaved: isRollingAutosave,
          commitMessage: commitMessage ?? null,
          authorId: actor.userId ?? null,
          authorLabel: actor.label,
          state: snapshot,
          schemaVersion: WORKBENCH_SCHEMA_VERSION,
        },
      },
      { tx },
    );
  }

  /**
   * Tells the tenant an experiment moved. The payload carries no state: every
   * client refetches, so a signal that outran its own transaction still costs
   * one query and never shows stale content.
   *
   * A failed publish is logged and swallowed. Freshness is a convenience; the
   * save is already durable and losing the signal must not undo it.
   */
  private async publishExperimentUpdated({
    projectId,
    experimentId,
    slug,
    version,
    actorLabel,
  }: {
    projectId: string;
    experimentId: string;
    slug: string;
    version: number;
    actorLabel: WorkbenchActorLabel;
  }): Promise<void> {
    const broadcaster = this.options.broadcaster;
    if (!broadcaster) return;

    try {
      await broadcaster.broadcastToTenant(
        projectId,
        JSON.stringify({
          event: "experiment_updated",
          experimentId,
          slug,
          version,
          actorLabel,
        }),
        "experiment_updated",
      );
    } catch (error) {
      logger.warn(
        { projectId, experimentId, version, error },
        "Failed to broadcast experiment update",
      );
    }
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
