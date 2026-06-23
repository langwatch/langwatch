/**
 * ADR-032: the streaming chunk writer — the I/O orchestrator that turns a
 * record stream into chunked-JSONL objects with bounded memory.
 *
 * Kept OUT of `dataset-chunking.ts` (which is deliberately pure / no-I/O): this
 * class calls `storage.writeChunks`, so it depends on a `DatasetStorage`. It is
 * shared by every born-on-storage producer:
 *   - the async normalize job (upload → chunks),
 *   - the PG→S3 backfill (DatasetRecord pages → chunks).
 * so the chunk-rollover + offset math lives in exactly one place.
 */
import { nanoid } from "nanoid";
import {
  CHUNK_MAX_BYTES,
  type ChunkedDatasetMeta,
  type ChunkMeta,
  chunkedMeta,
  chunkMetaOf,
} from "./dataset-chunking";
import type { DatasetStorage } from "./dataset-storage";

/**
 * A buffer that accumulates parsed records and flushes them to chunk objects as
 * soon as their serialized size reaches `CHUNK_MAX_BYTES`, keeping memory
 * bounded regardless of the source size. Each flush calls `writeChunks` with the
 * running `fromIndex`, so chunk keys stay contiguous across flushes.
 *
 * Each row is wrapped as `{ id, entry }` (mirroring the logical `DatasetRecord`
 * shape) so every row carries a stable id a later edit/delete can target — the
 * read adapter maps `{id, entry}` back to a `DatasetRecord`-shaped object. The
 * id is assigned per-record here so this stays streaming (never builds an
 * in-memory array of the whole source).
 */
export class StreamingChunkWriter {
  private buffer: unknown[] = [];
  private bufferBytes = 0;
  private nextIndex = 0;
  /**
   * I-MEM: accumulate only lightweight per-chunk metadata (no `jsonl` payload).
   * Each flush maps its written `DatasetChunk[]` to `ChunkMeta[]` and drops the
   * serialized bodies, so a multi-GB source never holds the whole normalized
   * file in heap by the time `finalize()` runs.
   */
  private readonly chunkMetas: ChunkMeta[] = [];

  constructor(
    private readonly deps: {
      storage: DatasetStorage;
      projectId: string;
      datasetId: string;
    },
  ) {}

  /**
   * Buffer one row. Mints a fresh `record_<nanoid>` id for new rows
   * (normalize / upload); PRESERVES a caller-supplied `id` when given — the
   * PG→S3 backfill passes the existing `DatasetRecord.id` so edit/delete keeps
   * targeting the same row after cutover (I-MIG). The per-record assignment
   * keeps this streaming.
   */
  async push(entry: unknown, opts?: { id?: string }): Promise<void> {
    const record = { id: opts?.id ?? `record_${nanoid()}`, entry };
    // Track an approximate serialized size to decide when to roll over. The
    // authoritative byteSize is recomputed inside toJsonlChunks on flush.
    this.bufferBytes += Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    this.buffer.push(record);
    if (this.bufferBytes >= CHUNK_MAX_BYTES) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const written = await this.deps.storage.writeChunks({
      projectId: this.deps.projectId,
      datasetId: this.deps.datasetId,
      records: this.buffer,
      fromIndex: this.nextIndex,
    });
    // I-MEM: keep only the metadata; the `jsonl` payloads are released here so
    // they can be garbage-collected immediately after the write returns.
    this.chunkMetas.push(...written.map(chunkMetaOf));
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
