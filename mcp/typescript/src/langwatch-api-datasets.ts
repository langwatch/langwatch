import { LangWatchApiError, makeRequest } from "./langwatch-api.ts";

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
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
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
  /** Records in the dataset, when `data` is a preview of them. */
  totalRecords?: number;
  /** Records of the dataset left out of `data`. */
  omittedRecords?: number;
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

export interface DatasetRecordListResponse {
  data: DatasetRecord[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  /** The dataset the page belongs to. Absent on servers that do not send it. */
  dataset?: DatasetMutationResponse;
}

/** The most records a dataset preview holds. */
export const DATASET_PREVIEW_MAX_RECORDS = 100;

/** The most bytes of records a dataset preview holds. */
export const DATASET_PREVIEW_MAX_BYTES = 1024 * 1024;

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
  const path = qs ? `/api/v1/dataset?${qs}` : "/api/v1/dataset";
  return makeRequest("GET", path) as Promise<DatasetListResponse>;
}

/**
 * Retrieves a dataset by slug or ID with a preview of its records: the first page, cut at
 * `DATASET_PREVIEW_MAX_RECORDS` records and `DATASET_PREVIEW_MAX_BYTES` bytes. A dataset of
 * any size can be read this way. `omittedRecords` counts what the preview leaves out.
 */
export async function getDataset(slugOrId: string): Promise<DatasetDetailResponse> {
  const page = await readPreviewPage(slugOrId);
  // A server without the records endpoint, or one that sends no dataset with a page, is
  // asked for the whole dataset in one response.
  if (!page?.dataset) {
    return makeRequest(
      "GET",
      `/api/v1/dataset/${encodeURIComponent(slugOrId)}`,
    ) as Promise<DatasetDetailResponse>;
  }

  const data: DatasetRecord[] = [];
  let bytes = 0;
  for (const record of page.data) {
    bytes += JSON.stringify(record).length;
    if (bytes > DATASET_PREVIEW_MAX_BYTES) break;
    data.push(record);
  }

  const { id, name, slug, columnTypes, createdAt, updatedAt } = page.dataset;
  const totalRecords = page.pagination.total;
  return {
    id,
    name,
    slug,
    columnTypes,
    createdAt,
    updatedAt,
    data,
    totalRecords,
    omittedRecords: Math.max(0, totalRecords - data.length),
  };
}

/**
 * The first page of a dataset's records, or `null` when the records endpoint answers 404. A
 * page refused as too large is asked for again with the size the refusal suggests, or half.
 */
async function readPreviewPage(slugOrId: string): Promise<DatasetRecordListResponse | null> {
  let limit = DATASET_PREVIEW_MAX_RECORDS;
  for (;;) {
    try {
      return await listDatasetRecords({ slugOrId, page: 1, limit });
    } catch (error) {
      if (!(error instanceof LangWatchApiError)) throw error;
      if (error.status === 404) return null;
      if (error.status !== 413 || limit <= 1) throw error;
      limit = smallerLimit(limit, error.responseBody);
    }
  }
}

/** The page size a `dataset_page_too_large` refusal suggests, or half the refused one. */
function smallerLimit(limit: number, responseBody: string): number {
  const half = Math.max(1, Math.floor(limit / 2));
  try {
    const suggested: unknown = (JSON.parse(responseBody) as { meta?: { suggestedLimit?: unknown } })
      .meta?.suggestedLimit;
    const usable =
      typeof suggested === "number" &&
      Number.isInteger(suggested) &&
      suggested >= 1 &&
      suggested < limit;
    return usable ? suggested : half;
  } catch {
    return half;
  }
}

/** Creates a new dataset. */
export async function createDataset(data: {
  name: string;
  columnTypes?: DatasetColumnType[];
}): Promise<DatasetMutationResponse> {
  return makeRequest("POST", "/api/v1/dataset", data) as Promise<DatasetMutationResponse>;
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
    `/api/v1/dataset/${encodeURIComponent(slugOrId)}`,
    data,
  ) as Promise<DatasetMutationResponse>;
}

/** Archives (soft-deletes) a dataset by slug or ID. */
export async function deleteDataset(slugOrId: string): Promise<DatasetArchiveResponse> {
  return makeRequest(
    "DELETE",
    `/api/v1/dataset/${encodeURIComponent(slugOrId)}`,
  ) as Promise<DatasetArchiveResponse>;
}

/** Creates records in a dataset in batch. */
export async function createDatasetRecords(params: {
  slugOrId: string;
  entries: Record<string, unknown>[];
}): Promise<BatchCreateRecordsResponse> {
  const { slugOrId, entries } = params;
  return makeRequest("POST", `/api/v1/dataset/${encodeURIComponent(slugOrId)}/records`, {
    entries,
  }) as Promise<BatchCreateRecordsResponse>;
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
    `/api/v1/dataset/${encodeURIComponent(slugOrId)}/records/${encodeURIComponent(recordId)}`,
    { entry },
  ) as Promise<DatasetRecord>;
}

/** Deletes records from a dataset by IDs. */
export async function deleteDatasetRecords(params: {
  slugOrId: string;
  recordIds: string[];
}): Promise<DeleteRecordsResponse> {
  const { slugOrId, recordIds } = params;
  return makeRequest("DELETE", `/api/v1/dataset/${encodeURIComponent(slugOrId)}/records`, {
    recordIds,
  }) as Promise<DeleteRecordsResponse>;
}

/** Lists records in a dataset (paginated). */
export async function listDatasetRecords(params: {
  slugOrId: string;
  page?: number;
  limit?: number;
}): Promise<DatasetRecordListResponse> {
  const { slugOrId } = params;
  const query = new URLSearchParams();
  if (params.page != null) query.set("page", String(params.page));
  if (params.limit != null) query.set("limit", String(params.limit));
  const qs = query.toString();
  const path = `/api/v1/dataset/${encodeURIComponent(slugOrId)}/records${qs ? `?${qs}` : ""}`;
  return makeRequest("GET", path) as Promise<DatasetRecordListResponse>;
}
