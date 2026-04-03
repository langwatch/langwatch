/**
 * Types for the Dataset API
 */

/**
 * A column type definition for a dataset.
 */
export type DatasetColumnType = {
  /** Column name */
  name: string;
  /** Column data type */
  type: string;
};

/**
 * Metadata for a dataset.
 */
export type DatasetMetadata = {
  /** Unique dataset identifier */
  id: string;
  /** Human-readable dataset name */
  name: string;
  /** URL-safe slug */
  slug: string;
  /** Column type definitions */
  columnTypes: DatasetColumnType[];
  /** When the dataset was created */
  createdAt?: string;
  /** When the dataset was last updated */
  updatedAt?: string;
};

/**
 * A single entry in a dataset.
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
 * A dataset containing metadata and entries.
 */
export type Dataset<T extends Record<string, unknown> = Record<string, unknown>> = DatasetMetadata & {
  /** Array of dataset entries */
  entries: DatasetEntry<T>[];
};

/**
 * Options for getting a dataset.
 */
export type GetDatasetOptions = {
  /** Skip tracing for this operation */
  ignoreTracing?: boolean;
};

/**
 * Options for listing datasets.
 */
export type ListDatasetsOptions = {
  /** Page number (1-based) */
  page?: number;
  /** Number of items per page */
  limit?: number;
};

/**
 * API response for getting a dataset.
 */
export type GetDatasetApiResponse = {
  id: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumnType[];
  createdAt?: string;
  updatedAt?: string;
  data: Array<{
    id: string;
    datasetId: string;
    projectId: string;
    entry: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
};

/**
 * API response for listing datasets.
 */
export type ListDatasetsApiResponse = {
  data: DatasetMetadata[];
  total: number;
  page: number;
  limit: number;
};

/**
 * Options for creating a dataset.
 */
export type CreateDatasetOptions = {
  /** Dataset name */
  name: string;
  /** Column type definitions (defaults to empty array) */
  columnTypes?: DatasetColumnType[];
};

/**
 * Options for updating a dataset.
 */
export type UpdateDatasetOptions = {
  /** New dataset name */
  name?: string;
  /** New column type definitions */
  columnTypes?: DatasetColumnType[];
};

/**
 * API response for a record.
 */
export type DatasetRecordResponse = {
  id: string;
  datasetId: string;
  projectId: string;
  entry: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

/**
 * API response for batch create records.
 */
export type BatchCreateRecordsResponse = {
  data: DatasetRecordResponse[];
};

/**
 * API response for deleting records.
 */
export type DeleteRecordsResponse = {
  deletedCount: number;
};

/**
 * API response for uploading a file.
 */
export type UploadResponse = {
  dataset?: DatasetMetadata;
  records?: DatasetRecordResponse[];
  [key: string]: unknown;
};
