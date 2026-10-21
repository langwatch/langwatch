import type { TopicClusteringTraceEmbedding } from "@langwatch/topic-contract";
import type { TraceEmbedding } from "@langwatch/trace-contract";

/** One langevals embedding (base64 of int8) as the numbers it encodes, each -127 to 127. */
export function decodeTraceEmbeddingVector(encoded: string): number[] {
  const bytes = Buffer.from(encoded, "base64");

  return Array.from(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/**
 * The embeddings of the traces this page read, anchored on when each happened. A trace the
 * page did not read has no anchor, so it is left out rather than aged from the wrong time.
 */
export function anchoredTraceEmbeddings({
  embeddings,
  occurredAtMsByTraceId,
}: {
  embeddings: readonly TopicClusteringTraceEmbedding[];
  occurredAtMsByTraceId: Readonly<Record<string, number>>;
}): TraceEmbedding[] {
  return embeddings.flatMap((embedding) => {
    if (!Object.hasOwn(occurredAtMsByTraceId, embedding.trace_id)) return [];
    const occurredAtMs = occurredAtMsByTraceId[embedding.trace_id];
    if (occurredAtMs === undefined) return [];

    return [
      {
        traceId: embedding.trace_id,
        occurredAtMs,
        vector: decodeTraceEmbeddingVector(embedding.embedding),
      },
    ];
  });
}
