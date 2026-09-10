/**
 * The dataset feature's application: what all four of its doors call.
 *
 * Most operations are the service's own and are reached straight through. What
 * lives here as behaviour is what a door would otherwise have to know: how an
 * INCOMPLETE upsert is completed, and whose reach a copy out of a SECOND
 * project is checked against. Both doors had a fill of their own for the first
 * — the tRPC door borrowed the name of the experiment the caller named, the
 * REST patch borrowed the name and columns of the dataset it was replacing —
 * so "what a partial upsert means" was decided in two places and could answer
 * differently the first time one moved.
 *
 * What is NOT here: the wire mapping each door owns. Each door also keeps its
 * own read ceiling, because a byte budget is what a door ASKS for, not what
 * the dataset is.
 *
 * Spec: modules/dataset/specs/dataset-service.feature.
 */
import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import {
  DatasetApi,
  type AbortPendingUploadInput,
  type BatchEvaluationRecord,
  type BatchEvaluationSummary,
  type CopyDatasetInput,
  type CreateDatasetFromUploadInput,
  type CreateDatasetFromUploadResult,
  type CreateDatasetRecordsInput,
  type Dataset,
  type DatasetColumns,
  type DatasetEntrySelection,
  type DatasetHead,
  type DatasetListResult,
  type DatasetLookupInput,
  type DatasetNameInput,
  type DatasetNameResult,
  type DatasetPage,
  type DatasetPageInput,
  type DatasetRecord,
  type DatasetRecordMutationResult,
  type DatasetRecordPage,
  type DatasetWithRecords,
  type DeleteDatasetRecordsInput,
  type FinalizeUploadInput,
  type ListDatasetsInput,
  type PendingUploadInput,
  type PendingUploadResult,
  type RetryNormalizeInput,
  type StagedUploadInput,
  type UpdateDatasetRecordInput,
  type UploadExistingDatasetInput,
  type UpsertDatasetInput,
} from "@langwatch/dataset-contract";
import { ExperimentApi, ExperimentNotFoundError } from "@langwatch/experiment-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";

import { DatasetContentAdapter } from "../adapters/dataset-content.adapter.ts";
import { DatasetNormalizeAdapter } from "../adapters/dataset-normalize.adapter.ts";
import { DatasetUploadAdapter } from "../adapters/dataset-upload.adapter.ts";
import type { DatasetStorageResolverPort } from "../ports/dataset-storage.port.ts";
import type {
  DatasetContentPort,
  DatasetNormalizeQueuePort,
  DatasetUploadPort,
} from "../ports/dataset.port.ts";
import type { DatasetRepositories } from "../repositories/dataset.repositories.ts";
import { DatasetNormalizationService } from "../services/dataset-normalization.service.ts";
import { DatasetService } from "../services/dataset.service.ts";

/**
 * What the composing process owns and this feature may not build for itself.
 *
 * Every member is optional because a single-node self-hosted deployment has no
 * object storage at all (ADR-032): with no resolver the feature still serves
 * every relational dataset and refuses the direct-upload doors by name.
 */
export interface DatasetInfrastructure {
  /** Where a project's dataset content is stored, when the deployment has any. */
  readonly storageResolver?: DatasetStorageResolverPort;
  /** A process-supplied upload port, in place of the resolver-built one. */
  readonly storage?: DatasetUploadPort;
  /** Where normalize work is queued; the in-process service when absent. */
  readonly queue?: DatasetNormalizeQueuePort;
  /** A process-supplied content port, in place of the resolver-built one. */
  readonly content?: DatasetContentPort;
  /** The identifier format a new entry is written under. */
  readonly generateId?: () => string;
}

type DatasetSetup = FeatureSetup<
  typeof DatasetApp.dependencies,
  DatasetInfrastructure,
  undefined,
  DatasetRepositories
>;

/**
 * A create-or-replace, as a door has it: possibly naming the dataset by slug
 * rather than id, possibly naming an experiment instead of a name, and
 * possibly naming neither a name nor the columns because it is patching what
 * already exists. {@link DatasetApp.upsertDataset} completes it.
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
  static readonly dependencies = { experiments: ExperimentApi, permissions: AuthzApi };

  #datasets: DatasetService;
  #normalization: DatasetNormalizationService | null;
  #batchEvaluations: DatasetRepositories["batchEvaluations"];
  #experiments: ExperimentApi;
  #permissions: AuthzApi;

  private constructor(
    repositories: DatasetRepositories,
    dependencies: DatasetSetup["dependencies"],
    infrastructure: DatasetInfrastructure,
  ) {
    const resolver = infrastructure.storageResolver;

    this.#normalization = resolver
      ? DatasetNormalizationService.create({
          datasets: repositories.content,
          normalize: DatasetNormalizeAdapter.create({
            repository: repositories.content,
            getStorage: (projectId) => resolver.forProject(projectId),
          }),
        })
      : null;

    this.#datasets = DatasetService.create({
      repository: repositories.datasets,
      records: repositories.records,
      uploads:
        infrastructure.storage ??
        (resolver
          ? DatasetUploadAdapter.create({
              datasets: repositories.content,
              records: repositories.recordContent,
              storageResolver: resolver,
            })
          : undefined),
      queue: infrastructure.queue ?? this.#normalization ?? undefined,
      content:
        infrastructure.content ??
        (resolver
          ? DatasetContentAdapter.create({
              datasets: repositories.content,
              storageResolver: resolver,
            })
          : undefined),
      storageResolver: resolver,
      generateId: infrastructure.generateId,
    });

    this.#batchEvaluations = repositories.batchEvaluations;
    this.#experiments = dependencies.experiments;
    this.#permissions = dependencies.permissions;
  }

  static create({ repositories, dependencies, infrastructure }: DatasetSetup): DatasetApp {
    return new DatasetApp(repositories, dependencies, infrastructure);
  }

  // ── Datasets ─────────────────────────────────────────────────────────────

  /**
   * Creates a dataset, or replaces an existing one's columns and entries.
   *
   * The completion is here rather than in each door because what a partial
   * upsert MEANS is a fact about the dataset, not about the transport it
   * arrived over. Three rules, in this order:
   *
   *  - a `slugOrId` names the row being replaced, and that row is what an
   *    absent `name` or `columnTypes` falls back to, so a patch that sends one
   *    field does not blank the other;
   *  - an `experimentId` with no `name` borrows the experiment's name, which is
   *    how the experiment pages create the dataset a run writes into;
   *  - with neither, there is nothing to call the dataset and the write is
   *    refused before the service is touched.
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

  /** Several datasets by id, for the references an evaluation names. */
  getByIds(input: { projectId: string; datasetIds: string[] }): Promise<Dataset[]> {
    return this.#datasets.getByIds(input);
  }

  /** A dataset renamed in place, keeping its columns and its entries. */
  renameDataset(input: {
    datasetId: string;
    projectId: string;
    name: string;
  }): Promise<Dataset> {
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
   * The same copy, on behalf of a person.
   *
   * A copy reads a SECOND project — the source — that a door's declared check
   * never covers, so the person's reach into it is probed here, where the read
   * is made. Holding create on a project implies being able to read its
   * datasets, which is what a copy does.
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
   * A dataset and its records, up to the byte budget the CALLER named, and in
   * the slice the caller asked for. Both stay arguments: the editor, an export
   * and an evaluation run all want a different budget, and a run reads the
   * first, the last, a random or every entry depending on how it was set up.
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

  /** Starts a direct browser-to-storage upload. */
  createPendingUpload(input: PendingUploadInput): Promise<PendingUploadResult> {
    return this.#datasets.createPendingUpload(input);
  }

  /** Streams a heavy upload into staging where storage is not browser-reachable. */
  writeStagedUpload(input: StagedUploadInput): Promise<void> {
    return this.#datasets.writeStagedUpload(input);
  }

  /** Size-checks a direct upload and starts processing it. */
  finalizeUpload(input: FinalizeUploadInput): Promise<{ datasetId: string; status: "processing" }> {
    return this.#datasets.finalizeUpload(input);
  }

  /** Re-runs normalization for a failed or stuck dataset. */
  retryNormalize(input: RetryNormalizeInput): Promise<{ datasetId: string; status: "processing" }> {
    return this.#datasets.retryNormalize(input);
  }

  /** Cleans up a still-pending upload whose transfer never landed. */
  abortPendingUpload(
    input: AbortPendingUploadInput,
  ): Promise<{ datasetId: string; aborted: true }> {
    return this.#datasets.abortPendingUpload(input);
  }

  // ── Batch evaluations ────────────────────────────────────────────────────

  /** One row per experiment and dataset: how many ran, cost, mean score. */
  summariseBatchEvaluations(input: { projectId: string }): Promise<BatchEvaluationSummary[]> {
    return this.#batchEvaluations.summariseByExperiment(input);
  }

  /**
   * Every batch-evaluation record of the experiment a URL slug names.
   *
   * The slug-to-id read is the only thing this feature asks of Experiment, and
   * it is made here so no door reaches a second feature to answer a dataset
   * question.
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
}
