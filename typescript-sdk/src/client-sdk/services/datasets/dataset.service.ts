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
  endpoint?: string;
  apiKey?: string;
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
   * @param slugOrId - The dataset identifier (used for 404 messages)
   * @param error - The error object from the API response
   * @param status - The HTTP status code
   */
  private handleApiError(operation: string, slugOrId: string, error: unknown, status: number): never {
    if (status === 404) {
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

    if (response.error) {
      this.handleApiError(
        `fetch dataset "${slugOrId}"`,
        slugOrId,
        response.error,
        response.response.status,
      );
    }

    const data = response.data as GetDatasetApiResponse;

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

    const response = await this.#config.langwatchApiClient.GET(
      "/api/dataset" as any,
      {
        params: {
          query: {
            page: options?.page,
            limit: options?.limit,
          },
        },
      } as any,
    );

    if (response.error) {
      this.handleApiError(
        "list datasets",
        "",
        response.error,
        response.response.status,
      );
    }

    return response.data as unknown as ListDatasetsApiResponse;
  }

  /**
   * Creates a new dataset.
   */
  async createDataset(options: CreateDatasetOptions): Promise<DatasetMetadata> {
    this.#config.logger.debug(`Creating dataset: ${options.name}`);

    const response = await this.#config.langwatchApiClient.POST(
      "/api/dataset" as any,
      {
        body: {
          name: options.name,
          columnTypes: options.columnTypes ?? [],
        },
      } as any,
    );

    if (response.error) {
      this.handleApiError(
        `create dataset "${options.name}"`,
        options.name,
        response.error,
        response.response.status,
      );
    }

    return response.data as unknown as DatasetMetadata;
  }

  /**
   * Updates a dataset by its slug or ID.
   */
  async updateDataset(slugOrId: string, options: UpdateDatasetOptions): Promise<DatasetMetadata> {
    this.#config.logger.debug(`Updating dataset: ${slugOrId}`);

    const response = await this.#config.langwatchApiClient.PATCH(
      "/api/dataset/{slugOrId}" as any,
      {
        params: {
          path: { slugOrId },
        },
        body: options,
      } as any,
    );

    if (response.error) {
      this.handleApiError(
        `update dataset "${slugOrId}"`,
        slugOrId,
        response.error,
        response.response.status,
      );
    }

    return response.data as unknown as DatasetMetadata;
  }

  /**
   * Deletes (archives) a dataset by its slug or ID.
   */
  async deleteDataset(slugOrId: string): Promise<DatasetMetadata> {
    this.#config.logger.debug(`Deleting dataset: ${slugOrId}`);

    const response = await this.#config.langwatchApiClient.DELETE(
      "/api/dataset/{slugOrId}" as any,
      {
        params: {
          path: { slugOrId },
        },
      } as any,
    );

    if (response.error) {
      this.handleApiError(
        `delete dataset "${slugOrId}"`,
        slugOrId,
        response.error,
        response.response.status,
      );
    }

    return response.data as unknown as DatasetMetadata;
  }

  /**
   * Creates records in a dataset in batch.
   */
  async createRecords(
    slugOrId: string,
    entries: Record<string, unknown>[],
  ): Promise<BatchCreateRecordsResponse> {
    this.#config.logger.debug(`Creating ${entries.length} records in dataset: ${slugOrId}`);

    const response = await this.#config.langwatchApiClient.POST(
      "/api/dataset/{slugOrId}/records" as any,
      {
        params: {
          path: { slugOrId },
        },
        body: { entries },
      } as any,
    );

    if (response.error) {
      this.handleApiError(
        `create records in dataset "${slugOrId}"`,
        slugOrId,
        response.error,
        response.response.status,
      );
    }

    return response.data as unknown as BatchCreateRecordsResponse;
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

    const response = await this.#config.langwatchApiClient.PATCH(
      "/api/dataset/{slugOrId}/records/{recordId}" as any,
      {
        params: {
          path: { slugOrId, recordId },
        },
        body: { entry },
      } as any,
    );

    if (response.error) {
      this.handleApiError(
        `update record "${recordId}" in dataset "${slugOrId}"`,
        slugOrId,
        response.error,
        response.response.status,
      );
    }

    return response.data as unknown as DatasetRecordResponse;
  }

  /**
   * Deletes records from a dataset by IDs.
   */
  async deleteRecords(
    slugOrId: string,
    recordIds: string[],
  ): Promise<DeleteRecordsResponse> {
    this.#config.logger.debug(`Deleting ${recordIds.length} records from dataset: ${slugOrId}`);

    const response = await this.#config.langwatchApiClient.DELETE(
      "/api/dataset/{slugOrId}/records" as any,
      {
        params: {
          path: { slugOrId },
        },
        body: { recordIds },
      } as any,
    );

    if (response.error) {
      this.handleApiError(
        `delete records from dataset "${slugOrId}"`,
        slugOrId,
        response.error,
        response.response.status,
      );
    }

    return response.data as unknown as DeleteRecordsResponse;
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

    const endpoint = this.#config.endpoint;
    const apiKey = this.#config.apiKey;

    if (!endpoint || !apiKey) {
      throw new DatasetApiError(
        "Endpoint and API key are required for file upload",
        500,
        `upload file to dataset "${slugOrId}"`,
      );
    }

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
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      this.handleApiError(
        `upload file to dataset "${slugOrId}"`,
        slugOrId,
        errorBody,
        response.status,
      );
    }

    return (await response.json()) as UploadResponse;
  }
}
