/**
 * ADR-032: the streaming chunk writer — the I/O orchestrator that turns a
 */
import { generate } from "@langwatch/ksuid";

import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import {
  CHUNK_MAX_BYTES,
  type ChunkedDatasetMeta,
  type ChunkMeta,
  chunkedMeta,
  chunkMetaOf,
} from "../rules/dataset-chunking.rules.ts";

/**
 * The app's KSUID resource for a chunk-line row (`KSUID_RESOURCES.RECORD`).
 * The literal, not the constant table: `record_` is the prefix every reader
 * of the s3_jsonl layout already expects.
 */
const RECORD_KSUID_RESOURCE = "record";

/**
 * A buffer that accumulates parsed records and flushes them to chunk objects as soon as their
 * serialized size reaches `CHUNK_MAX_BYTES`, keeping memory bounded regardless of the source
 * size.
 */
export class StreamingChunkWriterService {
  static create(deps: {
    storage: DatasetChunkRepository;
    projectId: string;
    datasetId: string;
  }): StreamingChunkWriterService {
    return new StreamingChunkWriterService(deps);
  }

  private buffer: unknown[] = [];
  private bufferBytes = 0;
  private nextIndex = 0;
  /**
   * Running global row offset of the next chunk.
   */
  private nextStartRow = 0;
  /**
   * I-MEM: accumulate only lightweight per-chunk metadata (no `jsonl` payload).
   */
  private readonly chunkMetas: ChunkMeta[] = [];

  private constructor(
    private readonly deps: {
      storage: DatasetChunkRepository;
      projectId: string;
      datasetId: string;
    },
  ) {}

  /**
   * Buffer one row. Mints a fresh `record_<ksuid>` id for new rows (normalize / upload);
   * PRESERVES a caller-supplied `id` when given — the PG→S3 backfill passes the existing
   * `DatasetRecord.id` so edit/delete keeps targeting the same row after cutover (I-MIG).
   */
  async push(entry: unknown, opts?: { id?: string }): Promise<void> {
    const record = { id: opts?.id ?? generate(RECORD_KSUID_RESOURCE).toString(), entry };
    // Track an approximate serialized size to decide when to roll over. The
    // authoritative byteSize is recomputed inside toJsonlChunks on flush.
    this.bufferBytes += Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    this.buffer.push(record);
    if (this.bufferBytes >= CHUNK_MAX_BYTES) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const written = await this.deps.storage.writeChunks({
      projectId: this.deps.projectId,
      datasetId: this.deps.datasetId,
      records: this.buffer,
      fromIndex: this.nextIndex,
    });
    // I-MEM: keep only the metadata; the `jsonl` payloads are released here so
    // they can be garbage-collected immediately after the write returns.
    // Rebase the per-batch row offsets (which restart at 0 each `writeChunks`
    // call) onto the running global base so `chunkOffsets` stays contiguous
    // across flushes — the paginated read locates pages by `startRow`.
    const base = this.nextStartRow;
    this.chunkMetas.push(
      ...written.map((chunk) => ({
        ...chunkMetaOf(chunk),
        startRow: chunk.startRow + base,
        endRow: chunk.endRow + base,
      })),
    );
    this.nextStartRow = base + (written.at(-1)?.endRow ?? 0);
    this.nextIndex += written.length;
    this.buffer = [];
    this.bufferBytes = 0;
  }

  /**
   * Flush the remainder and return the aggregated `ChunkedDatasetMeta`, computed
   * from the accumulated per-chunk metadata alone (never the `jsonl` payloads).
   */
  async finalize(): Promise<ChunkedDatasetMeta> {
    await this.flush();

    return chunkedMeta(this.chunkMetas);
  }
}
