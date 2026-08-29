/**
 * The dataset feature's application: what all four of its doors call.
 *
 * It holds every service and port the feature needs, and it is the one typed
 * thing a transport is given. Before it, `dataset.api.ts` declared
 * `Readonly<{ dataset: DatasetService; experiments: ... }>`,
 * `dataset-record.api.ts` declared `Readonly<{ dataset: DatasetService }>`,
 * `batch-record.api.ts` declared `Readonly<{ experiments: ... }>`, and the REST
 * family took a bare `() => DatasetService` — four descriptions of one bag,
 * agreeing by attention rather than by construction.
 *
 * Most operations are the service's own and are reached straight through. What
 * lives here as behaviour is what a door would otherwise have to know: how an
 * INCOMPLETE upsert is completed. Both doors had a fill of their own for that
 * hole — the tRPC door borrowed the name of the experiment the caller named,
 * the REST patch borrowed the name and columns of the dataset it was replacing
 * — so "what a partial upsert means" was decided in two places and could
 * answer differently the first time one moved.
 *
 * What is NOT here: the wire mapping each door owns. A missing dataset reads
 * as `null` on the tRPC read and as 404 over REST; a not-ready dataset is
 * `PRECONDITION_FAILED` on one and 425 on the other. Those are translations of
 * one domain failure into two contracts, and they belong to the contract that
 * is being spoken. Each door also keeps its own read ceiling, because a byte
 * budget is what a door ASKS for, not what the dataset is.
 *
 * Spec: packages/features/dataset/specs/dataset-service.feature.
 */
import type {
  AbortPendingUploadInput,
  CopyDatasetInput,
  CreateDatasetFromUploadInput,
  CreateDatasetFromUploadResult,
  CreateDatasetRecordsInput,
  Dataset,
  DatasetColumns,
  DatasetHead,
  DatasetLookupInput,
  DatasetListResult,
  DatasetNameInput,
  DatasetNameResult,
  DatasetPage,
  DatasetPageInput,
  DatasetRecord,
  DatasetRecordMutationResult,
  DatasetRecordPage,
  DatasetService,
  DatasetWithRecords,
  DeleteDatasetRecordsInput,
  FinalizeUploadInput,
  ListDatasetsInput,
  PendingUploadInput,
  PendingUploadResult,
  RetryNormalizeInput,
  StagedUploadInput,
  UpdateDatasetRecordInput,
  UploadExistingDatasetInput,
  UpsertDatasetInput,
} from "@langwatch/dataset-contract";

/**
 * The two experiment reads this feature makes. Declared structurally: Dataset
 * borrows a name from an experiment and turns a URL slug into the id batch
 * records are keyed by, and depends on nothing else the experiment feature
 * owns.
 */
export type DatasetExperimentLookup = Readonly<{
  getById(
    input: Readonly<{ projectId: string; id: string }>,
  ): Promise<Readonly<{ name: string | null }>>;
  tryGetBySlug(
    input: Readonly<{ projectId: string; slug: string }>,
  ): Promise<Readonly<{ id: string }> | null>;
}>;

/** What the process composes this feature's application from. */
export interface DatasetAppDependencies {
  dataset: DatasetService;
  experiments: DatasetExperimentLookup;
}

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

export class DatasetApp {
  static create(dependencies: DatasetAppDependencies): DatasetApp {
    return new DatasetApp(dependencies);
  }

  private constructor(private readonly dependencies: DatasetAppDependencies) {}

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
      ? await this.dependencies.dataset.getBySlugOrId({
          projectId: input.projectId,
          slugOrId: input.slugOrId,
        })
      : undefined;

    const borrowed =
      input.name === undefined && input.experimentId !== undefined
        ? (
            await this.dependencies.experiments.getById({
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

    return this.dependencies.dataset.upsertDataset({
      projectId: input.projectId,
      name,
      columnTypes: input.columnTypes ?? replacing?.columnTypes ?? [],
      datasetId: input.datasetId ?? replacing?.id,
      datasetRecords: input.datasetRecords,
    });
  }

  /** The slug a proposed name would get, and whether it is available. */
  validateDatasetName(input: DatasetNameInput): Promise<DatasetNameResult> {
    return this.dependencies.dataset.validateDatasetName(input);
  }

  /** The next free name for a proposed one. */
  findNextAvailableName(input: DatasetNameInput): Promise<string> {
    return this.dependencies.dataset.findNextAvailableName(input);
  }

  /** A page of the project's non-archived datasets. */
  listDatasets(input: ListDatasetsInput): Promise<DatasetListResult> {
    return this.dependencies.dataset.listDatasets(input);
  }

  /** One dataset by slug or id. Missing or archived refuses. */
  getBySlugOrId(input: DatasetLookupInput): Promise<Dataset> {
    return this.dependencies.dataset.getBySlugOrId(input);
  }

  /** The trace and thread mapping a dataset is filled from. */
  updateMapping(input: {
    datasetId: string;
    projectId: string;
    mapping?: { mapping: Record<string, unknown>; expansions: string[] };
    threadMapping?: { mapping: Record<string, unknown> };
  }): Promise<Dataset> {
    return this.dependencies.dataset.updateMapping(input);
  }

  /** Archives a dataset. */
  archiveDataset(input: DatasetLookupInput): Promise<{ id: string; archived: true }> {
    return this.dependencies.dataset.archiveDataset(input);
  }

  /** Restores a dataset the caller just archived. */
  restoreDataset(input: { datasetId: string; projectId: string }): Promise<{ success: true }> {
    return this.dependencies.dataset.restoreDataset(input);
  }

  /** The same dataset in another project, records and all. */
  copyDataset(input: CopyDatasetInput): Promise<Dataset> {
    return this.dependencies.dataset.copyDataset(input);
  }

  // ── Records ──────────────────────────────────────────────────────────────

  /**
   * A dataset and its records, up to the byte budget the CALLER named. The
   * budget stays an argument: the editor, an export and the public read all
   * want a different one, and the dataset has no opinion about which.
   */
  getDatasetWithRecords(
    input: DatasetLookupInput & { limitMb?: number | null },
  ): Promise<DatasetWithRecords> {
    return this.dependencies.dataset.getDatasetWithRecords(input);
  }

  /** One page of a dataset's records, plus the authoritative total. */
  getDatasetPage(input: DatasetPageInput): Promise<DatasetPage> {
    return this.dependencies.dataset.getDatasetPage(input);
  }

  /** The first entries plus the authoritative total, for previews. */
  getDatasetHead(input: DatasetLookupInput): Promise<DatasetHead> {
    return this.dependencies.dataset.getDatasetHead(input);
  }

  /** One page of records on their own. */
  listRecords(input: DatasetPageInput): Promise<DatasetRecordPage> {
    return this.dependencies.dataset.listRecords(input);
  }

  /** New entries appended to a dataset. */
  batchCreateRecords(input: CreateDatasetRecordsInput): Promise<DatasetRecord[]> {
    return this.dependencies.dataset.batchCreateRecords(input);
  }

  /** One entry replaced, or created, by id. */
  upsertRecord(
    input: UpdateDatasetRecordInput & { recordId: string },
  ): Promise<DatasetRecordMutationResult> {
    return this.dependencies.dataset.upsertRecord(input);
  }

  /** Entries removed by id. */
  deleteRecords(input: DeleteDatasetRecordsInput): Promise<{ count: number }> {
    return this.dependencies.dataset.deleteRecords(input);
  }

  // ── Uploads ──────────────────────────────────────────────────────────────

  /** A brand-new dataset from an uploaded file. */
  createDatasetFromUpload(
    input: CreateDatasetFromUploadInput,
  ): Promise<CreateDatasetFromUploadResult> {
    return this.dependencies.dataset.createDatasetFromUpload(input);
  }

  /** More rows for a dataset that already exists, from an uploaded file. */
  uploadToExistingDataset(
    input: UploadExistingDatasetInput,
  ): Promise<{ datasetId: string; recordsCreated: number }> {
    return this.dependencies.dataset.uploadToExistingDataset(input);
  }

  /** Starts a direct browser-to-storage upload. */
  createPendingUpload(input: PendingUploadInput): Promise<PendingUploadResult> {
    return this.dependencies.dataset.createPendingUpload(input);
  }

  /** Streams a heavy upload into staging where storage is not browser-reachable. */
  writeStagedUpload(input: StagedUploadInput): Promise<void> {
    return this.dependencies.dataset.writeStagedUpload(input);
  }

  /** Size-checks a direct upload and starts processing it. */
  finalizeUpload(input: FinalizeUploadInput): Promise<{ datasetId: string; status: "processing" }> {
    return this.dependencies.dataset.finalizeUpload(input);
  }

  /** Re-runs normalization for a failed or stuck dataset. */
  retryNormalize(input: RetryNormalizeInput): Promise<{ datasetId: string; status: "processing" }> {
    return this.dependencies.dataset.retryNormalize(input);
  }

  /** Cleans up a still-pending upload whose transfer never landed. */
  abortPendingUpload(
    input: AbortPendingUploadInput,
  ): Promise<{ datasetId: string; aborted: true }> {
    return this.dependencies.dataset.abortPendingUpload(input);
  }

  // ── Experiments ──────────────────────────────────────────────────────────

  /**
   * The experiment a URL slug names, or null.
   *
   * Held here so no door reaches a second feature's slice of the process bag
   * to answer a dataset question: the batch-evaluation records a slug leads to
   * are keyed by the experiment's id, and turning one into the other is the
   * only thing this feature asks of Experiment.
   */
  tryGetExperimentBySlug(
    input: Readonly<{ projectId: string; slug: string }>,
  ): Promise<Readonly<{ id: string }> | null> {
    return this.dependencies.experiments.tryGetBySlug(input);
  }
}
