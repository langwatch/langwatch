import { type LangwatchApiClient } from "@/internal/api/client";
import { type Logger } from "@/logger";
import { DatasetService } from "./dataset.service";
import { type Dataset, type GetDatasetOptions } from "./types";

type DatasetsFacadeConfig = {
  langwatchApiClient: LangwatchApiClient;
  logger: Logger;
};

/**
 * Facade for dataset operations
 *
 * Provides a simple interface for fetching datasets from LangWatch.
 *
 * @example
 * ```typescript
 * const langwatch = new LangWatch({ apiKey: "your-api-key" });
 *
 * // Get a dataset by slug or ID
 * const dataset = await langwatch.datasets.get("my-dataset");
 *
 * // Use with evaluation
 * const evaluation = langwatch.experiments.init("my-experiment");
 * await evaluation.run(dataset.entries.map(e => e.entry), async ({ item, index }) => {
 *   const output = await myLLM(item.input);
 *   await evaluation.evaluate("my-evaluator", {
 *     data: { input: item.input, output, expected_output: item.expected_output },
 *     settings: {}
 *   });
 * });
 * ```
 */
export class DatasetsFacade {
  readonly #datasetService: DatasetService;

  constructor(config: DatasetsFacadeConfig) {
    this.#datasetService = new DatasetService(config);
  }

  /**
   * Fetches a dataset by its slug or ID
   *
   * @param slugOrId - The slug or ID of the dataset to fetch
   * @param options - Optional configuration
   * @returns The dataset with all entries
   *
   * @example
   * ```typescript
   * // Get dataset by slug
   * const dataset = await langwatch.datasets.get("product-qa");
   *
   * // Get dataset by ID
   * const dataset = await langwatch.datasets.get("ds_abc123");
   *
   * // Typed dataset
   * type MyDatasetEntry = { input: string; expected_output: string; };
   * const dataset = await langwatch.datasets.get<MyDatasetEntry>("my-dataset");
   *
   * // Iterate over entries
   * for (const entry of dataset.entries) {
   *   console.log(entry.entry.input);  // typed as string
   * }
   * ```
   */
  get = <T extends Record<string, unknown> = Record<string, unknown>>(
    slugOrId: string,
    options?: GetDatasetOptions
  ): Promise<Dataset<T>> => {
    return this.#datasetService.getDataset<T>(slugOrId, options);
  };
}
