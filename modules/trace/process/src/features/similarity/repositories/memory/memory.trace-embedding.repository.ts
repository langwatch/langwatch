import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";
import type { SimilarTrace, TraceEmbeddingsRecord } from "@langwatch/trace-contract";

import {
  type TraceEmbeddingSource,
  TraceEmbeddingRepository,
} from "../trace-embedding.repository.ts";

interface StoredEmbedding {
  tenantId: string;
  traceId: string;
  embeddingsModel: string;
  occurredAtMs: number;
  vector: readonly number[];
  retentionDays: number;
  writtenAt: number;
}

/** Cosine distance as ClickHouse's `cosineDistance` answers it. */
function cosineDistance(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  return 1 - dot / Math.sqrt(leftNorm * rightNorm);
}

/** `trace_embeddings` in memory, keyed as the table's sorting key keys it. */
export class MemoryTraceEmbeddingRepository extends TraceEmbeddingRepository {
  static create(): MemoryTraceEmbeddingRepository {
    return new MemoryTraceEmbeddingRepository();
  }

  readonly #rows = new Map<string, StoredEmbedding>();
  #writes = 0;

  private constructor() {
    super();
  }

  /** Every row held, for a test to read what was written. */
  get rows(): readonly StoredEmbedding[] {
    return [...this.#rows.values()];
  }

  async upsert(input: TraceEmbeddingsRecord & { retentionDays: number }): Promise<void> {
    for (const embedding of input.embeddings) {
      this.#writes += 1;
      this.#rows.set(`${input.tenantId}\u0000${input.embeddingsModel}\u0000${embedding.traceId}`, {
        tenantId: input.tenantId,
        traceId: embedding.traceId,
        embeddingsModel: input.embeddingsModel,
        occurredAtMs: embedding.occurredAtMs,
        vector: embedding.vector,
        retentionDays: input.retentionDays,
        writtenAt: this.#writes,
      });
    }
  }

  async findSource(input: {
    authorization: Authorization;
    traceId: string;
    windowStartMs: number;
  }): Promise<TraceEmbeddingSource | null> {
    const latest = this.#readable(input)
      .filter((row) => row.traceId === input.traceId)
      .toSorted((a, b) => b.writtenAt - a.writtenAt)[0];
    if (!latest) return null;

    return { embeddingsModel: latest.embeddingsModel, vector: latest.vector };
  }

  async findNearest(input: {
    authorization: Authorization;
    traceId: string;
    source: TraceEmbeddingSource;
    windowStartMs: number;
    limit: number;
  }): Promise<SimilarTrace[]> {
    return this.#readable(input)
      .filter(
        (row) =>
          row.traceId !== input.traceId && row.embeddingsModel === input.source.embeddingsModel,
      )
      .map((row) => ({
        traceId: row.traceId,
        occurredAtMs: row.occurredAtMs,
        distance: cosineDistance(row.vector, input.source.vector),
      }))
      .toSorted((a, b) => a.distance - b.distance || (a.traceId < b.traceId ? -1 : 1))
      .slice(0, input.limit);
  }

  #readable(input: { authorization: Authorization; windowStartMs: number }): StoredEmbedding[] {
    const projects = new Set(projectIdsReadBy(input.authorization));
    return [...this.#rows.values()].filter(
      (row) => projects.has(row.tenantId) && row.occurredAtMs >= input.windowStartMs,
    );
  }
}
