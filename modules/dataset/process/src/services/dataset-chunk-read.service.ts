import type { Dataset, DatasetRecord, DatasetWithRecords } from "@langwatch/dataset-contract";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import { isChunkLine } from "../rules/dataset-chunk-lines.rules.ts";
import { readChunkOffsets } from "../rules/dataset-chunk-offsets.rules.ts";
import { CHUNK_MAX_BYTES, type ChunkOffset } from "../rules/dataset-chunking.rules.ts";
import { entryBytesOf } from "../rules/dataset-row-limits.rules.ts";

/** Most chunk reads one dataset read keeps in flight: a slice of the store client's sockets. */
export const CHUNK_READS_IN_FLIGHT = 8;

/** Bytes a read fetches ahead of its reader, by the offset index; full-size chunks go one ahead. */
const CHUNK_PREFETCH_BYTES = CHUNK_MAX_BYTES;

/** Which chunks a read walks: every one up to `chunkCount`, or the named indices in order. */
type ChunkSelection = { chunkCount: number } | { indices: readonly number[] };

/** What the prefetch needs of the offset index: each chunk's recorded size, when it has one. */
type ChunkSize = { index: number; byteSize?: number | null };

type PendingChunk<Chunk> = { chunk: Promise<Chunk>; bytes: number };

/** Reads rows out of a dataset stored as s3_jsonl chunks, a bounded prefetch in memory. */
export class DatasetChunkReadService {
  private constructor() {}

  static create(): DatasetChunkReadService {
    return new DatasetChunkReadService();
  }

  /**
   * The chunks in order, fetched ahead of the reader within a byte budget (ADR-032 v21), so a
   * dataset of many small chunks does not wait for each in turn. Holds at most the budget plus
   * the chunk being read; a read the reader leaves early, or that fails, rejects nothing unseen.
   */
  chunksInOrder({
    storage,
    projectId,
    datasetId,
    ...rest
  }: {
    storage: DatasetChunkRepository;
    projectId: string;
    datasetId: string;
    offsets: readonly ChunkOffset[];
  } & ChunkSelection): AsyncGenerator<unknown[]> {
    return this.readsInOrder({
      ...rest,
      read: (index) => storage.readChunk({ projectId, datasetId, index }),
    });
  }

  /** One per-chunk read in order, fetched ahead within the budget and the in-flight cap. */
  private async *readsInOrder<Chunk>({
    offsets,
    read,
    ...selection
  }: {
    offsets: readonly ChunkSize[];
    read: (index: number) => Promise<Chunk>;
  } & ChunkSelection): AsyncGenerator<Chunk> {
    const indices =
      "indices" in selection
        ? selection.indices
        : Array.from({ length: selection.chunkCount }, (_, index) => index);
    const sizes = new Map(offsets.map((offset) => [offset.index, offset.byteSize]));
    const sizeOf = (index: number) => {
      const size = sizes.get(index);
      return typeof size === "number" && size > 0 ? size : CHUNK_MAX_BYTES;
    };
    const pending: PendingChunk<Chunk>[] = [];
    let next = 0;
    let aheadBytes = 0;
    const fill = () => {
      while (next < indices.length && pending.length < CHUNK_READS_IN_FLIGHT) {
        const index = indices[next]!;
        const bytes = sizeOf(index);
        if (pending.length > 0 && aheadBytes + bytes > CHUNK_PREFETCH_BYTES) return;
        const chunk = read(index);
        chunk.catch(() => undefined);
        pending.push({ chunk, bytes });
        aheadBytes += bytes;
        next += 1;
      }
    };
    fill();
    for (let head = pending.shift(); head; head = pending.shift()) {
      const chunk = await head.chunk;
      aheadBytes -= head.bytes;
      fill();
      yield chunk;
    }
  }

  /** Every chunk of the dataset in order, fetched ahead as {@link chunksInOrder} does. */
  chunksOf({
    storage,
    dataset,
  }: {
    storage: DatasetChunkRepository;
    dataset: Pick<Dataset, "id" | "projectId" | "chunkCount" | "chunkOffsets">;
  }): AsyncGenerator<unknown[]> {
    return this.chunksInOrder({
      storage,
      projectId: dataset.projectId,
      datasetId: dataset.id,
      chunkCount: dataset.chunkCount ?? 0,
      offsets: readChunkOffsets(dataset.chunkOffsets),
    });
  }

  /** The entries of the named rows, read chunk by chunk until every id is found. */
  async findEntries({
    dataset,
    projectId,
    ids,
    storage,
  }: {
    dataset: Pick<Dataset, "id" | "chunkCount" | "chunkOffsets">;
    projectId: string;
    ids: readonly string[];
    storage: DatasetChunkRepository;
  }): Promise<Record<string, unknown>[]> {
    const remaining = new Set(ids);
    const entries: Record<string, unknown>[] = [];
    if (remaining.size === 0) return entries;
    for await (const rows of this.chunksInOrder({
      storage,
      projectId,
      datasetId: dataset.id,
      chunkCount: dataset.chunkCount ?? 0,
      offsets: readChunkOffsets(dataset.chunkOffsets),
    })) {
      for (const line of rows) {
        if (!isChunkLine(line) || !remaining.has(line.id)) continue;
        remaining.delete(line.id);
        if (typeof line.entry === "object" && line.entry !== null) {
          entries.push({ ...line.entry });
        }
      }
      if (remaining.size === 0) break;
    }

    return entries;
  }

  /**
   * Every row in order until the byte budget is spent. The read stops at the
   * first row that does not fit, and reports rows left out instead of skipping it.
   */
  async readWithinBudget({
    dataset,
    limitBytes,
    storage,
    toRecord,
  }: {
    dataset: Dataset;
    limitBytes: number;
    storage: DatasetChunkRepository;
    toRecord: (line: unknown) => DatasetRecord;
  }): Promise<DatasetWithRecords> {
    const { projectId } = dataset;
    const records: DatasetRecord[] = [];
    let bytes = 0;
    let rowsSeen = 0;
    for await (const lines of this.chunksInOrder({
      storage,
      projectId,
      datasetId: dataset.id,
      chunkCount: dataset.chunkCount ?? 0,
      offsets: readChunkOffsets(dataset.chunkOffsets),
    })) {
      for (const line of lines) {
        rowsSeen += 1;
        const record = toRecord(line);
        bytes += entryBytesOf(record.entry);
        if (bytes > limitBytes) {
          const totalRows = Math.max(dataset.rowCount ?? 0, rowsSeen);

          return { dataset, records, truncated: true, totalRows };
        }
        records.push(record);
      }
    }

    return { dataset, records, truncated: false, totalRows: records.length };
  }
}
