import { beforeEach, describe, expect, it, vi } from "vitest";

// Same boundaries as dataset-service.s3-reads: mock the storage accessor only,
// so the search scan (chunk routing + predicate + windowing) runs for real.
vi.mock("../dataset-storage", () => ({ getDatasetStorage: vi.fn() }));
vi.mock("../dataset-normalize.queue", () => ({
  enqueueDatasetNormalize: vi.fn().mockResolvedValue(undefined),
}));

import { DatasetService } from "../dataset.service";
import { DATASET_SEARCH_MAX_ROWS } from "../dataset-search";
import { getDatasetStorage } from "../dataset-storage";
import { DatasetTooLargeToSearchError } from "../errors";

const makeService = (overrides: {
  repository?: Record<string, unknown>;
  recordRepository?: Record<string, unknown>;
}) =>
  new DatasetService(
    {} as never,
    (overrides.repository ?? {}) as never,
    (overrides.recordRepository ?? {}) as never,
    {} as never,
  );

const baseS3Dataset = {
  id: "dataset_1",
  projectId: "p1",
  name: "DS",
  slug: "ds",
  columnTypes: [{ name: "text", type: "string" }],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  contentLayout: "s3_jsonl",
  status: "ready",
  statusError: null,
  rowCount: 6,
  chunkCount: 3,
  chunkOffsets: [
    { index: 0, startRow: 0, endRow: 2 },
    { index: 1, startRow: 2, endRow: 4 },
    { index: 2, startRow: 4, endRow: 6 },
  ],
};

/** Two rows per chunk; the word "escalation" lives only in the LAST chunk. */
const chunks: Record<number, unknown[]> = {
  0: [{ text: "billing question" }, { text: "password reset" }],
  1: [{ text: "refund request" }, { text: "shipping delay" }],
  2: [{ text: "needs Escalation" }, { text: "escalation follow-up" }],
};

const mockChunks = (byIndex: Record<number, unknown[]> = chunks) => {
  const readChunks = vi.fn();
  const readChunk = vi.fn(({ index }: { index: number }) =>
    Promise.resolve(byIndex[index] ?? []),
  );
  vi.mocked(getDatasetStorage).mockResolvedValue({
    readChunks,
    readChunk,
  } as never);
  return { readChunks, readChunk };
};

const searchPage = (
  service: DatasetService,
  dataset: Record<string, unknown>,
  search: string,
  page = 1,
  limit = 50,
) =>
  (
    service as unknown as {
      paginateResolvedDataset: (p: Record<string, unknown>) => Promise<{
        data: { entry: Record<string, unknown> }[];
        pagination: { total: number; totalPages: number };
      }>;
    }
  ).paginateResolvedDataset({
    dataset,
    projectId: "p1",
    page,
    limit,
    search,
  });

beforeEach(() => vi.clearAllMocks());

describe("dataset search (s3_jsonl)", () => {
  it("finds matches in chunks the requested page window does not cover", async () => {
    // The matches live in chunk 2; an unsearched page-1 read would only touch
    // chunk 0. This is the whole point of the feature — the row the user is
    // looking for is on a page they have not loaded.
    mockChunks();
    const service = makeService({});

    const result = await searchPage(service, baseS3Dataset, "escalation");

    expect(result.data.map((r) => r.entry.text)).toEqual([
      "needs Escalation",
      "escalation follow-up",
    ]);
  });

  it("reports the match count as the total, so the pager pages the matches", async () => {
    mockChunks();
    const service = makeService({});

    const result = await searchPage(service, baseS3Dataset, "escalation");

    expect(result.pagination.total).toBe(2);
    expect(result.pagination.totalPages).toBe(1);
  });

  it("pages the matches rather than the underlying rows", async () => {
    mockChunks();
    const service = makeService({});

    const second = await searchPage(service, baseS3Dataset, "escalation", 2, 1);

    expect(second.data.map((r) => r.entry.text)).toEqual([
      "escalation follow-up",
    ]);
    expect(second.pagination.total).toBe(2);
    expect(second.pagination.totalPages).toBe(2);
  });

  it("reads one chunk at a time rather than loading the dataset at once", async () => {
    // `readChunks` (plural) pulls every chunk into the heap. A search must not
    // use it: heap stays at one chunk plus the matches kept for the window,
    // whatever the dataset's size.
    const { readChunks, readChunk } = mockChunks();
    const service = makeService({});

    await searchPage(service, baseS3Dataset, "escalation");

    expect(readChunks).not.toHaveBeenCalled();
    expect(readChunk).toHaveBeenCalledTimes(3);
  });

  it("returns nothing when a word appears only in a column name", async () => {
    mockChunks();
    const service = makeService({});

    const result = await searchPage(service, baseS3Dataset, "text");

    expect(result.data).toEqual([]);
    expect(result.pagination.total).toBe(0);
  });

  /** @scenario A dataset over the row limit refuses the search */
  it("refuses a dataset with more rows than one search will read", async () => {
    mockChunks();
    const service = makeService({});

    await expect(
      searchPage(
        service,
        { ...baseS3Dataset, rowCount: DATASET_SEARCH_MAX_ROWS + 1 },
        "escalation",
      ),
    ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
  });

  it("refuses before reading any chunk, rather than part-way through", async () => {
    const { readChunk } = mockChunks();
    const service = makeService({});

    await expect(
      searchPage(
        service,
        { ...baseS3Dataset, rowCount: DATASET_SEARCH_MAX_ROWS + 1 },
        "escalation",
      ),
    ).rejects.toThrow();
    expect(readChunk).not.toHaveBeenCalled();
  });

  it("finds matches in every chunk the offsets index describes", async () => {
    // `chunkOffsets` is what ordinary paging trusts to locate rows, and here it
    // describes three chunks while `chunkCount` says two. Enumerating chunks by
    // the count would stop early and report "no matches" for a row that paging
    // displays — a wrong answer wearing the clothes of a right one.
    mockChunks();
    const service = makeService({});

    const result = await searchPage(
      service,
      { ...baseS3Dataset, chunkCount: 2 },
      "escalation",
    );

    expect(result.pagination.total).toBe(2);
  });

  it("leaves the unsearched page read on its bounded windowed path", async () => {
    // Regression guard: adding search must not turn an ordinary page request
    // into a full scan. Page 1 of 2 rows overlaps chunk 0 only.
    const { readChunk } = mockChunks();
    const service = makeService({});

    await (
      service as unknown as {
        paginateResolvedDataset: (
          p: Record<string, unknown>,
        ) => Promise<unknown>;
      }
    ).paginateResolvedDataset({
      dataset: baseS3Dataset,
      projectId: "p1",
      page: 1,
      limit: 2,
    });

    expect(readChunk).toHaveBeenCalledTimes(1);
  });

  it("treats a blank search as no search at all", async () => {
    const { readChunk } = mockChunks();
    const service = makeService({});

    const result = await searchPage(service, baseS3Dataset, "   ", 1, 2);

    // Whole dataset, windowed read — not a scan for rows containing a space.
    expect(result.pagination.total).toBe(6);
    expect(readChunk).toHaveBeenCalledTimes(1);
  });
});

describe("dataset search (postgres-backed)", () => {
  const pgDataset = {
    ...baseS3Dataset,
    contentLayout: "postgres",
    rowCount: null,
    chunkCount: null,
    chunkOffsets: null,
  };

  /**
   * Keyset-paginated, like the backfill's streaming scan: the cursor is the
   * previous page's last id, so the scan does not re-count or re-skip per page.
   */
  const makeRecordRepository = (entries: Record<string, unknown>[]) => {
    const rows = entries.map((entry, i) => ({ id: `rec_${i}`, entry }));
    return {
      countAndMaxUpdatedAt: vi
        .fn()
        .mockResolvedValue({ count: rows.length, maxUpdatedAt: null }),
      findDatasetRecordsPage: vi.fn(
        ({ take, cursorId }: { take: number; cursorId?: string }) => {
          const start = cursorId
            ? rows.findIndex((r) => r.id === cursorId) + 1
            : 0;
          return Promise.resolve(rows.slice(start, start + take));
        },
      ),
    };
  };

  it("applies the same predicate as the s3_jsonl path", async () => {
    // Identical semantics across layouts: the same search must not return
    // different rows depending on where the dataset happens to be stored.
    const recordRepository = makeRecordRepository([
      { text: "billing question" },
      { text: "needs Escalation" },
      { text: "refund request" },
    ]);
    const service = makeService({ recordRepository });

    const result = await searchPage(service, pgDataset, "escalation");

    expect(result.data.map((r) => r.entry.text)).toEqual(["needs Escalation"]);
    expect(result.pagination.total).toBe(1);
  });

  it("refuses a dataset with more rows than one search will read", async () => {
    // `sizeBytes` is null on postgres-backed datasets, so the export-time byte
    // guard can never fire here — the row cap is what bounds this path.
    const recordRepository = {
      countAndMaxUpdatedAt: vi.fn().mockResolvedValue({
        count: DATASET_SEARCH_MAX_ROWS + 1,
        maxUpdatedAt: null,
      }),
      findDatasetRecordsPage: vi.fn(),
    };
    const service = makeService({ recordRepository });

    await expect(
      searchPage(service, pgDataset, "escalation"),
    ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
    // Refused before reading, not part-way through.
    expect(recordRepository.findDatasetRecordsPage).not.toHaveBeenCalled();
  });

  it("counts once for the whole scan, not once per page", async () => {
    // `listPaginated` runs a count(*) alongside every page, so offset-paging a
    // 50k-row scan issues ~50 redundant full counts. Keyset-paginating counts
    // once and then walks by cursor.
    const entries = Array.from({ length: 2_500 }, (_, i) => ({
      text: i === 2_499 ? "needs Escalation" : `row ${i}`,
    }));
    const recordRepository = makeRecordRepository(entries);
    const service = makeService({ recordRepository });

    const result = await searchPage(service, pgDataset, "escalation");

    expect(result.pagination.total).toBe(1);
    expect(recordRepository.countAndMaxUpdatedAt).toHaveBeenCalledTimes(1);
    expect(
      recordRepository.findDatasetRecordsPage.mock.calls.every(
        (c) => (c[0] as { skip?: number }).skip === undefined,
      ),
    ).toBe(true);
  });
});
