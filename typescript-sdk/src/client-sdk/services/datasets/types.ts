/**
 * Types for the Dataset API
 */

/**
 * A single entry in a dataset
 */
export type DatasetEntry<T extends Record<string, unknown> = Record<string, unknown>> = {
  /** Unique identifier for this entry */
  id: string;
  /** The dataset this entry belongs to */
  datasetId: string;
  /** The project this entry belongs to */
  projectId: string;
  /** The actual data for this entry */
  entry: T;
  /** When this entry was created */
  createdAt: string;
  /** When this entry was last updated */
  updatedAt: string;
};

/**
 * A dataset containing multiple entries
 */
export type Dataset<T extends Record<string, unknown> = Record<string, unknown>> = {
  /** Array of dataset entries */
  entries: DatasetEntry<T>[];
};

/**
 * Options for getting a dataset
 */
export type GetDatasetOptions = {
  /** Skip tracing for this operation */
  ignoreTracing?: boolean;
};

/**
 * API response for getting a dataset
 */
export type GetDatasetApiResponse = {
  data: Array<{
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
};
