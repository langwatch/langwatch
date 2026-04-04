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
 * Pagination metadata returned by paginated API endpoints.
 */
export type Pagination = {
  /** Current page number (1-based) */
  page: number;
  /** Number of items per page */
  limit: number;
  /** Total number of items across all pages */
  total: number;
  /** Total number of pages */
  totalPages: number;
};

/**
 * A dataset in a list response, including record count.
 */
export type DatasetListItem = DatasetMetadata & {
  /** Number of records in the dataset */
  recordCount: number;
};

/**
 * Paginated response wrapper for dataset endpoints.
 */
export type PaginatedResponse<T> = {
  data: T[];
  pagination: Pagination;
};

/**
 * API response for listing datasets.
 */
export type ListDatasetsApiResponse = PaginatedResponse<DatasetListItem>;

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
};

/**
 * Options for listing records in a dataset.
 */
export type ListRecordsOptions = {
  /** Page number (1-based) */
  page?: number;
  /** Number of items per page */
  limit?: number;
};

/**
 * API response for listing records in a dataset.
 */
export type ListRecordsApiResponse = PaginatedResponse<DatasetRecordResponse>;

/**
 * Options for creating a dataset from a file upload.
 */
export type CreateFromUploadOptions = {
  /** Name for the new dataset */
  name: string;
  /** The file to upload (CSV, JSON, or JSONL) */
  file: File | Blob;
};

/**
 * API response for creating a dataset from a file upload.
 */
export type CreateFromUploadResponse = DatasetMetadata & {
  /** Number of records created from the uploaded file */
  recordsCreated: number;
};
