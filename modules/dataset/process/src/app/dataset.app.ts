/** Application: completes incomplete upserts and checks cross-project copy
 * reach. Wire mapping and read ceiling live in the doors.
 */
import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import {
  DatasetApi,
  DatasetNotFoundError,
  type DatasetNormalizePayload,
  type AppendStoredObjectToDatasetInput,
  type BatchEvaluationRecord,
  type BatchEvaluationSummary,
  type CopyDatasetInput,
  type CreateDatasetFromStoredObjectInput,
  type CreateDatasetFromUploadInput,
  type CreateDatasetFromUploadResult,
  type StoreDatasetAttachmentUploadInput,
  type StoredDatasetAttachment,
  type CreateDatasetRecordsInput,
  type Dataset,
  type DatasetColumns,
  type DatasetEntrySelection,
  type DatasetHead,
  type DatasetImportAppended,
  type DatasetImportStarted,
  type DatasetListResult,
  type DatasetLookupInput,
  type DatasetNameInput,
  type DatasetNameResult,
  type DatasetPage,
  type DatasetPageInput,
  type DatasetRecord,
  type DatasetRecordMutationResult,
  type DatasetRecordPage,
  type DatasetUsageCount,
  type DatasetWithRecords,
  type DeleteDatasetRecordsInput,
  type ListDatasetsInput,
  type RetryNormalizeInput,
  type UpdateDatasetRecordInput,
  type UploadExistingDatasetInput,
  type UpsertDatasetInput,
} from "@langwatch/dataset-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { ExperimentApi, ExperimentNotFoundError } from "@langwatch/experiment-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { generate } from "@langwatch/ksuid";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { StoredObjectApi } from "@langwatch/stored-object-contract";

import type { DatasetRepositories } from "../repositories/dataset.repositories.ts";
import { ObjectStorageDatasetChunkRepository } from "../repositories/object-storage/object-storage.dataset-chunk.repository.ts";
import { datasetPlatformUrl } from "../rules/dataset-platform-url.rules.ts";
import { DatasetAttachmentReferenceService } from "../services/dataset-attachment-reference.service.ts";
import { DatasetAttachmentUploadService } from "../services/dataset-attachment-upload.service.ts";
import { DatasetContentAdapter } from "../services/dataset-content.service.ts";
import { DatasetNormalizationService } from "../services/dataset-normalization.service.ts";
import { DatasetNormalizeAdapter } from "../services/dataset-normalize.service.ts";
import { DatasetRequestBoundsService } from "../services/dataset-request-bounds.service.ts";
import { DatasetUploadService } from "../services/dataset-upload.service.ts";
import { DatasetService } from "../services/dataset.service.ts";

/** The KSUID resource a new dataset record's id is minted under. */
const DATASET_RECORD_KSUID_RESOURCE = "datasetrecord";

/** Composition-owned members, all optional. Absence never causes boot refusal;
 * code refuses BY NAME when an operation needs one.
 */
export interface DatasetInfrastructure {
  /** Where normalize work is queued; the in-process service when absent. */
  readonly queue?: DatasetNormalizeQueue;
  /** A process-supplied content seam, in place of the resolver-built one. */
  readonly content?: DatasetContent;
}

/**
 * Shapes restated rather than imported: a module depends on contracts.
 * `publicBaseUrl` is the process's own fact, drilled in — absent where the
 * deployment named no `BASE_HOST`. `platformUrl` refuses by name when it is.
 */
type DatasetMembers = Pick<ProcessMembers, "objectStorage"> &
  Readonly<{ publicBaseUrl: string | undefined }> &
  DatasetInfrastructure;

type DatasetSetup = FeatureSetup<
  typeof DatasetApp.dependencies,
  DatasetMembers,
  undefined,
  DatasetRepositories
>;

/**
 * A create-or-replace: possibly named by slug rather than id, possibly
 * naming an experiment instead of a name, and possibly missing name and
 * columns when only patching what already exists.
 */
export interface DatasetUpsertInput {
  projectId: string;
  /** The dataset being replaced, by id. */
  datasetId?: string;
  /**
   * The dataset being replaced, by slug OR id. Resolved to a row, which is
   * also what an unnamed `name` or `columnTypes` is taken from.
   */
  slugOrId?: string;
  /** The experiment whose name the dataset borrows when none is given. */
  experimentId?: string;
  name?: string;
  columnTypes?: DatasetColumns;
  datasetRecords?: UpsertDatasetInput["datasetRecords"];
}

export class DatasetApp implements DatasetApi {
  static readonly contract = DatasetApi;
  static readonly dependencies = {
    experiments: ExperimentApi,
    permissions: AuthzApi,
    /** The directory that answers which organization a project belongs to. */
    projects: ProjectApi,
    /** The tier-effective bounds the record writes refuse above. */
    entitlement: EntitlementApi,
    /** Reads the confirmed files a dataset is imported from (ADR-158 §6). */
    storedObjects: StoredObjectApi,
  };
  /**
   * `publicBaseUrl` is the process's own fact; the rest are the optional,
   * process-specific collaborators in {@link DatasetInfrastructure} — every
   * name a composition may `withMember` must be declared here too.
   */
  static readonly reads = ["publicBaseUrl", "objectStorage", "queue", "content"] as const;

  #datasets: DatasetService;
  #attachmentUploads: DatasetAttachmentUploadService;
  #normalization: DatasetNormalizationService;
  #batchEvaluations: DatasetRepositories["batchEvaluations"];
  #usage: DatasetRepositories["usage"];
  #experiments: ExperimentApi;
  #permissions: AuthzApi;
  readonly #publicBaseUrl: string | undefined;

  private constructor(
    repositories: DatasetRepositories,
    dependencies: DatasetSetup["dependencies"],
    members: DatasetMembers,
  ) {
    const chunks = ObjectStorageDatasetChunkRepository.create({
      objectStorage: members.objectStorage,
    });

    this.#normalization = DatasetNormalizationService.create({
      datasets: repositories.content,
      normalize: DatasetNormalizeAdapter.create({
        repository: repositories.content,
        chunks,
        storedObjects: dependencies.storedObjects,
      }),
    });

    this.#datasets = DatasetService.create({
      repository: repositories.datasets,
      records: repositories.records,
      uploads: DatasetUploadService.create({
        datasets: repositories.content,
        records: repositories.recordContent,
        chunks,
        storedObjects: dependencies.storedObjects,
      }),
      queue: members.queue ?? this.#normalization,
      content:
        members.content ??
        DatasetContentAdapter.create({ datasets: repositories.content, storage: chunks }),
      // The identifier format a new entry is written under is this module's
      // own business, not something a composing process supplies: every real
      // composition that ever wired this feature left it unset, and the
      // fallback DatasetService would otherwise reach for (`nanoid`) is not
      // this feature's own choice to make on its behalf.
      generateId: () => generate(DATASET_RECORD_KSUID_RESOURCE).toString(),
      requestBounds: DatasetRequestBoundsService.create({
        entitlement: dependencies.entitlement,
        projects: dependencies.projects,
      }),
      attachments: DatasetAttachmentReferenceService.create({
        storedObjects: dependencies.storedObjects,
      }),
    });

    this.#attachmentUploads = DatasetAttachmentUploadService.create({
      storedObjects: dependencies.storedObjects,
    });
    this.#batchEvaluations = repositories.batchEvaluations;
    this.#usage = repositories.usage;
    this.#experiments = dependencies.experiments;
    this.#permissions = dependencies.permissions;
    this.#publicBaseUrl = members.publicBaseUrl;
  }

  static create({ repositories, dependencies, members }: DatasetSetup): DatasetApp {
    return new DatasetApp(repositories, dependencies, members);
  }

  // ── Datasets ─────────────────────────────────────────────────────────────

  /** Partial upsert completion (dataset fact, not transport-specific): patch
   * backs up to existing row, borrow name from experimentId, or refuse.
   */
  async upsertDataset(input: DatasetUpsertInput): Promise<Dataset> {
    const replacing = input.slugOrId
      ? await this.#datasets.getBySlugOrId({
          projectId: input.projectId,
          slugOrId: input.slugOrId,
        })
      : undefined;

    const borrowed =
      input.name === undefined && input.experimentId !== undefined
        ? (
            await this.#experiments.getById({
              projectId: input.projectId,
              id: input.experimentId,
            })
          ).name
        : undefined;

    const name = input.name ?? borrowed ?? replacing?.name;
    if (!name) {
      // The experiment case keeps its own wording: the caller named a thing
      // that exists, and the reason the write cannot proceed is that the thing
      // has no name to lend.
      throw new Error(
        input.experimentId
          ? `Experiment ${input.experimentId} has no name`
          : "A dataset needs a name",
      );
    }

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

  /** Restores a dataset the caller just archived. */
  restoreDataset(input: { datasetId: string; projectId: string }): Promise<{ success: true }> {
    return this.#datasets.restoreDataset(input);
  }

  /** The same dataset in another project, records and all. */
  copyDataset(input: CopyDatasetInput): Promise<Dataset> {
    return this.#datasets.copyDataset(input);
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
        denialReason: "no-binding",
      });
    }

    return this.#datasets.copyDataset({
      sourceDatasetId: input.sourceDatasetId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
    });
  }

  // ── Records ──────────────────────────────────────────────────────────────

  /**
   * A dataset and its records, up to the byte budget the CALLER named, in
   * the slice it asked for. Both stay arguments: the editor, an export and
   * an evaluation run all want a different budget and a different slice.
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
  batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]> {
    return this.#datasets.batchCreateRecords(input);
  }

  /** One entry replaced, or created, by id. */
  upsertRecord(
    input: UpdateDatasetRecordInput & { recordId: string },
  ): Promise<DatasetRecordMutationResult> {
    return this.#datasets.upsertRecord(input);
  }

  /** Entries removed by id. */
  deleteRecords(input: DeleteDatasetRecordsInput): Promise<{ count: number }> {
    return this.#datasets.deleteRecords(input);
  }

  // ── Uploads ──────────────────────────────────────────────────────────────

  /** A brand-new dataset from an uploaded file. */
  createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult> {
    return this.#datasets.createDatasetFromUpload(input);
  }

  /** More rows for a dataset that already exists, from an uploaded file. */
  uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }> {
    return this.#datasets.uploadToExistingDataset(input);
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
    input: AppendStoredObjectToDatasetInput,
  ): Promise<DatasetImportAppended> {
    return this.#datasets.appendStoredObjectToDataset(input);
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

  /**
   * Every batch-evaluation record of the experiment a URL slug names. The
   * slug-to-id read is the only thing this feature asks of Experiment, done
   * here so no door reaches a second feature to answer a dataset question.
   */
  async listBatchEvaluations(input: {
    projectId: string;
    experimentSlug: string;
  }): Promise<BatchEvaluationRecord[]> {
    const experiment = await this.#experiments.findBySlug({
      projectId: input.projectId,
      slug: input.experimentSlug,
    });

    if (!experiment) throw new ExperimentNotFoundError(input.experimentSlug);

    return this.#batchEvaluations.findAllByExperiment({
      projectId: input.projectId,
      experimentId: experiment.id,
    });
  }

  // ── the platform's own links ──────────────────────────────────────────────

  /**
   * The platform's own address for one dataset resource. A deployment that
   * serves this family but named no public origin refuses by name.
   */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<DatasetUsageCount> {
    return this.#usage.countUsage(input);
  }

  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The dataset REST family was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return datasetPlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }
}

/**
 * Turning one staged upload into the dataset's chunked content. A seam because the work is all
 * I/O - read the staged object, stream it into chunks, flip the row - and the service that
 * sequences it decides only WHEN a payload is normalized, never HOW.
 */
export interface DatasetNormalize {
  normalize(payload: DatasetNormalizePayload): Promise<void>;
}

/** {@link DatasetInfrastructure}'s process-supplied upload seam. */
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
    limitMb: number | null;
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
