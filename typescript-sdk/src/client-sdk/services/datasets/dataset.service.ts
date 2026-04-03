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
  type CreateDatasetOptions,
  type UpdateDatasetOptions,
  type BatchCreateRecordsResponse,
  type DeleteRecordsResponse,
  type UploadResponse,
  type DatasetRecordResponse,
} from "./types";
import { DatasetApiError, DatasetNotFoundError } from "./errors";

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
  readonly #config: DatasetServiceConfig;

  constructor(config: DatasetServiceConfig) {
    this.#config = config;
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
    return (this.#config.langwatchApiClient[method] as any)(path, options);
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
    this.#config.logger.debug(`Fetching dataset: ${slugOrId}`);

    const response = await this.#config.langwatchApiClient.GET(
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

    this.#config.logger.debug(
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
    this.#config.logger.debug("Listing datasets");

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
    this.#config.logger.debug(`Creating dataset: ${options.name}`);

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
    this.#config.logger.debug(`Updating dataset: ${slugOrId}`);

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
    this.#config.logger.debug(`Deleting dataset: ${slugOrId}`);

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
    this.#config.logger.debug(`Creating ${entries.length} records in dataset: ${slugOrId}`);

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
    this.#config.logger.debug(`Updating record ${recordId} in dataset: ${slugOrId}`);

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
    this.#config.logger.debug(`Deleting ${recordIds.length} records from dataset: ${slugOrId}`);

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
   * Uploads a file to an existing dataset.
   * Uses raw fetch with FormData since openapi-fetch hardcodes content-type: application/json.
   */
  async uploadFile(
    slugOrId: string,
    file: File | Blob,
  ): Promise<UploadResponse> {
    this.#config.logger.debug(`Uploading file to dataset: ${slugOrId}`);

    const { endpoint, apiKey } = this.#config;

    const url = `${endpoint.replace(/\/$/, "")}/api/dataset/${encodeURIComponent(slugOrId)}/upload`;

    const formData = new FormData();
    formData.append("file", file);

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

      this.handleApiError(
        `upload file to dataset "${slugOrId}"`,
        errorBody,
        response.status,
        slugOrId,
      );
    }

    return (await response.json()) as UploadResponse;
  }
}
