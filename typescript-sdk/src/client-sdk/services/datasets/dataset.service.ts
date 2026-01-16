import { type LangwatchApiClient } from "@/internal/api/client";
import { type Logger } from "@/logger";
import {
  type Dataset,
  type DatasetEntry,
  type GetDatasetApiResponse,
  type GetDatasetOptions,
} from "./types";
import { DatasetApiError, DatasetNotFoundError } from "./errors";

type DatasetServiceConfig = {
  langwatchApiClient: LangwatchApiClient;
  logger: Logger;
};

export class DatasetService {
  readonly #config: DatasetServiceConfig;

  constructor(config: DatasetServiceConfig) {
    this.#config = config;
  }

  /**
   * Fetches a dataset by its slug or ID
   *
   * @param slugOrId - The slug or ID of the dataset
   * @param options - Optional configuration
   * @returns The dataset with all entries
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
      const status = response.response.status;

      if (status === 404) {
        throw new DatasetNotFoundError(slugOrId);
      }

      const errorMessage =
        "message" in response.error
          ? response.error.message
          : "error" in response.error
            ? response.error.error
            : `Failed to fetch dataset: ${slugOrId}`;

      throw new DatasetApiError(errorMessage ?? `HTTP ${status}`, status);
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

    return { entries };
  }
}
