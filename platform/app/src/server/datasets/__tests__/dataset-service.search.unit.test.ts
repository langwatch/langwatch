import { beforeEach, describe, expect, it, vi } from "vitest";

// Same boundaries as dataset-service.s3-reads: mock the storage accessor only,
// so the search scan (chunk routing + predicate + windowing) runs for real.
vi.mock("../dataset-storage", () => ({ getDatasetStorage: vi.fn() }));
vi.mock("../dataset-normalize.queue", () => ({
  enqueueDatasetNormalize: vi.fn().mockResolvedValue(undefined),
}));

import { DatasetService } from "../dataset.service";
import {
  DATASET_SEARCH_MAX_BYTES,
  DATASET_SEARCH_MAX_ROWS,
  DATASET_SEARCH_SCAN_BATCH,
} from "../dataset-search";
import { getDatasetStorage } from "../dataset-storage";
import {
  DatasetChunkCountMissingError,
  DatasetTooLargeToSearchError,
} from "../errors";

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
}) =>
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
        ).rejects.toThrow();
        expect(readChunk).not.toHaveBeenCalled();
      });

      /** @scenario A dataset within the row limit but over the byte limit refuses the search */
      it("refuses a dataset whose rows occupy more bytes than one search will read", async () => {
        // Well inside the row cap, and the most expensive scan the search could be
        // asked to run: rows are as wide as the columns they were given, so a row
        // count says nothing about how much has to be fetched and parsed to produce
        // them.
        //
        // `sizeBytes` is a bigint here because it is a bigint on the row. Passing a
        // number would typecheck against this fixture and exercise a comparison the
        // service never performs.
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
        ).rejects.toThrow();
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
        // `sizeBytes` is a field on the dataset row, not a measurement taken at
        // read time. Appends land in new chunks and the field does not always move
        // with them, so a stale one passes the up-front fence and the scan then
        // fetches and parses however much is really there, with nothing bounding
        // it. The row backstop immediately above still stops the scan eventually,
        // which is why this is the smaller of the two holes — but it stops it on
        // the wrong dimension: 50,000 rows of stored model responses is exactly the
        // read the byte limit exists to refuse.
        //
        // Two of the three chunks are enough to pass the limit, so a scan that
        // counts what it reads stops on reaching the second.
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
        // `readValidChunkOffsets` checks the row bounds and not `byteSize`, so a
        // valid offsets array can carry an entry without one. Added to a running
        // total that value poisons it — every later comparison against `NaN` is
        // false — and the backstop silently stops existing for the whole dataset,
        // with every other test in this file still green. An unrecorded size is one
        // chunk this cannot measure, not permission to stop measuring.
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
        // A size below zero is not a small chunk, it is a broken record — and
        // subtracted from a running total it does not merely fail to bound its own
        // chunk, it hands back allowance for every chunk that follows. One entry
        // reading -100 MB is enough to carry the whole scan past the limit while
        // the total still looks well inside it. Normalised the same way a missing
        // size is: one chunk this cannot measure, contributing nothing.
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
        // A half-written offsets array (an interrupted migration) has entries that
        // pass a per-entry check and entries that do not. Trusting the survivors
        // silently drops the chunks the broken entries described — here chunk 2,
        // where every match lives, so the search would answer "no matches" for rows
        // ordinary paging still displays. Ordinary paging already rejects the whole
        // array on one bad entry and falls back to `chunkCount`; the search has to
        // agree with it, or the same dataset answers two ways.
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
        // `chunkCount` to say how many chunks there are, and on a dataset where
        // that has gone null too there is nothing left to ask. Reading it as zero
        // would scan no chunks and answer "no matches" for a dataset that has them
        // — a wrong answer the user cannot tell from a right one, which is why this
        // throws instead.
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

        expect(result.data.map((r) => r.entry.text)).toEqual([
          "needs Escalation",
        ]);
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
          countAndMaxUpdatedAt: vi.fn().mockResolvedValue({
            count: DATASET_SEARCH_MAX_ROWS + 1,
            maxUpdatedAt: null,
          }),
          findDatasetRecordsPage: vi.fn(),
        };
        const service = makeService({ recordRepository });

        await expect(
          searchPage({ service, dataset: pgDataset, search: "escalation" }),
        ).rejects.toBeInstanceOf(DatasetTooLargeToSearchError);
        // Refused before reading, not part-way through.
        expect(recordRepository.findDatasetRecordsPage).not.toHaveBeenCalled();
      });

      it("refuses when the walk reads past the cap the count said it would not", async () => {
        // The up-front check reads a count taken before the walk starts. Records
        // keep arriving during it, so a dataset sitting just under the cap can be
        // carried past it by a busy writer — the case a count taken beforehand
        // cannot see. With nothing bounding the rows actually read, the walk goes
        // as far as the writer takes it: the unbounded scan the cap exists to
        // prevent. The chunk branch already holds this backstop; this one did not.
        //
        // Twice the cap's worth of batches: enough that a walk bounded by the cap
        // stops well inside it, and a walk bounded by nothing runs off the end.
        const MAX_BATCHES_BEFORE_GIVING_UP =
          (DATASET_SEARCH_MAX_ROWS / DATASET_SEARCH_SCAN_BATCH) * 2;
        let batchesServed = 0;
        const recordRepository = {
          countAndMaxUpdatedAt: vi.fn().mockResolvedValue({
            count: DATASET_SEARCH_MAX_ROWS - 1,
            maxUpdatedAt: null,
          }),
          // A full batch every time the walk asks, for twice as many rows as the
          // cap allows, and then a short one. Handing back full batches forever
          // would be the truer fake, but a walk with no backstop never asks for the
          // last one — it spins until the heap gives out and takes the whole runner
          // with it, which reads as an infrastructure failure rather than as this
          // assertion. Bounded, the same missing backstop shows up as this test
          // failing and nothing else.
          findDatasetRecordsPage: vi.fn(({ take }: { take: number }) => {
            batchesServed += 1;
            const exhausted = batchesServed > MAX_BATCHES_BEFORE_GIVING_UP;
            return Promise.resolve(
              Array.from({ length: exhausted ? 1 : take }, (_, i) => ({
                // Ids continue across batches: a keyset walk resumes from the last
                // id it saw, so repeating them would end the walk by accident and
                // pass this test without the backstop it exists to require.
                id: `rec_${(batchesServed - 1) * take + i}`,
                entry: { text: "row" },
              })),
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
        expect(
          recordRepository.findDatasetRecordsPage.mock.calls.length,
        ).toBeLessThan(MAX_BATCHES_BEFORE_GIVING_UP);
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
        expect(recordRepository.countAndMaxUpdatedAt).toHaveBeenCalledTimes(1);
        expect(
          recordRepository.findDatasetRecordsPage.mock.calls.every(
            (c) => (c[0] as { skip?: number }).skip === undefined,
          ),
        ).toBe(true);
      });
    });
  });
});
