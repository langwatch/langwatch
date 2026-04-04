import { type LangwatchApiClient } from "@/internal/api/client";
import { type Logger } from "@/logger";
import { DatasetService } from "./dataset.service";
import { DatasetApiError } from "./errors";
import {
  type Dataset,
  type DatasetMetadata,
  type GetDatasetOptions,
  type ListDatasetsOptions,
  type ListDatasetsApiResponse,
  type ListRecordsOptions,
  type ListRecordsApiResponse,
  type CreateDatasetOptions,
  type UpdateDatasetOptions,
  type CreateFromUploadOptions,
  type CreateFromUploadResponse,
  type BatchCreateRecordsResponse,
  type DeleteRecordsResponse,
  type UploadResponse,
  type DatasetRecordResponse,
} from "./types";

type DatasetsFacadeConfig = {
  langwatchApiClient: LangwatchApiClient;
  logger: Logger;
  endpoint: string;
  apiKey: string;
};

/**
 * Facade for dataset operations in the LangWatch SDK.
 * Provides a simplified interface for managing datasets, records, and file uploads.
 *
 * @example
 * ```typescript
 * const langwatch = new LangWatch({ apiKey: "your-api-key" });
 *
 * // List all datasets
 * const datasets = await langwatch.datasets.list();
 *
 * // Get a dataset by slug or ID
 * const dataset = await langwatch.datasets.get("my-dataset");
 *
 * // Create a new dataset
 * const newDataset = await langwatch.datasets.create({
 *   name: "my-dataset",
 *   columnTypes: [{ name: "input", type: "string" }],
 * });
 *
 * // Update a dataset
 * const updated = await langwatch.datasets.update("my-dataset", { name: "new-name" });
 *
 * // Delete a dataset
 * const archived = await langwatch.datasets.delete("my-dataset");
 *
 * // Create records
 * const records = await langwatch.datasets.createRecords("my-dataset", [
 *   { input: "hello", output: "world" },
 * ]);
 *
 * // Update a record
 * const record = await langwatch.datasets.updateRecord("my-dataset", "rec-1", { input: "updated" });
 *
 * // Delete records
 * const result = await langwatch.datasets.deleteRecords("my-dataset", ["rec-1", "rec-2"]);
 *
 * // Upload a file
 * const uploadResult = await langwatch.datasets.upload("my-dataset", file);
 * ```
 */
export class DatasetsFacade {
  readonly #datasetService: DatasetService;

  constructor(config: DatasetsFacadeConfig) {
    this.#datasetService = new DatasetService(config);
  }

  /**
   * Lists all datasets for the project, with optional pagination.
   *
   * @param options - Pagination options (page, limit)
   * @returns Paginated list of datasets with metadata
   */
  list = (options?: ListDatasetsOptions): Promise<ListDatasetsApiResponse> => {
    return this.#datasetService.listDatasets(options);
  };

  /**
   * Creates a new dataset.
   *
   * @param options - Dataset creation options (name, columnTypes)
   * @returns The created dataset metadata
   */
  create = (options: CreateDatasetOptions): Promise<DatasetMetadata> => {
    if (!options.name || options.name.trim().length === 0) {
      throw new DatasetApiError(
        "Dataset name must not be empty",
        0,
        "create",
      );
    }
    return this.#datasetService.createDataset(options);
  };

  /**
   * Fetches a dataset by its slug or ID, returning metadata and entries.
   *
   * @param slugOrId - The slug or ID of the dataset to fetch
   * @param options - Optional configuration
   * @returns The dataset with metadata and entries
   *
   * @example
   * ```typescript
   * // Get dataset by slug
   * const dataset = await langwatch.datasets.get("product-qa");
   *
   * // Typed dataset
   * type MyDatasetEntry = { input: string; expected_output: string; };
   * const dataset = await langwatch.datasets.get<MyDatasetEntry>("my-dataset");
   *
   * // Iterate over entries
   * for (const entry of dataset.entries) {
   *   console.log(entry.entry.input);
   * }
   * ```
   */
  get = <T extends Record<string, unknown> = Record<string, unknown>>(
    slugOrId: string,
    options?: GetDatasetOptions
  ): Promise<Dataset<T>> => {
    return this.#datasetService.getDataset<T>(slugOrId, options);
  };

  /**
   * Updates a dataset by its slug or ID.
   *
   * @param slugOrId - The slug or ID of the dataset to update
   * @param options - Fields to update (name, columnTypes)
   * @returns The updated dataset metadata
   */
  update = (slugOrId: string, options: UpdateDatasetOptions): Promise<DatasetMetadata> => {
    if (options.name == null && options.columnTypes == null) {
      throw new DatasetApiError(
        "At least one field (name or columnTypes) must be provided for update",
        0,
        "update",
      );
    }
    return this.#datasetService.updateDataset(slugOrId, options);
  };

  /**
   * Deletes (archives) a dataset by its slug or ID.
   *
   * @param slugOrId - The slug or ID of the dataset to delete
   * @returns The archived dataset metadata
   */
  delete = (slugOrId: string): Promise<DatasetMetadata> => {
    return this.#datasetService.deleteDataset(slugOrId);
  };

  /**
   * Creates records in a dataset in batch.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param entries - Array of record entries to create
   * @returns The created records with IDs
   */
  createRecords = (
    slugOrId: string,
    entries: Record<string, unknown>[],
  ): Promise<BatchCreateRecordsResponse> => {
    if (!entries || entries.length === 0) {
      throw new DatasetApiError(
        "Entries must not be empty",
        0,
        "createRecords",
      );
    }
    return this.#datasetService.createRecords(slugOrId, entries);
  };

  /**
   * Updates a single record in a dataset.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param recordId - The ID of the record to update
   * @param entry - The updated entry data
   * @returns The updated record
   */
  updateRecord = (
    slugOrId: string,
    recordId: string,
    entry: Record<string, unknown>,
  ): Promise<DatasetRecordResponse> => {
    return this.#datasetService.updateRecord(slugOrId, recordId, entry);
  };

  /**
   * Deletes records from a dataset by IDs.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param recordIds - Array of record IDs to delete
   * @returns Object with the count of deleted records
   */
  deleteRecords = (
    slugOrId: string,
    recordIds: string[],
  ): Promise<DeleteRecordsResponse> => {
    return this.#datasetService.deleteRecords(slugOrId, recordIds);
  };

  /**
   * Lists records in a dataset with optional pagination.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param options - Pagination options (page, limit)
   * @returns Paginated list of records
   *
   * @example
   * ```typescript
   * // List first page of records
   * const result = await langwatch.datasets.listRecords("my-dataset");
   *
   * // With pagination
   * const page2 = await langwatch.datasets.listRecords("my-dataset", { page: 2, limit: 25 });
   * ```
   */
  listRecords = (
    slugOrId: string,
    options?: ListRecordsOptions,
  ): Promise<ListRecordsApiResponse> => {
    return this.#datasetService.listRecords(slugOrId, options);
  };

  /**
   * Creates a new dataset from a file upload.
   * Accepts CSV, JSON, or JSONL files.
   *
   * @param options - The dataset name and file to upload
   * @returns The created dataset metadata with record count
   *
   * @example
   * ```typescript
   * const file = new File(["input,output\nhello,world"], "data.csv", { type: "text/csv" });
   * const dataset = await langwatch.datasets.createFromUpload({ name: "my-dataset", file });
   * console.log(`Created ${dataset.recordsCreated} records`);
   * ```
   */
  createFromUpload = (
    options: CreateFromUploadOptions,
  ): Promise<CreateFromUploadResponse> => {
    if (!options.file) {
      throw new DatasetApiError(
        "File must be provided for upload",
        0,
        "createFromUpload",
      );
    }
    return this.#datasetService.createDatasetFromUpload(options);
  };

  /**
   * Uploads a file to an existing dataset.
   * Accepts File or Blob objects. Uses raw fetch with FormData.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param file - The file to upload (File or Blob)
   * @returns The upload result with created records
   */
  upload = (
    slugOrId: string,
    file: File | Blob,
  ): Promise<UploadResponse> => {
    if (!file) {
      throw new DatasetApiError(
        "File must be provided for upload",
        0,
        "upload",
      );
    }
    return this.#datasetService.uploadFile(slugOrId, file);
  };
}
