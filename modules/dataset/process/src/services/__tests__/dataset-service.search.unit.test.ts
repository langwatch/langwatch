import { createApiFixture } from "@langwatch/api-fixture";
import {
  datasetSchema,
  DatasetChunkCountMissingError,
  DatasetTooLargeToSearchError,
  type Dataset,
  type DatasetRecord,
} from "@langwatch/dataset-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDatasetTestAttachments,
  createDatasetTestRequestBounds,
} from "../../app/__tests__/dataset.fixture.ts";
import type { DatasetChunkRepository } from "../../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository } from "../../repositories/dataset-content.repository.ts";
import type { DatasetRecordRepository } from "../../repositories/dataset-record.repository.ts";
import type { DatasetRepository } from "../../repositories/dataset.repository.ts";
import { DatasetContentService } from "../dataset-content.service.ts";
import {
  DATASET_SEARCH_MAX_BYTES,
  DATASET_SEARCH_MAX_ROWS,
  DATASET_SEARCH_SCAN_BATCH,
} from "../dataset-search.ts";
import { DatasetService } from "../dataset.service.ts";

let activeDataset: Dataset;
let activeStorage: DatasetChunkRepository;

const makeService = (overrides: { recordRepository?: Partial<DatasetRecordRepository> }) => {
  const repository = createApiFixture<DatasetRepository>(
    {
      findById: async () => activeDataset,
      findBySlug: async () => activeDataset,
    },
    "dataset repository",
  );
  const records = createApiFixture<DatasetRecordRepository>(
    overrides.recordRepository,
    "record repository",
  );
  const storage = createApiFixture<DatasetChunkRepository>(
    {
      readChunks: (params) => activeStorage.readChunks(params),
      readChunk: (params) => activeStorage.readChunk(params),
    },
    "dataset chunks",
  );
  const content = DatasetContentService.create({
    datasets: createApiFixture<DatasetContentRepository>(),
    storage,
  });
  return DatasetService.create({
    repository,
    records,
    content,
    requestBounds: createDatasetTestRequestBounds(),
    attachments: createDatasetTestAttachments(),
  });
};

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

const record = (id: string, entry: Record<string, unknown>): DatasetRecord => ({
  id,
  datasetId: "dataset_1",
  projectId: "p1",
  entry,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
});

const mockChunks = (byIndex: Record<number, unknown[]> = chunks) => {
  const readChunks = vi.fn();
  const readChunk = vi.fn(({ index }: { index: number }) => Promise.resolve(byIndex[index] ?? []));
  activeStorage = createApiFixture<DatasetChunkRepository>(
    {
      readChunks,
      readChunk,
    },
    "dataset storage",
  );
  return { readChunks, readChunk };
};

const searchPage = ({
  service,
  dataset,
  search,
  page = 1,
  limit = 50,
}: {
  service: DatasetService;
  dataset: Record<string, unknown>;
  search: string;
  page?: number;
  limit?: number;
}) => {
  activeDataset = datasetSchema.parse({
    archivedAt: null,
    mapping: null,
    useS3: dataset.contentLayout === "s3_jsonl",
    s3RecordCount: null,
    stagingKey: null,
    uploadFilename: null,
    sizeBytes: null,
    ...dataset,
  });
  return service.listRecords({
    slugOrId: activeDataset.id,
    projectId: "p1",
    page,
    limit,
    search,
  });
};

beforeEach(() => vi.clearAllMocks());

describe("dataset search (s3_jsonl)", () => {
  describe("given a dataset whose matches lie outside the page being viewed", () => {
    describe("when a search runs", () => {
      it("finds matches in chunks the requested page window does not cover", async () => {
        // The matches live in chunk 2; an unsearched page-1 read would only touch
        // chunk 0. This is the whole point of the feature — the row the user is
        // looking for is on a page they have not loaded.
        mockChunks();
        const service = makeService({});

        const result = await searchPage({
          service,
          dataset: baseS3Dataset,
          search: "escalation",
        });

        expect(result.data.map((r) => r.entry.text)).toEqual([
          "needs Escalation",
          "escalation follow-up",
        ]);
      });

      it("reports the match count as the total, so the pager pages the matches", async () => {
        mockChunks();
        const service = makeService({});

        const result = await searchPage({
          service,
          dataset: baseS3Dataset,
          search: "escalation",
        });

        expect(result.pagination.total).toBe(2);
        expect(result.pagination.totalPages).toBe(1);
      });

      it("pages the matches rather than the underlying rows", async () => {
        mockChunks();
        const service = makeService({});

        const second = await searchPage({
          service,
          dataset: baseS3Dataset,
          search: "escalation",
          page: 2,
          limit: 1,
        });

        expect(second.data.map((r) => r.entry.text)).toEqual(["escalation follow-up"]);
        expect(second.pagination.total).toBe(2);
        expect(second.pagination.totalPages).toBe(2);
      });

      it("reads one chunk at a time rather than loading the dataset at once", async () => {
        // `readChunks` (plural) pulls every chunk into the heap. A search must not
        // use it: heap stays at one chunk plus the matches kept for the window,
        // whatever the dataset's size.
        const { readChunks, readChunk } = mockChunks();
        const service = makeService({});

        await searchPage({
          service,
          dataset: baseS3Dataset,
          search: "escalation",
        });

        expect(readChunks).not.toHaveBeenCalled();
        expect(readChunk).toHaveBeenCalledTimes(3);
      });

      it("returns nothing when a word appears only in a column name", async () => {
        mockChunks();
        const service = makeService({});

        const result = await searchPage({
          service,
          dataset: baseS3Dataset,
          search: "text",
        });

        expect(result.data).toEqual([]);
        expect(result.pagination.total).toBe(0);
      });
    });
  });

  describe("given a dataset larger than one search will read", () => {
    describe("when a search runs", () => {
      /** @scenario A dataset over the row limit refuses the search */
      it("refuses a dataset with more rows than one search will read", async () => {
        mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: DATASET_SEARCH_MAX_ROWS + 1,
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
      });

      /** @scenario A dataset too large to search is refused before any of it is read */
      it("refuses before reading any chunk, rather than part-way through", async () => {
        const { readChunk } = mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: DATASET_SEARCH_MAX_ROWS + 1,
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
        expect(readChunk).not.toHaveBeenCalled();
      });

      /** @scenario A dataset within the row limit but over the byte limit refuses the search */
      it("refuses a dataset whose rows occupy more bytes than one search will read", async () => {
        // Worst-case scan: rows are as wide as their columns, so row count alone
        // says nothing about bytes fetched. `sizeBytes` is a bigint here because
        // it is a bigint on the row — a `number` would typecheck but skip the
        // comparison the service actually performs.
        mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: 6,
              sizeBytes: BigInt(DATASET_SEARCH_MAX_BYTES) + 1n,
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
      });

      it("refuses an over-sized dataset before reading any chunk", async () => {
        const { readChunk } = mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: 6,
              sizeBytes: BigInt(DATASET_SEARCH_MAX_BYTES) + 1n,
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
        expect(readChunk).not.toHaveBeenCalled();
      });

      it("searches a dataset sitting exactly on the byte limit", async () => {
        // The limit is what a search will read, not what it refuses: an off-by-one
        // here withdraws search from a dataset that is precisely allowed.
        mockChunks();
        const service = makeService({});

        const result = await searchPage({
          service,
          dataset: {
            ...baseS3Dataset,
            rowCount: 6,
            sizeBytes: BigInt(DATASET_SEARCH_MAX_BYTES),
          },
          search: "escalation",
        });

        expect(result.pagination.total).toBe(2);
      });
    });
  });

  describe("given a dataset that outgrows its own recorded size mid-scan", () => {
    describe("when the scan counts what it has really read", () => {
      /** @scenario A scan that outgrows the limit while it runs is stopped part-way */
      it("refuses when the chunks it reads outweigh the size the dataset recorded", async () => {
        // sizeBytes is stale; scan counts real bytes to stop on right dimension.
        const halfTheLimitEach = Math.ceil(DATASET_SEARCH_MAX_BYTES / 2) + 1;
        const { readChunk } = mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: 6,
              // Stale by three orders of magnitude — the fence sees a tiny dataset.
              sizeBytes: BigInt(1_000),
              chunkOffsets: [
                {
                  index: 0,
                  startRow: 0,
                  endRow: 2,
                  byteSize: halfTheLimitEach,
                },
                {
                  index: 1,
                  startRow: 2,
                  endRow: 4,
                  byteSize: halfTheLimitEach,
                },
                {
                  index: 2,
                  startRow: 4,
                  endRow: 6,
                  byteSize: halfTheLimitEach,
                },
              ],
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
        // One, not zero and not three: zero would mean the up-front fence fired and
        // this test proved nothing about the scan, three would mean the whole
        // dataset was read before anyone objected. One is the chunk that fit — the
        // one that would have breached the limit is refused rather than fetched
        // and then complained about.
        expect(readChunk).toHaveBeenCalledTimes(1);
      });

      it("keeps counting bytes across a chunk whose size was never recorded", async () => {
        // `readValidChunkOffsets` checks row bounds, not `byteSize`, so a valid
        // offsets entry can lack one — added to a running total, `NaN` poisons
        // every later comparison and silently kills the backstop for the whole
        // dataset. An unrecorded size is one chunk this cannot measure, not
        // permission to stop measuring.
        const halfTheLimitEach = Math.ceil(DATASET_SEARCH_MAX_BYTES / 2) + 1;
        mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: 6,
              sizeBytes: null,
              chunkOffsets: [
                { index: 0, startRow: 0, endRow: 2 }, // byteSize never written
                {
                  index: 1,
                  startRow: 2,
                  endRow: 4,
                  byteSize: halfTheLimitEach,
                },
                {
                  index: 2,
                  startRow: 4,
                  endRow: 6,
                  byteSize: halfTheLimitEach,
                },
              ],
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
      });

      it("does not let a negative recorded size buy room for the chunks after it", async () => {
        // A negative size doesn't just fail to bound its own chunk — subtracted
        // from the running total it hands back allowance for every chunk after
        // it, letting one bad entry carry the whole scan past the limit while
        // the total still looks safe. Treated the same as a missing size:
        // unmeasurable, contributing nothing.
        const halfTheLimitEach = Math.ceil(DATASET_SEARCH_MAX_BYTES / 2) + 1;
        const { readChunk } = mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: 6,
              sizeBytes: null,
              chunkOffsets: [
                {
                  index: 0,
                  startRow: 0,
                  endRow: 2,
                  byteSize: -halfTheLimitEach,
                },
                {
                  index: 1,
                  startRow: 2,
                  endRow: 4,
                  byteSize: halfTheLimitEach,
                },
                {
                  index: 2,
                  startRow: 4,
                  endRow: 6,
                  byteSize: halfTheLimitEach,
                },
              ],
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
        // Two: the unmeasurable chunk and the one that fit. Three would mean the
        // negative had paid for the chunk that should have been refused.
        expect(readChunk).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given a dataset that records no size at all", () => {
    describe("when a search runs", () => {
      /** @scenario A chunked dataset that records no size is bounded by the row limit alone */
      it("still refuses on rows alone when the dataset records no size", async () => {
        // A dataset written before its size was recorded has none. Read as zero it
        // would be the smallest dataset in the platform and sail through the byte
        // limit, so the row limit has to keep holding by itself.
        mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: DATASET_SEARCH_MAX_ROWS + 1,
              sizeBytes: null,
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
      });

      it("searches a dataset that records no size and is within the row limit", async () => {
        // The other half of the missing-size case: absent a size, the byte limit
        // has nothing to judge and must not refuse on the absence itself.
        mockChunks();
        const service = makeService({});

        const result = await searchPage({
          service,
          dataset: { ...baseS3Dataset, rowCount: 6, sizeBytes: null },
          search: "escalation",
        });

        expect(result.pagination.total).toBe(2);
      });

      /** @scenario A dataset that records no size is still bounded by the bytes the scan reads */
      it("refuses on the bytes it reads when nothing recorded a size to judge", async () => {
        // sizeBytes null, offsets lack byteSize, recorded total stuck at zero;
        // bound by bytes actually scanned.
        const wideRow = { text: `escalation ${"x".repeat(30 * 1024 * 1024)}` };
        const { readChunk } = mockChunks({
          0: [wideRow],
          1: [wideRow],
          2: [wideRow],
          3: [wideRow],
        });
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              rowCount: 4,
              sizeBytes: null,
              chunkCount: 4,
              chunkOffsets: null, // legacy row: no offsets, so no sizes either
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
        // Four chunks of 30 MB pass 100 MB on the fourth, and nothing could see
        // that coming, so the fourth is read before it is refused. Overshooting
        // by the one chunk that carried the total over is the cost of measuring;
        // reading all four and returning a page would be the bug.
        expect(readChunk).toHaveBeenCalledTimes(4);
      });
    });
  });

  describe("given a chunk offsets index of varying quality", () => {
    describe("when the scan works out which chunks to read", () => {
      it("finds matches in every chunk the offsets index describes", async () => {
        // `chunkOffsets` is what ordinary paging trusts to locate rows, and here it
        // describes three chunks while `chunkCount` says two. Enumerating chunks by
        // the count would stop early and report "no matches" for a row that paging
        // displays — a wrong answer wearing the clothes of a right one.
        mockChunks();
        const service = makeService({});

        const result = await searchPage({
          service,
          dataset: { ...baseS3Dataset, chunkCount: 2 },
          search: "escalation",
        });

        expect(result.pagination.total).toBe(2);
      });

      it("scans every chunk when the offsets index is only partly written", async () => {
        // A half-written offsets array (interrupted migration) mixes entries that
        // pass a per-entry check with ones that don't. Trusting the survivors would
        // silently drop the chunks the bad entries describe and answer "no matches"
        // for rows paging still shows — paging already falls back to `chunkCount`
        // on one bad entry, and the search has to agree with it.
        const { readChunk } = mockChunks();
        const service = makeService({});

        const result = await searchPage({
          service,
          dataset: {
            ...baseS3Dataset,
            chunkOffsets: [
              { index: 0, startRow: 0, endRow: 2 },
              { index: 1 }, // startRow/endRow never written
              null,
            ],
          },
          search: "escalation",
        });

        expect(readChunk).toHaveBeenCalledTimes(3);
        expect(result.pagination.total).toBe(2);
      });

      it("refuses a dataset whose offsets are malformed and whose chunkCount has gone null", async () => {
        // The other end of the fallback above: rejecting the offsets leaves
        // `chunkCount` to say how many chunks exist, and here that has gone null
        // too. Reading it as zero would scan nothing and answer "no matches" for
        // a dataset that has rows — indistinguishable from a right answer — so
        // this throws instead.
        const { readChunk } = mockChunks();
        const service = makeService({});

        await expect(
          searchPage({
            service,
            dataset: {
              ...baseS3Dataset,
              chunkOffsets: [{ index: 0 }],
              chunkCount: null,
            },
            search: "escalation",
          }),
        ).rejects.toBeInstanceOf(DatasetChunkCountMissingError);
        expect(readChunk).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a read with no search term in effect", () => {
    describe("when the page is served", () => {
      it("leaves the unsearched page read on its bounded windowed path", async () => {
        // Regression guard: adding search must not turn an ordinary page request
        // into a full scan. Page 1 of 2 rows overlaps chunk 0 only.
        const { readChunk } = mockChunks();
        const service = makeService({});

        await searchPage({
          service,
          dataset: baseS3Dataset,
          search: "",
          page: 1,
          limit: 2,
        });

        expect(readChunk).toHaveBeenCalledTimes(1);
      });

      it("treats a blank search as no search at all", async () => {
        const { readChunk } = mockChunks();
        const service = makeService({});

        const result = await searchPage({
          service,
          dataset: baseS3Dataset,
          search: "   ",
          page: 1,
          limit: 2,
        });

        // Whole dataset, windowed read — not a scan for rows containing a space.
        expect(result.pagination.total).toBe(6);
        expect(readChunk).toHaveBeenCalledTimes(1);
      });
    });
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
    const rows = entries.map((entry, i) => record(`rec_${i}`, entry));
    return {
      count: vi.fn().mockResolvedValue(rows.length),
      findPage: vi.fn(({ limit, cursorId }: { limit: number; cursorId?: string }) => {
        const start = cursorId ? rows.findIndex((r) => r.id === cursorId) + 1 : 0;
        return Promise.resolve(rows.slice(start, start + limit));
      }),
    };
  };

  describe("given a postgres-backed dataset", () => {
    describe("when a search runs", () => {
      it("applies the same predicate as the s3_jsonl path", async () => {
        // Identical semantics across layouts: the same search must not return
        // different rows depending on where the dataset happens to be stored.
        const recordRepository = makeRecordRepository([
          { text: "billing question" },
          { text: "needs Escalation" },
          { text: "refund request" },
        ]);
        const service = makeService({ recordRepository });

        const result = await searchPage({
          service,
          dataset: pgDataset,
          search: "escalation",
        });

        expect(result.data.map((r) => r.entry.text)).toEqual(["needs Escalation"]);
        expect(result.pagination.total).toBe(1);
      });
    });
  });

  describe("given a postgres-backed dataset larger than one search will read", () => {
    describe("when a search runs", () => {
      it("refuses a dataset with more rows than one search will read", async () => {
        // `sizeBytes` is null on postgres-backed datasets, so the export-time byte
        // guard can never fire here — the row cap is what bounds this path.
        const recordRepository = {
          count: vi.fn().mockResolvedValue(DATASET_SEARCH_MAX_ROWS + 1),
          findPage: vi.fn(),
        };
        const service = makeService({ recordRepository });

        await expect(
          searchPage({ service, dataset: pgDataset, search: "escalation" }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
        // Refused before reading, not part-way through.
        expect(recordRepository.findPage).not.toHaveBeenCalled();
      });

      it("refuses when the walk reads past the cap the count said it would not", async () => {
        // Up-front count taken before walk; records arrive so count becomes stale.
        // Chunk branch has backstop; this needs one too.
        const MAX_BATCHES_BEFORE_GIVING_UP =
          (DATASET_SEARCH_MAX_ROWS / DATASET_SEARCH_SCAN_BATCH) * 2;
        let batchesServed = 0;
        const recordRepository = {
          count: vi.fn().mockResolvedValue(DATASET_SEARCH_MAX_ROWS - 1),
          // A full batch each time, for twice the cap's rows, then a short one.
          // Returning full batches forever would be the truer fake, but a walk
          // with no backstop then never stops — it spins until the heap gives
          // out, which reads as an infrastructure failure rather than this
          // assertion. Bounded, the same missing backstop just fails this test.
          findPage: vi.fn(({ limit }: { limit: number }) => {
            batchesServed += 1;
            const exhausted = batchesServed > MAX_BATCHES_BEFORE_GIVING_UP;
            return Promise.resolve(
              Array.from({ length: exhausted ? 1 : limit }, (_, i) =>
                record(
                  // Ids continue across batches: a keyset walk resumes from the last
                  // id it saw, so repeating them would end the walk by accident and
                  // pass this test without the backstop it exists to require.
                  `rec_${(batchesServed - 1) * limit + i}`,
                  { text: "row" },
                ),
              ),
            );
          }),
        };
        const service = makeService({ recordRepository });

        await expect(
          searchPage({ service, dataset: pgDataset, search: "escalation" }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
        // The point is where it stopped, not merely that it did. Reading every
        // batch the fake will serve and refusing at the end is the unbounded scan
        // wearing a refusal.
        expect(recordRepository.findPage.mock.calls.length).toBeLessThan(
          MAX_BATCHES_BEFORE_GIVING_UP,
        );
      });
    });
  });

  describe("given a search whose matches are paged more than once", () => {
    describe("when the later page is served", () => {
      it("counts once for the whole scan, not once per page", async () => {
        // `listPaginated` runs a count(*) alongside every page, so offset-paging a
        // 50k-row scan issues ~50 redundant full counts. Keyset-paginating counts
        // once and then walks by cursor.
        const entries = Array.from({ length: 2_500 }, (_, i) => ({
          text: i === 2_499 ? "needs Escalation" : `row ${i}`,
        }));
        const recordRepository = makeRecordRepository(entries);
        const service = makeService({ recordRepository });

        const result = await searchPage({
          service,
          dataset: pgDataset,
          search: "escalation",
        });

        expect(result.pagination.total).toBe(1);
        expect(recordRepository.count).toHaveBeenCalledTimes(1);
        expect(
          recordRepository.findPage.mock.calls.every(
            (c) => (c[0] as { skip?: number }).skip === undefined,
          ),
        ).toBe(true);
      });
    });
  });
});
