import { makeRequest } from "./langwatch-api.js";

// --- Dataset types ---

export interface DatasetColumnType {
  name: string;
  type: string;
}

export interface DatasetSummary {
  id: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumnType[];
  recordCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetListResponse {
  data: DatasetSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface DatasetRecord {
  id: string;
  entry: Record<string, unknown>;
}

export interface DatasetDetailResponse {
  id: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumnType[];
  createdAt: string;
  updatedAt: string;
  data: DatasetRecord[];
}

export interface DatasetMutationResponse {
  id: string;
  name: string;
  slug: string;
  columnTypes: DatasetColumnType[];
  createdAt: string;
  updatedAt: string;
}

export interface DatasetArchiveResponse {
  id: string;
  archived: boolean;
}

export interface BatchCreateRecordsResponse {
  data: DatasetRecord[];
}

export interface DeleteRecordsResponse {
  deletedCount: number;
}

// --- Dataset API functions ---

/** Lists all datasets in the project (paginated). */
export async function listDatasets(params?: {
  page?: number;
  limit?: number;
}): Promise<DatasetListResponse> {
  const query = new URLSearchParams();
  if (params?.page != null) query.set("page", String(params.page));
  if (params?.limit != null) query.set("limit", String(params.limit));
  const qs = query.toString();
  const path = qs ? `/api/dataset?${qs}` : "/api/dataset";
  return makeRequest("GET", path) as Promise<DatasetListResponse>;
}

/** Retrieves a single dataset by slug or ID, including records. */
export async function getDataset(
  slugOrId: string,
): Promise<DatasetDetailResponse> {
  return makeRequest(
    "GET",
    `/api/dataset/${encodeURIComponent(slugOrId)}`,
  ) as Promise<DatasetDetailResponse>;
}

/** Creates a new dataset. */
export async function createDataset(data: {
  name: string;
  columnTypes?: DatasetColumnType[];
}): Promise<DatasetMutationResponse> {
  return makeRequest(
    "POST",
    "/api/dataset",
    data,
  ) as Promise<DatasetMutationResponse>;
}

/** Updates an existing dataset by slug or ID. */
export async function updateDataset(params: {
  slugOrId: string;
  name?: string;
  columnTypes?: DatasetColumnType[];
}): Promise<DatasetMutationResponse> {
  const { slugOrId, ...data } = params;
  return makeRequest(
    "PATCH",
    `/api/dataset/${encodeURIComponent(slugOrId)}`,
    data,
  ) as Promise<DatasetMutationResponse>;
}

/** Archives (soft-deletes) a dataset by slug or ID. */
export async function deleteDataset(
  slugOrId: string,
): Promise<DatasetArchiveResponse> {
  return makeRequest(
    "DELETE",
    `/api/dataset/${encodeURIComponent(slugOrId)}`,
  ) as Promise<DatasetArchiveResponse>;
}

/** Creates records in a dataset in batch. */
export async function createDatasetRecords(params: {
  slugOrId: string;
  entries: Record<string, unknown>[];
}): Promise<BatchCreateRecordsResponse> {
  const { slugOrId, entries } = params;
  return makeRequest(
    "POST",
    `/api/dataset/${encodeURIComponent(slugOrId)}/records`,
    { entries },
  ) as Promise<BatchCreateRecordsResponse>;
}

/** Updates or creates a single record in a dataset. */
export async function updateDatasetRecord(params: {
  slugOrId: string;
  recordId: string;
  entry: Record<string, unknown>;
}): Promise<DatasetRecord> {
  const { slugOrId, recordId, entry } = params;
  return makeRequest(
    "PATCH",
    `/api/dataset/${encodeURIComponent(slugOrId)}/records/${encodeURIComponent(recordId)}`,
    { entry },
  ) as Promise<DatasetRecord>;
}

/** Deletes records from a dataset by IDs. */
export async function deleteDatasetRecords(params: {
  slugOrId: string;
  recordIds: string[];
}): Promise<DeleteRecordsResponse> {
  const { slugOrId, recordIds } = params;
  return makeRequest(
    "DELETE",
    `/api/dataset/${encodeURIComponent(slugOrId)}/records`,
    { recordIds },
  ) as Promise<DeleteRecordsResponse>;
}
