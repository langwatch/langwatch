/** Application: completes incomplete upserts and checks cross-project copy
 * reach. Wire mapping and read ceiling live in the doors.
 */
import { PermissionDeniedError } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
import {
  DatasetApi,
  datasetConfig,
  DatasetNotFoundError,
  type DatasetServerConfig,
  type DatasetNormalizePayload,
  type DatasetNormalizationSettledEventData,
  type AppendStoredObjectToDatasetInput,
  type BatchEvaluationEntry,
  type BatchEvaluationRecord,
  type BatchEvaluationSummary,
  type CopyDatasetInput,
  type CountDatasetRecordsInput,
  type CreateDatasetAttachmentUploadInput,
  type CreateDatasetFromStoredObjectInput,
  type CreateDatasetFromUploadInput,
  type CreateDatasetFromUploadResult,
  type StoreDatasetAttachmentUploadInput,
  type StoredDatasetAttachment,
  type CreateDatasetRecordsInput,
  type Dataset,
  type DatasetStorageEntry,
  type DatasetStoragePageInput,
  type DatasetColumns,
  type DatasetEntrySelection,
  type DatasetHead,
  type DatasetImportAppended,
  type DatasetImportStarted,
  type DatasetLimits,
  type DatasetListResult,
  type DatasetLookupInput,
  type DatasetNameInput,
  type DatasetNameResult,
  type DatasetPage,
  type DatasetPageInput,
  type DatasetRecord,
  type DatasetRecordCount,
  type DatasetRecordMutationResult,
  type DatasetRecordPage,
  type DatasetSummary,
  type DatasetUsageCount,
  type DatasetWithRecords,
  type DatasetApiDeleteInput,
  type DeleteDatasetRecordsInput,
  type ListDatasetsInput,
  type RetryNormalizeInput,
  type UpdateDatasetRecordInput,
  type UploadExistingDatasetInput,
  type UpsertDatasetInput,
  type CompareDatasetVersionInput,
  type DatasetVersion,
  type DatasetVersionAuthor,
  type DatasetVersionComparison,
  type DatasetVersionContent,
  type DatasetVersionLookupInput,
  type DatasetVersionPage,
  type DatasetVersionPageInput,
  type DatasetVersionRestored,
  type DatasetVersionRunLink,
  type DatasetVersionHistory,
  type DatasetVersionRestoredEventData,
  type DatasetVersionSavedEventData,
  type FindRunDatasetVersionsInput,
  type ListDatasetVersionsInput,
  type SaveDatasetVersionInput,
  SYSTEM_DATASET_VERSION_AUTHOR,
} from "@langwatch/dataset-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import {
  StoredObjectApi,
  type StoredObjectsCreateUploadOutput,
} from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";
import type { MigrationStepRun } from "@langwatch/upgrade/step";
import { UserApi } from "@langwatch/user-contract";

import {
  buildDatasetNormalizationPipeline,
  type DatasetNormalizationDefinition,
} from "../eventing/dataset-normalization.pipeline.ts";
import {
  buildDatasetVersionsPipeline,
  type DatasetVersionsDefinition,
} from "../eventing/dataset-versions.pipeline.ts";
import type { DatasetRepositories } from "../repositories/dataset.repositories.ts";
import { datasetPlatformUrl } from "../rules/dataset-platform-url.rules.ts";
import { versionAuthorUserIds, withAuthorNames } from "../rules/dataset-version-author.rules.ts";
import { DatasetAttachmentReferenceService } from "../services/dataset-attachment-reference.service.ts";
import { DatasetAttachmentUploadService } from "../services/dataset-attachment-upload.service.ts";
import { DatasetContentService } from "../services/dataset-content.service.ts";
import { DatasetInlineAttachmentService } from "../services/dataset-inline-attachment.service.ts";
import { DatasetNormalizeService } from "../services/dataset-normalize.service.ts";
import { DatasetRequestBoundsService } from "../services/dataset-request-bounds.service.ts";
import { DatasetSingleFileService } from "../services/dataset-single-file.service.ts";
import { DatasetUploadService } from "../services/dataset-upload.service.ts";
import { DatasetVersionBackfillService } from "../services/dataset-version-backfill.service.ts";
import { DatasetVersionRetentionService } from "../services/dataset-version-retention.service.ts";
import { DatasetVersionService } from "../services/dataset-version.service.ts";
import { DatasetService } from "../services/dataset.service.ts";

/** The KSUID resource a new dataset record's id is minted under. */
const DATASET_RECORD_KSUID_RESOURCE = "datasetrecord";
/** The KSUID resource a dataset version's id is minted under. */
const DATASET_VERSION_KSUID_RESOURCE = "datasetversion";

const logger = createLogger("langwatch:dataset:app");

/**
 * An edit inside this window of the last recorded one is not recorded again:
 * the autosave still waits for the whole quiet period after the last record,
 * and the snapshot reads the content as it is then.
 */
const EDIT_NOTE_WINDOW_MS = 30_000;
const EDIT_NOTE_MEMORY = 10_000;

/** Who made a change, when the transport could tell; an unattributed edit is the system's. */
type EditedBy = { editedBy?: DatasetVersionAuthor };

/** The command senders the versions pipeline hands the app once it is registered. */
type DatasetVersionCommands = {
  recordContentEdit: {
    send(input: {
      tenantId: string;
      occurredAt: number;
      projectId: string;
      datasetId: string;
      editedBy: DatasetVersionAuthor;
    }): Promise<unknown>;
  };
  recordVersionSaved: {
    send(
      input: DatasetVersionSavedEventData & { tenantId: string; occurredAt: number },
    ): Promise<unknown>;
  };
  recordVersionRestored: {
    send(
      input: DatasetVersionRestoredEventData & { tenantId: string; occurredAt: number },
    ): Promise<unknown>;
  };
};

type DatasetSetup = FeatureSetup<
  typeof DatasetModule.dependencies,
  DatasetServerConfig,
  DatasetRepositories
>;

/**
 * A create-or-replace: possibly named by slug rather than id, and possibly
 * missing name and columns when only patching what already exists.
 */
interface DatasetUpsertInput {
  projectId: string;
  /** The dataset being replaced, by id. */
  datasetId?: string;
  /**
   * The dataset being replaced, by slug OR id. Resolved to a row, which is
   * also what an unnamed `name` or `columnTypes` is taken from.
   */
  slugOrId?: string;
  name?: string;
  columnTypes?: DatasetColumns;
  datasetRecords?: UpsertDatasetInput["datasetRecords"];
}

export class DatasetModule implements DatasetApi {
  static readonly contract = DatasetApi;
  static readonly dependencies = {
    permissions: AuthzApi,
    /** The directory that answers which organization a project belongs to. */
    projects: ProjectApi,
    /** The bounds the project's organization answers for writes, reads and files. */
    entitlement: EntitlementApi,
    /** Reads the confirmed files a dataset is imported from (ADR-158 §6). */
    storedObjects: StoredObjectApi,
    /** Names the people who saved each version in the history. */
    users: UserApi,
  };
  /** The shared deployment origin; `platformUrl` refuses by name where no `BASE_HOST` was named. */
  static readonly config = datasetConfig;

  #datasets: DatasetService;
  #attachmentUploads: DatasetAttachmentUploadService;
  #requestBounds: DatasetRequestBoundsService;
  #normalization: DatasetNormalizeService;
  #batchEvaluations: DatasetRepositories["batchEvaluations"];
  readonly #repositories: DatasetRepositories;
  #count: DatasetRepositories["count"];
  #permissions: AuthzApi;
  readonly #publicBaseUrl: string | undefined;
  #versions: DatasetVersionService;
  #versionRetention: DatasetVersionRetentionService;
  #versionBackfill: DatasetVersionBackfillService;
  #recordContentEdit: DatasetVersionCommands["recordContentEdit"] | null = null;
  #recordVersionRestored: DatasetVersionCommands["recordVersionRestored"] | null = null;
  readonly #users: UserApi;
  /** Datasets this process has seen holding a version, so an edit skips the first-version check. */
  readonly #versioned = new Set<string>();
  /** When this process last recorded an edit of each dataset, to send at most one per window. */
  readonly #lastEditNotedAt = new Map<string, number>();

  private constructor(
    repositories: DatasetRepositories,
    dependencies: DatasetSetup["dependencies"],
    config: DatasetServerConfig,
  ) {
    const chunks = repositories.chunks;
    this.#repositories = repositories;

    this.#requestBounds = DatasetRequestBoundsService.create({
      entitlement: dependencies.entitlement,
      projects: dependencies.projects,
    });
    this.#attachmentUploads = DatasetAttachmentUploadService.create({
      storedObjects: dependencies.storedObjects,
      requestBounds: this.#requestBounds,
    });
    const inlineAttachments = DatasetInlineAttachmentService.create({
      uploads: this.#attachmentUploads,
    });

    this.#normalization = DatasetNormalizeService.create({
      repository: repositories.content,
      chunks,
      storedObjects: dependencies.storedObjects,
      requestBounds: this.#requestBounds,
      inlineAttachments,
    });

    const singleFile = DatasetSingleFileService.create({
      files: repositories.singleFiles,
      datasets: repositories.content,
      generateId: () => generate(DATASET_RECORD_KSUID_RESOURCE).toString(),
    });

    this.#datasets = DatasetService.create({
      repository: repositories.datasets,
      records: repositories.records,
      uploads: DatasetUploadService.create({
        datasets: repositories.content,
        records: repositories.recordContent,
        chunks,
        storedObjects: dependencies.storedObjects,
        requestBounds: this.#requestBounds,
        inlineAttachments,
        singleFile,
      }),
      queue: this.#normalization,
      content: DatasetContentService.create({ datasets: repositories.content, storage: chunks }),
      singleFile,
      // The identifier format a new entry is written under is this module's
      // own business, not something a composing process supplies: every real
      // composition that ever wired this feature left it unset, and the
      // fallback DatasetService would otherwise reach for (`nanoid`) is not
      // this feature's own choice to make on its behalf.
      generateId: () => generate(DATASET_RECORD_KSUID_RESOURCE).toString(),
      requestBounds: this.#requestBounds,
      attachments: DatasetAttachmentReferenceService.create({
        storedObjects: dependencies.storedObjects,
      }),
      inlineAttachments,
    });

    this.#versions = DatasetVersionService.create({
      versions: repositories.versions,
      versionContent: repositories.versionContent,
      content: repositories.content,
      chunks,
      records: repositories.records,
      lookup: (input) => this.#datasets.getBySlugOrId(input),
      readSingleFile: async (dataset) => {
        const read = await this.#datasets.getDatasetWithRecords({
          slugOrId: dataset.id,
          projectId: dataset.projectId,
          limitMb: null,
        });
        return read.records.map((record) => ({ id: record.id, entry: record.entry }));
      },
      generateId: () => generate(DATASET_VERSION_KSUID_RESOURCE).toString(),
    });
    this.#versionRetention = DatasetVersionRetentionService.create({
      versions: repositories.versions,
      service: this.#versions,
    });
    this.#versionBackfill = DatasetVersionBackfillService.create({
      datasets: repositories.datasets,
      versions: repositories.versions,
      service: this.#versions,
      projects: dependencies.projects,
    });

    this.#batchEvaluations = repositories.batchEvaluations;
    this.#count = repositories.count;
    this.#permissions = dependencies.permissions;
    this.#users = dependencies.users;
    this.#publicBaseUrl = config.publicBaseUrl;
  }

  static create({ repositories, dependencies, config }: DatasetSetup): DatasetModule {
    return new DatasetModule(repositories, dependencies, config);
  }

  // ── Datasets ─────────────────────────────────────────────────────────────

  /** Partial upsert completion (dataset fact, not transport-specific): patch
   * backs up to existing row, or refuse.
   */
  async upsertDataset(input: DatasetUpsertInput & EditedBy): Promise<Dataset> {
    const target = input.datasetId ?? input.slugOrId;
    if (target === undefined) {
      const created = await this.#upsertDataset(input);
      await this.#noteEdit({ dataset: created, editedBy: input.editedBy });
      return created;
    }
    return this.#edited(
      { projectId: input.projectId, slugOrId: target, editedBy: input.editedBy },
      () => this.#upsertDataset(input),
    );
  }

  async #upsertDataset(input: DatasetUpsertInput): Promise<Dataset> {
    const replacing = input.slugOrId
      ? await this.#datasets.getBySlugOrId({
          projectId: input.projectId,
          slugOrId: input.slugOrId,
        })
      : undefined;

    const name = input.name ?? replacing?.name;
    if (!name) throw new Error("A dataset needs a name");

    return this.#datasets.upsertDataset({
      projectId: input.projectId,
      name,
      columnTypes: input.columnTypes ?? replacing?.columnTypes ?? [],
      datasetId: input.datasetId ?? replacing?.id,
      datasetRecords: input.datasetRecords,
    });
  }

  /** The slug a proposed name would get, and whether it is available. */
  validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult> {
    return this.#datasets.validateDatasetName(input);
  }

  /** The next free name for a proposed one. */
  findNextAvailableName(input: DatasetNameInput): Promise<string> {
    return this.#datasets.findNextAvailableName(input);
  }

  /** A page of the project's non-archived datasets. */
  listDatasets(input: ListDatasetsInput): Promise<DatasetListResult> {
    return this.#datasets.listDatasets(input);
  }

  /** The same page without entry counts, so a list renders before its counts arrive. */
  findDatasetSummaries(input: ListDatasetsInput): Promise<DatasetSummary[]> {
    return this.#datasets.findDatasetSummaries(input);
  }

  /** Each named dataset's entry count, whichever storage it uses. */
  countRecords(input: CountDatasetRecordsInput): Promise<DatasetRecordCount[]> {
    return this.#datasets.countRecords(input);
  }

  /** One dataset by slug or id. Missing or archived refuses. */
  getBySlugOrId(input: DatasetLookupInput): Promise<Dataset> {
    return this.#datasets.getBySlugOrId(input);
  }

  /** One dataset by slug or id when the selection may no longer exist. */
  async findBySlugOrId(input: DatasetLookupInput): Promise<Dataset | null> {
    try {
      return await this.#datasets.getBySlugOrId(input);
    } catch (error) {
      if (error instanceof DatasetNotFoundError) {
        return null;
      }

      throw error;
    }
  }

  findBySlug(input: { projectId: string; slug: string }): Promise<Dataset[]> {
    return this.#datasets.findBySlug(input);
  }

  listStoragePage(input: DatasetStoragePageInput): Promise<DatasetStorageEntry[]> {
    return this.#datasets.listStoragePage(input);
  }

  /** Several datasets by id, for the references an evaluation names. */
  getByIds(input: { projectId: string; datasetIds: string[] }): Promise<Dataset[]> {
    return this.#datasets.getByIds(input);
  }

  /** A dataset renamed in place, keeping its columns and its entries. */
  renameDataset(input: { datasetId: string; projectId: string; name: string }): Promise<Dataset> {
    return this.#datasets.renameDataset(input);
  }

  /** The trace and thread mapping a dataset is filled from. */
  updateMapping(input: {
    datasetId: string;
    projectId: string;
    mapping?: { mapping: Record<string, unknown>; expansions: string[] };
    threadMapping?: { mapping: Record<string, unknown> };
  }): Promise<Dataset> {
    return this.#datasets.updateMapping(input);
  }

  /** Archives a dataset. */
  archiveDataset(input: DatasetLookupInput): Promise<{ id: string; archived: true }> {
    return this.#datasets.archiveDataset(input);
  }

  /** Archives a dataset, or restores it when the caller undoes the archive. */
  archiveOrRestoreDataset(input: DatasetApiDeleteInput): Promise<{ success: true }> {
    return this.#datasets.archiveOrRestoreDataset(input);
  }

  /** The whole dataset in one answer, refused rather than truncated when too large for one. */
  getDatasetWithinLimit(input: DatasetLookupInput): Promise<DatasetWithRecords> {
    return this.#datasets.getDatasetWithinLimit(input);
  }

  /** The size limits the project's organization answers. */
  getLimits(input: { projectId: string }): Promise<DatasetLimits> {
    return this.#requestBounds.limits(input.projectId);
  }

  /** The signed upload a file for an image or file cell is sent to. */
  createAttachmentUpload(
    input: CreateDatasetAttachmentUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput> {
    return this.#attachmentUploads.createUpload(input);
  }

  /** Entries removed by id, refused when none matched. */
  deleteMatchingRecords(
    input: DeleteDatasetRecordsInput & EditedBy,
  ): Promise<{ deletedCount: number }> {
    return this.#edited(input, () => this.#datasets.deleteMatchingRecords(withoutAuthor(input)));
  }

  /** Restores a dataset the caller just archived. */
  restoreDataset(input: { datasetId: string; projectId: string }): Promise<{ success: true }> {
    return this.#datasets.restoreDataset(input);
  }

  /** The same dataset in another project, records and all. */
  async copyDataset(input: CopyDatasetInput): Promise<Dataset> {
    const copied = await this.#datasets.copyDataset(input);
    await this.#noteEdit({ dataset: copied });
    return copied;
  }

  /**
   * The same copy, for a person: it also reads a SECOND project — the
   * source — that the door's check never covers, so reach into it is probed
   * here. Holding create on a project implies read on its datasets.
   */
  async copyDatasetForActor(input: CopyDatasetInput & { actorId: string }): Promise<Dataset> {
    const permitted = await this.#permissions.hasPermission({
      userId: input.actorId,
      permission: "datasets:create",
      projectId: input.sourceProjectId,
    });

    if (!permitted) {
      throw new PermissionDeniedError({
        permission: "datasets:create",
        scope: { type: "project", id: input.sourceProjectId },
        denialReason: "no-grant",
      });
    }

    const copied = await this.#datasets.copyDataset({
      sourceDatasetId: input.sourceDatasetId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
    });
    await this.#noteEdit({ dataset: copied, editedBy: { kind: "user", id: input.actorId } });
    return copied;
  }

  // ── Records ──────────────────────────────────────────────────────────────

  /**
   * A dataset and its records in the slice the caller asked for. With no
   * `limitMb` the read is held to what the organization answers inline in one
   * response and reports `truncated`; `null` reads every row or is refused.
   */
  getDatasetWithRecords(
    input: DatasetLookupInput & {
      limitMb?: number | null;
      entrySelection?: DatasetEntrySelection;
    },
  ): Promise<DatasetWithRecords> {
    return this.#datasets.getDatasetWithRecords(input);
  }

  /** One page of a dataset's records, plus the authoritative total. */
  getDatasetPage(input: DatasetPageInput): Promise<DatasetPage> {
    return this.#datasets.getDatasetPage(input);
  }

  /** One records page when its dataset may have been archived or deleted. */
  async findDatasetPage(input: DatasetPageInput): Promise<DatasetPage | null> {
    try {
      return await this.#datasets.getDatasetPage(input);
    } catch (error) {
      if (error instanceof DatasetNotFoundError) {
        return null;
      }

      throw error;
    }
  }

  /** The first entries plus the authoritative total, for previews. */
  getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead> {
    return this.#datasets.getDatasetHead(input);
  }

  /** One page of records on their own. */
  listRecords(input: DatasetPageInput): Promise<DatasetRecordPage> {
    return this.#datasets.listRecords(input);
  }

  /** New entries appended to a dataset. */
  batchCreateRecords(input: CreateDatasetRecordsInput & EditedBy): Promise<DatasetRecord[]> {
    return this.#edited(input, () => this.#datasets.batchCreateRecords(withoutAuthor(input)));
  }

  /** One entry replaced, or created, by id. */
  upsertRecord(
    input: UpdateDatasetRecordInput & { recordId: string } & EditedBy,
  ): Promise<DatasetRecordMutationResult> {
    return this.#edited(input, () => this.#datasets.upsertRecord(withoutAuthor(input)));
  }

  /** Entries removed by id. */
  deleteRecords(input: DeleteDatasetRecordsInput & EditedBy): Promise<{ count: number }> {
    return this.#edited(input, () => this.#datasets.deleteRecords(withoutAuthor(input)));
  }

  // ── Uploads ──────────────────────────────────────────────────────────────

  /** A brand-new dataset from an uploaded file. */
  async createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult> {
    const created = await this.#datasets.createDatasetFromUpload(input);
    await this.#recordEdit({
      projectId: input.projectId,
      datasetId: created.id,
      editedBy: SYSTEM_DATASET_VERSION_AUTHOR,
    });
    return created;
  }

  /** More rows for a dataset that already exists, from an uploaded file. */
  uploadToExistingDataset(
    input: UploadExistingDatasetInput & EditedBy,
  ): Promise<{ datasetId: string; recordsCreated: number }> {
    return this.#edited(
      { projectId: input.projectId, slugOrId: input.slugOrId, editedBy: input.editedBy },
      () => this.#datasets.uploadToExistingDataset(withoutAuthor(input)),
    );
  }

  /** Deprecated with `POST /api/dataset/attachments`: a posted file stored as an attachment. */
  storeAttachmentUpload(
    input: StoreDatasetAttachmentUploadInput,
  ): Promise<StoredDatasetAttachment> {
    return this.#attachmentUploads.store(input);
  }

  /** A dataset built in the background from a confirmed `dataset_import` file. */
  createDatasetFromStoredObject(
    input: CreateDatasetFromStoredObjectInput,
  ): Promise<DatasetImportStarted> {
    return this.#datasets.createDatasetFromStoredObject(input);
  }

  /** A confirmed `dataset_import` file's rows appended to an existing dataset. */
  appendStoredObjectToDataset(
    input: AppendStoredObjectToDatasetInput & EditedBy,
  ): Promise<DatasetImportAppended> {
    return this.#edited(
      { projectId: input.projectId, slugOrId: input.slugOrId, editedBy: input.editedBy },
      () => this.#datasets.appendStoredObjectToDataset(withoutAuthor(input)),
    );
  }

  /** Re-runs normalization for a failed or stuck dataset. */
  retryNormalize(input: RetryNormalizeInput): Promise<{ datasetId: string; status: "processing" }> {
    return this.#datasets.retryNormalize(input);
  }

  // ── Batch evaluations ────────────────────────────────────────────────────

  /** One row per experiment and dataset: how many ran, cost, mean score. */
  summariseBatchEvaluations(input: { projectId: string }): Promise<BatchEvaluationSummary[]> {
    return this.#batchEvaluations.summariseByExperiment(input);
  }

  createBatchEvaluation(input: BatchEvaluationEntry): Promise<void> {
    return this.#batchEvaluations.create(input);
  }

  /** Every batch-evaluation record of one experiment; experiment resolves its slug. */
  listBatchEvaluations(input: {
    projectId: string;
    experimentId: string;
  }): Promise<BatchEvaluationRecord[]> {
    return this.#batchEvaluations.findAllByExperiment(input);
  }

  // ── the platform's own links ──────────────────────────────────────────────

  /**
   * The platform's own address for one dataset resource. A deployment that
   * serves this family but named no public origin refuses by name.
   */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<DatasetUsageCount> {
    return this.#count.countUsage(input);
  }

  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The dataset REST family was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return datasetPlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }

  // ── Versions ─────────────────────────────────────────────────────────────

  /** Every version of the dataset, newest first, named by who saved it. */
  async listVersions(input: ListDatasetVersionsInput): Promise<DatasetVersionHistory> {
    const { versions, restorable } = await this.#versions.history(input);
    const userIds = versionAuthorUserIds(versions);
    const profiles = userIds.length > 0 ? await this.#users.getProfiles({ userIds }) : [];
    const names = new Map(
      profiles.flatMap((profile) => (profile.name ? [[profile.id, profile.name] as const] : [])),
    );
    return { versions: withAuthorNames({ versions, names }), restorable };
  }

  /** The current content saved by hand, optionally named; unchanged content names the latest. */
  async saveVersion(input: SaveDatasetVersionInput & EditedBy): Promise<DatasetVersion> {
    const saved = await this.#versions.snapshot({
      projectId: input.projectId,
      datasetId: input.datasetId,
      trigger: "manual",
      by: input.editedBy ?? SYSTEM_DATASET_VERSION_AUTHOR,
      ...(input.name !== undefined ? { name: input.name } : {}),
    });
    this.#versioned.add(saved.version.datasetId);
    return saved.version;
  }

  getVersionPage(input: DatasetVersionPageInput): Promise<DatasetVersionPage> {
    return this.#versions.page(input);
  }

  compareVersion(input: CompareDatasetVersionInput): Promise<DatasetVersionComparison> {
    return this.#versions.compare(input);
  }

  async restoreVersion(
    input: DatasetVersionLookupInput & EditedBy,
  ): Promise<DatasetVersionRestored> {
    const restored = await this.#versions.restore({
      projectId: input.projectId,
      datasetId: input.datasetId,
      version: input.version,
      by: input.editedBy ?? SYSTEM_DATASET_VERSION_AUTHOR,
    });
    if (restored.changed) await this.#recordRestore({ restored, from: input.version });
    return restored;
  }

  /** Tells every open read of the dataset that its content was replaced; a failure is logged. */
  async #recordRestore({
    restored,
    from,
  }: {
    restored: DatasetVersionRestored;
    from: number;
  }): Promise<void> {
    const { projectId, datasetId, id: versionId, version } = restored.version;
    try {
      await this.#recordVersionRestored?.send({
        projectId,
        datasetId,
        versionId,
        version,
        restoredFromVersion: from,
        tenantId: projectId,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.warn({ error, projectId, datasetId }, "Could not record a dataset restore");
    }
  }

  /** Keeps a version out of retention because an experiment names it. */
  pinVersion(input: DatasetVersionLookupInput): Promise<DatasetVersion> {
    return this.#versions.pin(input);
  }

  /**
   * The version an experiment run reads: the one it pinned, or the current
   * content saved as a version (the latest one when nothing changed).
   */
  async resolveVersionForRun(input: {
    projectId: string;
    datasetId: string;
    version?: number;
    by: DatasetVersionAuthor;
  }): Promise<DatasetVersion> {
    if (input.version !== undefined) {
      return this.#versions.get({ ...input, version: input.version });
    }
    const saved = await this.#versions.snapshot({
      projectId: input.projectId,
      datasetId: input.datasetId,
      trigger: "experiment_run",
      by: input.by,
    });
    this.#versioned.add(saved.version.datasetId);
    return saved.version;
  }

  /** Every row of one version, for a run that reads them all. */
  async readVersion(input: DatasetVersionLookupInput): Promise<DatasetVersionContent> {
    const version = await this.#versions.get(input);
    return { version, rows: await this.#versions.readRows(version) };
  }

  /** Records the version each dataset of a run was read at; such a version is never thinned. */
  linkRunVersions(input: {
    projectId: string;
    runId: string;
    experimentId?: string | null;
    versions: readonly { datasetId: string; versionId: string }[];
  }): Promise<void> {
    return this.#repositories.versions.linkRun({
      projectId: input.projectId,
      runId: input.runId,
      experimentId: input.experimentId ?? null,
      versions: input.versions,
    });
  }

  findRunVersions(input: FindRunDatasetVersionsInput): Promise<DatasetVersionRunLink[]> {
    return this.#repositories.versions.findRunLinks(input);
  }

  /** The autosave a quiet dataset gets; a dataset archived meanwhile is skipped. */
  async autosaveVersion(input: {
    projectId: string;
    datasetId: string;
    editedBy: DatasetVersionAuthor;
  }): Promise<void> {
    try {
      await this.#versions.snapshot({
        projectId: input.projectId,
        datasetId: input.datasetId,
        trigger: "autosave",
        by: input.editedBy,
      });
    } catch (error) {
      if (error instanceof DatasetNotFoundError) return;
      throw error;
    }
  }

  /** Thins every dataset's old version history. */
  async sweepVersionRetention(input: {
    nowMs: number;
  }): Promise<{ datasets: number; thinned: number }> {
    return this.#versionRetention.sweep(input);
  }

  /** The versions pipeline `dataset_versions` registers. */
  versionsPipeline(): DatasetVersionsDefinition {
    return buildDatasetVersionsPipeline({
      autosave: (input) => this.autosaveVersion(input),
      sweepVersionRetention: async (input) => {
        await this.sweepVersionRetention(input);
      },
    });
  }

  connectVersions(commands: DatasetVersionCommands): void {
    this.#recordContentEdit = commands.recordContentEdit;
    this.#recordVersionRestored = commands.recordVersionRestored;
    this.#versions.connect(async (data) => {
      await commands.recordVersionSaved.send({
        ...data,
        tenantId: data.projectId,
        occurredAt: nowInstant().epochMilliseconds,
      });
    });
  }

  /** The `dataset:create-first-versions` background step's run. */
  firstVersionsRun(): MigrationStepRun {
    return (args) => this.#versionBackfill.runStep(args);
  }

  /**
   * Runs an edit: first gives a dataset with no history its version 1 of the
   * content before the edit, then records the edit for the autosave.
   */
  async #edited<T>(
    input: { projectId: string; slugOrId: string } & EditedBy,
    mutate: () => Promise<T>,
  ): Promise<T> {
    const dataset = await this.#datasets.getBySlugOrId({
      projectId: input.projectId,
      slugOrId: input.slugOrId,
    });
    await this.#ensureFirstVersion(dataset);
    const result = await mutate();
    await this.#noteEdit({ dataset, editedBy: input.editedBy });
    return result;
  }

  async #ensureFirstVersion(dataset: Dataset): Promise<void> {
    if (this.#versioned.has(dataset.id) || dataset.status !== "ready") return;
    try {
      const has = await this.#repositories.versions.hasAny({
        projectId: dataset.projectId,
        datasetId: dataset.id,
      });
      if (!has) {
        await this.#versions.snapshot({
          projectId: dataset.projectId,
          datasetId: dataset.id,
          trigger: "initial",
          by: SYSTEM_DATASET_VERSION_AUTHOR,
        });
      }
      this.#versioned.add(dataset.id);
    } catch (error) {
      logger.warn(
        { error, projectId: dataset.projectId, datasetId: dataset.id },
        "Could not save a dataset's first version before an edit; the edit goes ahead",
      );
    }
  }

  async #noteEdit({ dataset, editedBy }: { dataset: Dataset } & EditedBy): Promise<void> {
    const now = nowInstant().epochMilliseconds;
    const last = this.#lastEditNotedAt.get(dataset.id);
    if (last !== undefined && now - last < EDIT_NOTE_WINDOW_MS) return;
    this.#lastEditNotedAt.set(dataset.id, now);
    if (this.#lastEditNotedAt.size > EDIT_NOTE_MEMORY) this.#lastEditNotedAt.clear();
    await this.#recordEdit({
      projectId: dataset.projectId,
      datasetId: dataset.id,
      editedBy: editedBy ?? SYSTEM_DATASET_VERSION_AUTHOR,
    });
  }

  async #recordEdit(input: {
    projectId: string;
    datasetId: string;
    editedBy: DatasetVersionAuthor;
  }): Promise<void> {
    if (!this.#recordContentEdit) return;
    try {
      await this.#recordContentEdit.send({
        ...input,
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.warn({ error, ...input }, "Could not record a dataset edit for its autosave");
    }
  }

  /** The command-only pipeline `dataset_normalization` registers. */
  normalizationPipeline(): DatasetNormalizationDefinition {
    return buildDatasetNormalizationPipeline({
      normalize: {
        normalize: async (payload) => {
          const outcome = await this.#normalization.normalize(payload);
          if (outcome === "ready") {
            await this.#recordEdit({
              projectId: payload.projectId,
              datasetId: payload.datasetId,
              editedBy: SYSTEM_DATASET_VERSION_AUTHOR,
            });
          }
          return outcome;
        },
      },
    });
  }

  /** Imports enqueue onto the registered sender; without one they normalize inline, as on main. */
  connectNormalization(datasetNormalize: EventingCommandSender<DatasetNormalizePayload>): void {
    this.#normalization.connect(async (payload) => {
      await datasetNormalize.send(payload);
    });
  }
}

/**
 * Turning one staged upload into the dataset's chunked content. A seam because the work is all
 * I/O - read the staged object, stream it into chunks, flip the row - and the service that
 * sequences it decides only WHEN a payload is normalized, never HOW.
 */
export interface DatasetNormalize {
  /** Where the dataset rests afterwards; `skipped` when it was not this run's to settle. */
  normalize(payload: DatasetNormalizePayload): Promise<DatasetNormalizeOutcome>;
}

export type DatasetNormalizeOutcome = DatasetNormalizationSettledEventData["status"] | "skipped";

/** The upload seam a dataset service is built over. */
export abstract class DatasetUpload {
  abstract uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }>;
  abstract createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult>;
  abstract createDatasetFromStoredObject(
    input: CreateDatasetFromStoredObjectInput,
  ): Promise<DatasetImportStarted>;
  abstract appendStoredObjectToDataset(
    input: AppendStoredObjectToDatasetInput,
  ): Promise<DatasetImportAppended>;
  abstract retryNormalize(
    input: RetryNormalizeInput,
  ): Promise<{ datasetId: string; status: "processing" }>;
}

/** Durable queue seam used by normalize/finalize work. */
export abstract class DatasetNormalizeQueue {
  abstract enqueueNormalize(input: { datasetId: string; projectId: string }): Promise<void>;
}

/** Content-layout operations for s3_jsonl datasets. Keeps storage decisions
 * out of routes and process-globals out of service.
 */
export abstract class DatasetContent {
  abstract searchRecords(input: {
    dataset: Dataset;
    projectId: string;
    page: number;
    limit: number;
    search: string;
    /** The rows and bytes one search may read. */
    caps: { maxRows: number; maxBytes: number };
  }): Promise<DatasetRecordPage>;
  abstract listRecords(input: {
    dataset: Dataset;
    input: DatasetPageInput;
  }): Promise<DatasetRecordPage>;
  abstract getDatasetPage(input: {
    dataset: Dataset;
    input: DatasetPageInput;
  }): Promise<DatasetPage>;
  abstract getDatasetWithRecords(input: {
    dataset: Dataset;
    projectId: string;
    entrySelection: DatasetEntrySelection;
    /** The byte budget of the read. */
    limitBytes: number;
  }): Promise<DatasetWithRecords>;
  abstract getDatasetHead(input: { dataset: Dataset }): Promise<DatasetHead>;
  abstract findEntries(input: {
    dataset: Dataset;
    projectId: string;
    recordIds: readonly string[];
  }): Promise<Record<string, unknown>[]>;
  abstract upsertRecord(input: {
    dataset: Dataset;
    input: UpdateDatasetRecordInput & { recordId: string };
  }): Promise<DatasetRecordMutationResult>;
  abstract batchCreateRecords(input: {
    dataset: Dataset;
    input: CreateDatasetRecordsInput;
  }): Promise<DatasetRecord[]>;
  abstract deleteRecords(input: {
    dataset: Dataset;
    input: DeleteDatasetRecordsInput;
  }): Promise<{ count: number }>;
  abstract copyDataset(input: {
    source: Dataset;
    sourceProjectId: string;
    target: Dataset;
    targetProjectId: string;
  }): Promise<void>;
  abstract updateColumns(input: {
    dataset: Dataset;
    projectId: string;
    name: string;
    slug: string;
    columnTypes: Dataset["columnTypes"];
  }): Promise<Dataset>;
}

/** The input without who made the edit, for the services that do not record it. */
function withoutAuthor<T extends EditedBy>(input: T): Omit<T, "editedBy"> {
  const { editedBy: _editedBy, ...rest } = input;
  return rest;
}
