import { type LangwatchApiClient } from "@/internal/api/client";
import { type Logger } from "@/logger";
import { DatasetService } from "./dataset.service";
import { DatasetValidationError } from "./errors";
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
 * // Upload a file (append to existing or create new)
 * const uploadResult = await langwatch.datasets.upload("my-dataset", file);
 *
 * // Upload with replace strategy (delete all records first)
 * await langwatch.datasets.upload("my-dataset", file, { ifExists: "replace" });
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
      throw new DatasetValidationError("Dataset name must not be empty");
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
      throw new DatasetValidationError(
        "At least one field (name or columnTypes) must be provided for update",
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
      throw new DatasetValidationError("Entries must not be empty");
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
   * Uploads a file to a dataset with a configurable strategy for handling existing datasets.
   *
   * Strategies:
   * - `"append"` (default): Upload to existing dataset; if not found, create a new one.
   * - `"replace"`: Delete all existing records, then upload; if not found, create a new one.
   * - `"error"`: Throw a 409 error if the dataset already exists; if not found, create a new one.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param file - The file to upload (File or Blob)
   * @param options - Upload options including the ifExists strategy
   * @returns The upload result
   *
   * @example
   * ```typescript
   * const file = new File(["input,output\nhello,world"], "data.csv", { type: "text/csv" });
   *
   * // Append to existing or create new
   * await langwatch.datasets.upload("my-dataset", file);
   *
   * // Replace all records
   * await langwatch.datasets.upload("my-dataset", file, { ifExists: "replace" });
   *
   * // Fail if dataset already exists
   * await langwatch.datasets.upload("my-dataset", file, { ifExists: "error" });
   * ```
   */
  upload = (
    slugOrId: string,
    file: File | Blob,
    options?: {
      ifExists?: "append" | "replace" | "error";
    },
  ): Promise<UploadResponse> => {
    if (!file) {
      throw new DatasetValidationError("File must be provided for upload");
    }
    return this.#datasetService.uploadWithStrategy(
      slugOrId,
      file,
      options?.ifExists ?? "append",
    );
  };
}
