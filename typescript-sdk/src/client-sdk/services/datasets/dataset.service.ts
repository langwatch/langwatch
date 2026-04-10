import { type LangwatchApiClient } from "@/internal/api/client";
import { type Logger } from "@/logger";
import {
  type Dataset,
  type DatasetEntry,
  type DatasetMetadata,
  type GetDatasetApiResponse,
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
import { DatasetApiError, DatasetNotFoundError, DatasetPlanLimitError } from "./errors";
import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";
import { tracer } from "./tracing";

type DatasetServiceConfig = {
  langwatchApiClient: LangwatchApiClient;
  logger: Logger;
  endpoint: string;
  apiKey: string;
};

/**
 * Service for managing dataset resources via the LangWatch API.
 *
 * Responsibilities:
 * - CRUD operations for datasets
 * - Record management (create, update, delete)
 * - File upload
 * - Error handling with contextual information
 */
export class DatasetService {
  private readonly config: DatasetServiceConfig;

  constructor(config: DatasetServiceConfig) {
    this.config = config;

    /**
     * Wraps the service in a tracing proxy that automatically creates
     * OpenTelemetry spans for all public methods.
     */
    return createTracingProxy(this as DatasetService, tracer);
  }

  /**
   * Handles API errors by mapping status codes to appropriate error types.
   * @param operation - Description of the operation being performed
   * @param error - The error object from the API response
   * @param status - The HTTP status code
   * @param slugOrId - The dataset identifier (only passed for operations targeting an existing resource)
   */
  private handleApiError(operation: string, error: unknown, status: number, slugOrId?: string): never {
    if (status === 404 && slugOrId) {
      throw new DatasetNotFoundError(slugOrId);
    }

    if (status === 403) {
      const errorMessage = this.extractErrorMessage(error, status);
      throw new DatasetPlanLimitError(errorMessage, error);
    }

    const errorMessage = this.extractErrorMessage(error, status);

    throw new DatasetApiError(
      `Failed to ${operation}: ${errorMessage}`,
      status,
      operation,
      error,
    );
  }

  /**
   * Extracts a human-readable error message from an API error response.
   */
  private extractErrorMessage(error: unknown, status: number): string {
    if (typeof error === "string") return error;

    if (error != null && typeof error === "object") {
      if ("message" in error && typeof (error as { message: unknown }).message === "string") {
        return (error as { message: string }).message;
      }
      if ("error" in error) {
        const inner = (error as { error: unknown }).error;
        if (typeof inner === "string") return inner;
        if (inner != null && typeof inner === "object" && "message" in inner) {
          return (inner as { message: string }).message ?? JSON.stringify(inner);
        }
      }
    }

    return `HTTP ${status}`;
  }

  /**
   * Wrapper for API calls to endpoints not yet in the generated OpenAPI types.
   * Quarantines `as any` casts to a single location.
   */
  private untypedRequest<M extends 'GET' | 'POST' | 'PATCH' | 'DELETE'>(
    method: M,
    path: string,
    options?: Record<string, unknown>,
  ) {
    return (this.config.langwatchApiClient[method] as any)(path, options);
  }

  /**
   * Unwraps an API response, throwing a mapped error if the response contains an error.
   * Centralizes the repeated `if (error) handleApiError; return data` pattern.
   */
  private unwrapResponse<T>(
    response: { data?: unknown; error?: unknown; response: { status: number } },
    operation: string,
    slugOrId?: string,
  ): T {
    if (response.error) {
      this.handleApiError(operation, response.error, response.response.status, slugOrId);
    }
    return response.data as T;
  }

  /**
   * Fetches a dataset by its slug or ID, returning metadata and entries.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param _options - Optional configuration
   * @returns The dataset with metadata and entries
   */
  async getDataset<T extends Record<string, unknown> = Record<string, unknown>>(
    slugOrId: string,
    _options?: GetDatasetOptions
  ): Promise<Dataset<T>> {
    this.config.logger.debug(`Fetching dataset: ${slugOrId}`);

    const response = await this.config.langwatchApiClient.GET(
      "/api/dataset/{slugOrId}",
      {
        params: {
          path: {
            slugOrId,
          },
        },
      }
    );

    const data = this.unwrapResponse<GetDatasetApiResponse>(
      response,
      `fetch dataset "${slugOrId}"`,
      slugOrId,
    );

    const entries: DatasetEntry<T>[] = data.data.map((item) => ({
      id: item.id,
      datasetId: item.datasetId,
      projectId: item.projectId,
      entry: item.entry as T,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    this.config.logger.debug(
      `Fetched dataset ${slugOrId} with ${entries.length} entries`
    );

    return {
      id: data.id,
      name: data.name,
      slug: data.slug,
      columnTypes: data.columnTypes,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      entries,
    };
  }

  /**
   * Lists all datasets for the project, with optional pagination.
   */
  async listDatasets(options?: ListDatasetsOptions): Promise<ListDatasetsApiResponse> {
    this.config.logger.debug("Listing datasets");

    const response = await this.untypedRequest('GET', '/api/dataset', {
      params: {
        query: {
          page: options?.page,
          limit: options?.limit,
        },
      },
    });

    return this.unwrapResponse<ListDatasetsApiResponse>(
      response,
      "list datasets",
    );
  }

  /**
   * Creates a new dataset.
   */
  async createDataset(options: CreateDatasetOptions): Promise<DatasetMetadata> {
    this.config.logger.debug(`Creating dataset: ${options.name}`);

    const response = await this.untypedRequest('POST', '/api/dataset', {
      body: {
        name: options.name,
        columnTypes: options.columnTypes ?? [],
      },
    });

    return this.unwrapResponse<DatasetMetadata>(
      response,
      `create dataset "${options.name}"`,
    );
  }

  /**
   * Updates a dataset by its slug or ID.
   */
  async updateDataset(slugOrId: string, options: UpdateDatasetOptions): Promise<DatasetMetadata> {
    this.config.logger.debug(`Updating dataset: ${slugOrId}`);

    const response = await this.untypedRequest('PATCH', '/api/dataset/{slugOrId}', {
      params: {
        path: { slugOrId },
      },
      body: options,
    });

    return this.unwrapResponse<DatasetMetadata>(
      response,
      `update dataset "${slugOrId}"`,
      slugOrId,
    );
  }

  /**
   * Deletes (archives) a dataset by its slug or ID.
   */
  async deleteDataset(slugOrId: string): Promise<DatasetMetadata> {
    this.config.logger.debug(`Deleting dataset: ${slugOrId}`);

    const response = await this.untypedRequest('DELETE', '/api/dataset/{slugOrId}', {
      params: {
        path: { slugOrId },
      },
    });

    return this.unwrapResponse<DatasetMetadata>(
      response,
      `delete dataset "${slugOrId}"`,
      slugOrId,
    );
  }

  /**
   * Creates records in a dataset in batch.
   */
  async createRecords(
    slugOrId: string,
    entries: Record<string, unknown>[],
  ): Promise<BatchCreateRecordsResponse> {
    this.config.logger.debug(`Creating ${entries.length} records in dataset: ${slugOrId}`);

    const response = await this.untypedRequest('POST', '/api/dataset/{slugOrId}/records', {
      params: {
        path: { slugOrId },
      },
      body: { entries },
    });

    return this.unwrapResponse<BatchCreateRecordsResponse>(
      response,
      `create records in dataset "${slugOrId}"`,
      slugOrId,
    );
  }

  /**
   * Updates a single record in a dataset.
   */
  async updateRecord(
    slugOrId: string,
    recordId: string,
    entry: Record<string, unknown>,
  ): Promise<DatasetRecordResponse> {
    this.config.logger.debug(`Updating record ${recordId} in dataset: ${slugOrId}`);

    const response = await this.untypedRequest('PATCH', '/api/dataset/{slugOrId}/records/{recordId}', {
      params: {
        path: { slugOrId, recordId },
      },
      body: { entry },
    });

    return this.unwrapResponse<DatasetRecordResponse>(
      response,
      `update record "${recordId}" in dataset "${slugOrId}"`,
      slugOrId,
    );
  }

  /**
   * Deletes records from a dataset by IDs.
   */
  async deleteRecords(
    slugOrId: string,
    recordIds: string[],
  ): Promise<DeleteRecordsResponse> {
    this.config.logger.debug(`Deleting ${recordIds.length} records from dataset: ${slugOrId}`);

    const response = await this.untypedRequest('DELETE', '/api/dataset/{slugOrId}/records', {
      params: {
        path: { slugOrId },
      },
      body: { recordIds },
    });

    return this.unwrapResponse<DeleteRecordsResponse>(
      response,
      `delete records from dataset "${slugOrId}"`,
      slugOrId,
    );
  }

  /**
   * Lists records in a dataset with optional pagination.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param options - Pagination options (page, limit)
   * @returns Paginated list of records
   */
  async listRecords(
    slugOrId: string,
    options?: ListRecordsOptions,
  ): Promise<ListRecordsApiResponse> {
    this.config.logger.debug(`Listing records for dataset: ${slugOrId}`);

    const response = await this.untypedRequest('GET', '/api/dataset/{slugOrId}/records', {
      params: {
        path: { slugOrId },
        query: {
          page: options?.page,
          limit: options?.limit,
        },
      },
    });

    return this.unwrapResponse<ListRecordsApiResponse>(
      response,
      `list records in dataset "${slugOrId}"`,
      slugOrId,
    );
  }

  /**
   * Sends a multipart/form-data request using raw fetch.
   * openapi-fetch hardcodes content-type: application/json, so file uploads
   * must bypass it. This helper centralizes URL building, auth headers,
   * error parsing, and response unwrapping.
   *
   * @param path - The API path (appended to the endpoint)
   * @param formData - The FormData payload
   * @param operation - Human-readable operation name for error messages
   * @param slugOrId - Optional dataset identifier (passed to handleApiError for 404 mapping)
   */
  private async fetchMultipart<T>(
    path: string,
    formData: FormData,
    operation: string,
    slugOrId?: string,
  ): Promise<T> {
    const { endpoint, apiKey } = this.config;
    const url = `${endpoint.replace(/\/$/, "")}${path}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Auth-Token": apiKey,
        authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const rawBody = await response.text();
      let errorBody: unknown = rawBody;
      if (rawBody) {
        try {
          errorBody = JSON.parse(rawBody);
        } catch {
          // Keep the plain-text body.
        }
      }

      this.handleApiError(operation, errorBody, response.status, slugOrId);
    }

    return (await response.json()) as T;
  }

  /**
   * Creates a new dataset from a file upload.
   *
   * @param options - The dataset name and file to upload
   * @returns The created dataset metadata with record count
   */
  async createDatasetFromUpload(
    options: CreateFromUploadOptions,
  ): Promise<CreateFromUploadResponse> {
    this.config.logger.debug(`Creating dataset from upload: ${options.name}`);

    const formData = new FormData();
    formData.append("name", options.name);
    formData.append("file", options.file);

    return this.fetchMultipart<CreateFromUploadResponse>(
      "/api/dataset/upload",
      formData,
      `create dataset from upload "${options.name}"`,
    );
  }

  /**
   * Uploads a file with a strategy for handling existing datasets.
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param file - The file to upload (File or Blob)
   * @param ifExists - Strategy when dataset exists: "append" (default), "replace", or "error"
   * @returns The upload result
   */
  async uploadWithStrategy(
    slugOrId: string,
    file: File | Blob,
    ifExists: "append" | "replace" | "error" = "append",
  ): Promise<UploadResponse> {
    switch (ifExists) {
      case "append":
        return this._uploadAppend(slugOrId, file);
      case "replace":
        return this._uploadReplace(slugOrId, file);
      case "error":
        return this._uploadError(slugOrId, file);
    }
  }

  /**
   * Converts a CreateFromUploadResponse to the unified UploadResponse shape.
   */
  private toUploadResponse(result: CreateFromUploadResponse): UploadResponse {
    return {
      dataset: {
        id: result.id,
        name: result.name,
        slug: result.slug,
        columnTypes: result.columnTypes,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
      recordsCreated: result.recordsCreated,
      datasetId: result.id,
    };
  }

  /**
   * Append strategy: try uploading to existing dataset; if not found, create from file.
   */
  private async _uploadAppend(slugOrId: string, file: File | Blob): Promise<UploadResponse> {
    try {
      return await this.uploadFile(slugOrId, file);
    } catch (error) {
      if (error instanceof DatasetNotFoundError) {
        return this.toUploadResponse(await this.createDatasetFromUpload({ name: slugOrId, file }));
      }
      throw error;
    }
  }

  /**
   * Replace strategy: if dataset exists, delete all records then upload; if not found, create from file.
   */
  private async _uploadReplace(slugOrId: string, file: File | Blob): Promise<UploadResponse> {
    try {
      await this.getDataset(slugOrId);
      await this._deleteAllRecords(slugOrId);
      return await this.uploadFile(slugOrId, file);
    } catch (error) {
      if (error instanceof DatasetNotFoundError) {
        return this.toUploadResponse(await this.createDatasetFromUpload({ name: slugOrId, file }));
      }
      throw error;
    }
  }

  /**
   * Error strategy: if dataset exists, throw 409; if not found, create from file.
   */
  private async _uploadError(slugOrId: string, file: File | Blob): Promise<UploadResponse> {
    let datasetExists = false;
    try {
      await this.getDataset(slugOrId);
      datasetExists = true;
    } catch (error) {
      if (!(error instanceof DatasetNotFoundError)) {
        throw error;
      }
    }

    if (datasetExists) {
      throw new DatasetApiError(
        `Dataset already exists: ${slugOrId}`,
        409,
        "upload",
      );
    }

    return this.toUploadResponse(await this.createDatasetFromUpload({ name: slugOrId, file }));
  }

  /**
   * Deletes all records from a dataset by iterating through pages.
   * Always fetches page 1 since records shift after deletion.
   * Includes a safety valve to prevent infinite loops.
   */
  private async _deleteAllRecords(slugOrId: string): Promise<void> {
    const BATCH_SIZE = 1000;
    const MAX_DELETE_ITERATIONS = 100;

    let iteration = 0;
    while (iteration < MAX_DELETE_ITERATIONS) {
      const page = await this.listRecords(slugOrId, { page: 1, limit: BATCH_SIZE });
      if (page.data.length === 0) {
        return;
      }

      const ids = page.data.map((record) => record.id);
      await this.deleteRecords(slugOrId, ids);
      iteration++;
    }

    throw new DatasetApiError(
      `Failed to delete all records from dataset "${slugOrId}": exceeded ${MAX_DELETE_ITERATIONS} iterations`,
      0,
      `delete all records from dataset "${slugOrId}"`,
    );
  }

  /**
   * Uploads a file to an existing dataset.
   */
  async uploadFile(
    slugOrId: string,
    file: File | Blob,
  ): Promise<UploadResponse> {
    this.config.logger.debug(`Uploading file to dataset: ${slugOrId}`);

    const formData = new FormData();
    formData.append("file", file);

    return this.fetchMultipart<UploadResponse>(
      `/api/dataset/${encodeURIComponent(slugOrId)}/upload`,
      formData,
      `upload file to dataset "${slugOrId}"`,
      slugOrId,
    );
  }
}
