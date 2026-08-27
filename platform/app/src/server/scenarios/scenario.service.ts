import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  Prisma,
  type PrismaClient,
  type Scenario,
  type ScenarioVersion,
} from "~/generated/prisma/client";
import { isRecordNotFoundError } from "~/server/utils/prismaErrors";
import {
  assertAssignableFolder,
  type FolderMembershipClient,
  reconcileFolderMembership,
} from "../suites/folder-membership";
import {
  ScenarioNotFoundError,
  ScenarioStaleVersionError,
  ScenarioVersionNotFoundError,
} from "./errors";
import {
  type CreateScenarioInput,
  ScenarioRepository,
  type ScenarioRunConfig,
  type UpdateScenarioInput,
} from "./scenario.repository";
import {
  buildSnapshotEnvelope,
  diffSnapshotFields,
  parseSnapshotEnvelope,
  SCENARIO_SNAPSHOT_SCHEMA_VERSION,
  type ScenarioActor,
  type ScenarioAuthorLabel,
  type ScenarioSnapshotFields,
  snapshotFieldsOf,
  touchesVersionedFields,
} from "./scenario-versioning";

const tracer = getLangWatchTracer("langwatch.scenarios.service");
const logger = createLogger("langwatch:scenarios:service");

const DEFAULT_VERSION_PAGE_SIZE = 20;
const MAX_VERSION_PAGE_SIZE = 100;

/** Options a write surface passes beside the scenario data. */
export type ScenarioWriteOptions = {
  /** Who saves. Derived from `lastUpdatedById` when the caller sends none. */
  actor?: ScenarioActor;
  /**
   * The version the caller loaded. When sent, a save against any other
   * version is refused with `scenario_stale_version`. When absent the save
   * lands over whatever is there and takes the next number.
   */
  expectedVersion?: number;
  /** One line the history entry shows, e.g. what a restore restored. */
  changeDescription?: string;
};

/** One entry of a scenario's version history, newest first. */
export type ScenarioVersionSummary = {
  version: number;
  authorId: string | null;
  /** Null on the synthesized Created entry: nobody recorded that save. */
  authorLabel: ScenarioAuthorLabel | null;
  changeDescription: string | null;
  changedFields: string[];
  createdAt: Date;
  /**
   * True on the Created entry a pre-versioning scenario shows: it is built
   * from the scenario's createdAt and has no stored snapshot to open or
   * restore.
   */
  isSynthesized: boolean;
};

/** One full version, snapshot included. */
export type ScenarioVersionDetail = ScenarioVersionSummary & {
  fields: ScenarioSnapshotFields;
  schemaVersion: number;
};

/**
 * The recorded writer when a surface names none: the save of a person carries
 * their user id, everything else is the API.
 */
function actorFor(lastUpdatedById: string | null | undefined): ScenarioActor {
  return lastUpdatedById
    ? { userId: lastUpdatedById, label: "user" }
    : { userId: null, label: "api" };
}

/**
 * Recomputes the member list of every folder a write touched, once per folder.
 * Nulls and repeats are dropped, so a move between two folders reconciles both
 * and a move within one reconciles it once.
 *
 * The ids are sorted first. `reconcileFolderMembership` takes a row lock, so
 * two moves between the same pair of folders in opposite directions would
 * deadlock if each locked in the order its caller supplied.
 */
async function reconcileFolders(params: {
  projectId: string;
  folderIds: (string | null | undefined)[];
  tx: FolderMembershipClient;
}): Promise<void> {
  const touchedFolderIds = [
    ...new Set(
      params.folderIds.filter((folderId): folderId is string => !!folderId),
    ),
  ].sort();
  for (const folderId of touchedFolderIds) {
    await reconcileFolderMembership({
      projectId: params.projectId,
      folderId,
      tx: params.tx,
    });
  }
}

/** A stored version row as one history entry. */
function toVersionSummary(row: ScenarioVersion): ScenarioVersionSummary {
  const envelope = parseSnapshotEnvelope(row.snapshot);
  return {
    version: row.version,
    authorId: row.authorId,
    authorLabel: row.authorLabel as ScenarioAuthorLabel,
    changeDescription: row.changeDescription,
    changedFields: envelope.changedFields,
    createdAt: row.createdAt,
    isSynthesized: false,
  };
}

export class ScenarioService {
  constructor(
    private readonly repository: ScenarioRepository,
    private readonly prisma: PrismaClient,
  ) {}

  static create(prisma: PrismaClient): ScenarioService {
    return new ScenarioService(new ScenarioRepository(prisma), prisma);
  }

  async create(
    input: CreateScenarioInput,
    options?: Pick<ScenarioWriteOptions, "actor">,
  ): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.create",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId: input.projectId }, "Creating scenario");
        const folderId = input.folderId ?? null;
        const actor = options?.actor ?? actorFor(input.lastUpdatedById);
        // One transaction holds the row, its v1 version and the folder
        // membership, so a create that fails part way leaves nothing behind.
        const result = await this.prisma.$transaction(async (tx) => {
          if (folderId !== null) {
            await assertAssignableFolder({
              projectId: input.projectId,
              folderId,
              tx,
            });
          }
          const created = await this.repository.create(input, tx);
          await this.repository.createVersionRow(
            {
              scenarioId: created.id,
              projectId: created.projectId,
              version: 1,
              authorId: actor.userId,
              authorLabel: actor.label,
              changeDescription: "Created",
              snapshot: buildSnapshotEnvelope({
                fields: snapshotFieldsOf(created),
                changedFields: [],
              }),
              schemaVersion: SCENARIO_SNAPSHOT_SCHEMA_VERSION,
            },
            tx,
          );
          if (folderId) {
            await reconcileFolderMembership({
              projectId: input.projectId,
              folderId,
              tx,
            });
          }
          return created;
        });
        span.setAttribute("scenario.id", result.id);
        return result;
      },
    );
  }

  async getById(params: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioService.getById",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Fetching scenario by id",
        );
        const result = await this.repository.findById(params);
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Fetch a scenario by ID regardless of its archived status.
   * Used for viewing run results of scenarios that may have been archived.
   */
  async getByIdIncludingArchived(params: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioService.getByIdIncludingArchived",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Fetching scenario by id including archived",
        );
        const result = await this.repository.findByIdIncludingArchived(params);
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Fetch what a run needs off each scenario before it schedules anything:
   * the name, the declared parameters, and the text they render into.
   */
  async getRunConfigByIds(params: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]> {
    return tracer.withActiveSpan(
      "ScenarioService.getRunConfigByIds",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.count": params.ids.length,
        },
      },
      async () => this.repository.findRunConfigByIds(params),
    );
  }

  async getAll(params: { projectId: string }): Promise<Scenario[]> {
    return tracer.withActiveSpan(
      "ScenarioService.getAll",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId: params.projectId }, "Fetching all scenarios");
        const result = await this.repository.findAll(params);
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  async update(params: {
    id: string;
    projectId: string;
    data: UpdateScenarioInput;
    options?: ScenarioWriteOptions;
  }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.update",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async () => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Updating scenario",
        );
        // One transaction holds the row, the version row and both folders'
        // member lists, so a write that fails part way leaves all of them
        // untouched.
        return await this.prisma.$transaction(async (tx) =>
          this.applyUpdate(tx, params),
        );
      },
    );
  }

  /** The body of one update, inside the caller's transaction. */
  private async applyUpdate(
    tx: Prisma.TransactionClient,
    params: {
      id: string;
      projectId: string;
      data: UpdateScenarioInput;
      options?: ScenarioWriteOptions;
    },
  ): Promise<Scenario> {
    const { id, projectId, data, options } = params;
    const existing = await tx.scenario.findFirst({
      where: { id, projectId, archivedAt: null },
    });
    if (!existing) {
      throw new ScenarioNotFoundError();
    }
    if (
      options?.expectedVersion !== undefined &&
      options.expectedVersion !== existing.version
    ) {
      // Refused before the write, not rolled back after it.
      throw new ScenarioStaleVersionError({
        currentVersion: existing.version,
      });
    }
    if (data.folderId !== undefined && data.folderId !== null) {
      await assertAssignableFolder({ projectId, folderId: data.folderId, tx });
    }

    // An update that names an editable field is a save: it bumps the version
    // and records a version row. One that names none (a folder move, an
    // author stamp) leaves the history alone.
    const updated = touchesVersionedFields(data)
      ? await this.saveNewVersion(tx, { existing, data, options })
      : await this.repository.update({ id, projectId, data, tx });

    if (data.folderId !== undefined) {
      await reconcileFolders({
        projectId,
        folderIds: [existing.folderId, data.folderId],
        tx,
      });
    }
    return updated;
  }

  /** Writes the save, bumps the counter and appends the version row. */
  private async saveNewVersion(
    tx: Prisma.TransactionClient,
    params: {
      existing: Scenario;
      data: UpdateScenarioInput;
      options?: ScenarioWriteOptions;
    },
  ): Promise<Scenario> {
    const { existing, data, options } = params;
    const actor = options?.actor ?? actorFor(data.lastUpdatedById);
    let updated: Scenario;
    try {
      updated = await this.repository.updateWithVersionBump({
        id: existing.id,
        projectId: existing.projectId,
        data,
        tx,
        expectedVersion: options?.expectedVersion,
      });
    } catch (error) {
      // The version rode in the WHERE and matched no row: a racing save
      // landed between our read and our write.
      if (
        isRecordNotFoundError(error) &&
        options?.expectedVersion !== undefined
      ) {
        throw new ScenarioStaleVersionError({
          currentVersion: existing.version,
        });
      }
      throw error;
    }
    await this.repository.createVersionRow(
      {
        scenarioId: existing.id,
        projectId: existing.projectId,
        version: updated.version,
        authorId: actor.userId,
        authorLabel: actor.label,
        changeDescription: options?.changeDescription ?? null,
        snapshot: buildSnapshotEnvelope({
          fields: snapshotFieldsOf(updated),
          changedFields: diffSnapshotFields(
            snapshotFieldsOf(existing),
            snapshotFieldsOf(updated),
          ),
        }),
        schemaVersion: SCENARIO_SNAPSHOT_SCHEMA_VERSION,
      },
      tx,
    );
    return updated;
  }

  /**
   * The version history, newest first. `cursor` is the version to page below.
   *
   * A scenario stored before versions existed has no v1 row; the page that
   * reaches the bottom of the stored history closes with a synthesized
   * Created entry built from the scenario's createdAt, so every history
   * starts at 1.
   */
  async listVersions(params: {
    projectId: string;
    scenarioId: string;
    limit?: number;
    cursor?: number;
  }): Promise<{
    versions: ScenarioVersionSummary[];
    nextCursor: number | null;
  }> {
    return tracer.withActiveSpan(
      "ScenarioService.listVersions",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
        },
      },
      async () => {
        // Archived scenarios keep a readable history, like their runs do.
        const scenario = await this.repository.findByIdIncludingArchived({
          id: params.scenarioId,
          projectId: params.projectId,
        });
        if (!scenario) {
          throw new ScenarioNotFoundError();
        }

        const take = Math.min(
          Math.max(params.limit ?? DEFAULT_VERSION_PAGE_SIZE, 1),
          MAX_VERSION_PAGE_SIZE,
        );
        const rows = await this.repository.findVersions({
          projectId: params.projectId,
          scenarioId: params.scenarioId,
          take,
          beforeVersion: params.cursor,
        });
        const versions = rows.map(toVersionSummary);

        const reachedBottom = rows.length < take;
        const hasStoredV1 = rows.some((row) => row.version === 1);
        const pageCoversV1 = params.cursor === undefined || params.cursor > 1;
        if (reachedBottom && !hasStoredV1 && pageCoversV1) {
          versions.push({
            version: 1,
            authorId: null,
            authorLabel: null,
            changeDescription: "Created",
            changedFields: [],
            createdAt: scenario.createdAt,
            isSynthesized: true,
          });
        }

        const last = rows[rows.length - 1];
        return {
          versions,
          nextCursor:
            rows.length === take && last && last.version > 1
              ? last.version
              : null,
        };
      },
    );
  }

  /** One version with its snapshot. Unknown numbers refuse with a code. */
  async getVersion(params: {
    projectId: string;
    scenarioId: string;
    version: number;
  }): Promise<ScenarioVersionDetail> {
    return tracer.withActiveSpan(
      "ScenarioService.getVersion",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
        },
      },
      async () => {
        const scenario = await this.repository.findByIdIncludingArchived({
          id: params.scenarioId,
          projectId: params.projectId,
        });
        if (!scenario) {
          throw new ScenarioNotFoundError();
        }
        const row = await this.repository.findVersionByNumber(params);
        if (!row) {
          throw new ScenarioVersionNotFoundError({
            scenarioId: params.scenarioId,
            version: params.version,
          });
        }
        const envelope = parseSnapshotEnvelope(row.snapshot);
        return {
          ...toVersionSummary(row),
          fields: envelope.fields as ScenarioSnapshotFields,
          schemaVersion: row.schemaVersion,
        };
      },
    );
  }

  /**
   * Brings an old version back by writing it FORWARD as a new save. History
   * is never rewritten: the version restored from is still there, and the
   * restore itself is one more entry in the list.
   *
   * The snapshot carries the editable content only, so the case's folder,
   * archive state and run history ride across unchanged. An archived case is
   * refused: from outside it is gone, and a restore must not resurrect it.
   */
  async restoreVersion(params: {
    projectId: string;
    scenarioId: string;
    version: number;
    actor: ScenarioActor;
  }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.restoreVersion",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
        },
      },
      async () => {
        const scenario = await this.repository.findById({
          id: params.scenarioId,
          projectId: params.projectId,
        });
        if (!scenario) {
          throw new ScenarioNotFoundError();
        }
        const row = await this.repository.findVersionByNumber(params);
        if (!row) {
          throw new ScenarioVersionNotFoundError({
            scenarioId: params.scenarioId,
            version: params.version,
          });
        }
        const { fields } = parseSnapshotEnvelope(row.snapshot);
        return await this.update({
          id: params.scenarioId,
          projectId: params.projectId,
          data: {
            name: fields.name,
            situation: fields.situation,
            criteria: fields.criteria,
            labels: fields.labels,
            parameters:
              fields.parameters === null
                ? Prisma.DbNull
                : (fields.parameters as Prisma.InputJsonValue),
            simulatorModel: fields.simulatorModel,
            judgeModel: fields.judgeModel,
            maxTurns: fields.maxTurns,
            minTurns: fields.minTurns,
            lastUpdatedById: params.actor.userId,
          },
          options: {
            actor: params.actor,
            expectedVersion: scenario.version,
            changeDescription: `Restored from v${params.version}`,
          },
        });
      },
    );
  }

  /**
   * Files a scenario into a folder, or unfiles it with folderId null.
   * The scenario keeps everything else, run history included.
   */
  async moveToFolder(params: {
    scenarioId: string;
    projectId: string;
    folderId: string | null;
  }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.moveToFolder",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
        },
      },
      async () =>
        this.update({
          id: params.scenarioId,
          projectId: params.projectId,
          data: { folderId: params.folderId },
        }),
    );
  }

  /**
   * Copies a scenario's definition and folder membership into a new scenario
   * named "<name> (copy)". Run history stays with the original.
   */
  async duplicate(params: {
    scenarioId: string;
    projectId: string;
    lastUpdatedById?: string;
  }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.duplicate",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
        },
      },
      async (span) => {
        const original = await this.repository.findById({
          id: params.scenarioId,
          projectId: params.projectId,
        });
        if (!original) {
          throw new ScenarioNotFoundError();
        }
        // Goes through create so everything create does for a new scenario
        // (folder reconciliation, its own v1 version row) covers duplicates
        // too: the copy starts a history of its own at version 1.
        const copy = await this.create({
          projectId: original.projectId,
          name: `${original.name} (copy)`,
          situation: original.situation,
          criteria: original.criteria,
          labels: original.labels,
          parameters: original.parameters ?? undefined,
          simulatorModel: original.simulatorModel,
          judgeModel: original.judgeModel,
          maxTurns: original.maxTurns,
          minTurns: original.minTurns,
          folderId: original.folderId,
          lastUpdatedById: params.lastUpdatedById ?? null,
        });
        span.setAttribute("scenario.duplicated_id", copy.id);
        return copy;
      },
    );
  }

  /**
   * Soft-archive a single scenario.
   * Throws if the scenario is not found in the given project.
   */
  async archive(params: { id: string; projectId: string }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.archive",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async () => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Archiving scenario",
        );
        const result = await this.prisma.$transaction(async (tx) => {
          const archived = await this.repository.archive({ ...params, tx });
          if (archived?.folderId) {
            // An archived scenario keeps its folderId for a later restore,
            // but leaves the folder's active member list.
            await reconcileFolderMembership({
              projectId: params.projectId,
              folderId: archived.folderId,
              tx,
            });
          }
          return archived;
        });
        if (!result) {
          throw new ScenarioNotFoundError();
        }
        return result;
      },
    );
  }

  /**
   * Soft-archive multiple scenarios.
   * Returns archived IDs and structured failure details.
   */
  async batchArchive(params: { ids: string[]; projectId: string }): Promise<{
    archived: string[];
    failed: { id: string; error: string }[];
  }> {
    return tracer.withActiveSpan(
      "ScenarioService.batchArchive",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.count": params.ids.length,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, count: params.ids.length },
          "Batch archiving scenarios",
        );

        // Existence is resolved up front so the transaction below archives
        // only rows that exist: missing ids come back as per-id failures, and
        // the found ones archive together with ONE membership recompute per
        // touched folder rather than one per scenario.
        const rows = await this.repository.findManyIncludingArchived({
          ids: params.ids,
          projectId: params.projectId,
        });
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const found = params.ids.filter((id) => rowsById.has(id));
        const failed = params.ids
          .filter((id) => !rowsById.has(id))
          .map((id) => ({ id, error: "Not found" }));

        if (found.length > 0) {
          await this.prisma.$transaction(async (tx) => {
            for (const id of found) {
              await this.repository.archive({
                id,
                projectId: params.projectId,
                tx,
              });
            }
            await reconcileFolders({
              projectId: params.projectId,
              folderIds: found.map((id) => rowsById.get(id)?.folderId),
              tx,
            });
          });
        }

        span.setAttribute("result.archived", found.length);
        span.setAttribute("result.failed", failed.length);
        return { archived: found, failed };
      },
    );
  }
}
