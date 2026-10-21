import type { Authorization } from "@langwatch/authorization";
import type { SimilarTrace, TraceEmbeddingsRecord } from "@langwatch/trace-contract";

/** The asked trace's own embedding, found inside the window. */
export interface TraceEmbeddingSource {
  embeddingsModel: string;
  vector: readonly number[];
}

/** One project's trace embeddings (goose 00123, `trace_embeddings`). */
export abstract class TraceEmbeddingRepository {
  /** Writes one row per trace; a later write of the same trace and model replaces it. */
  abstract upsert(input: TraceEmbeddingsRecord & { retentionDays: number }): Promise<void>;

  /** The trace's latest embedding inside the window; null when clustering never embedded it. */
  abstract findSource(input: {
    authorization: Authorization;
    traceId: string;
    windowStartMs: number;
  }): Promise<TraceEmbeddingSource | null>;

  /** The nearest other traces by cosine distance, same model, inside the proof's one project. */
  abstract findNearest(input: {
    authorization: Authorization;
    traceId: string;
    source: TraceEmbeddingSource;
    windowStartMs: number;
    limit: number;
  }): Promise<SimilarTrace[]>;
}
