import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * "Find traces like this one" over the embeddings topic clustering already computes.
 * @see modules/trace/adrs/003-similar-traces-from-clustering-embeddings.md
 */

/** The width clustering pins every embedding to (text-embedding-3-small, padded or cut). */
export const TRACE_EMBEDDING_DIMENSIONS = 1536;

/** The most neighbours one ask may return. */
export const SIMILAR_TRACES_LIMIT_MAX = 50;

const SIMILAR_TRACES_LIMIT_DEFAULT = 10;

/** The bound of each component: clustering's vectors arrive scaled to int8, direction only. */
export const TRACE_EMBEDDING_COMPONENT_MAX = 127;

/** One trace's embedding, anchored on when the trace happened so it ages with the trace. */
export interface TraceEmbedding {
  traceId: string;
  occurredAtMs: number;
  vector: readonly number[];
}

/** One clustering page's embeddings, all in one project, all from one embeddings model. */
export interface TraceEmbeddingsRecord {
  tenantId: string;
  embeddingsModel: string;
  embeddings: readonly TraceEmbedding[];
}

const similarTracesInputSchemaDefinition = z.object({
  projectId: z.string(),
  traceId: z.string().min(1),
  /** The member project that holds the trace, when the project is an aggregate (ADR-177). */
  tenantId: z.string().min(1).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(SIMILAR_TRACES_LIMIT_MAX)
    .default(SIMILAR_TRACES_LIMIT_DEFAULT),
});
export interface SimilarTracesInputSchema extends Named<
  typeof similarTracesInputSchemaDefinition
> {}
export const similarTracesInputSchema: SimilarTracesInputSchema =
  similarTracesInputSchemaDefinition;
export type SimilarTracesInput = z.infer<typeof similarTracesInputSchema>;

const similarTraceSchemaDefinition = z.object({
  traceId: z.string(),
  occurredAtMs: z.number(),
  /** Cosine distance to the asked trace: 0 is the same direction, 2 the opposite. */
  distance: z.number(),
});
export interface SimilarTraceSchema extends Named<typeof similarTraceSchemaDefinition> {}
export const similarTraceSchema: SimilarTraceSchema = similarTraceSchemaDefinition;
export type SimilarTrace = z.infer<typeof similarTraceSchema>;

const similarTracesResultSchemaDefinition = z.object({
  /** `not_embedded`: topic clustering has not embedded the asked trace (yet, or at all). */
  status: z.enum(["ready", "not_embedded"]),
  embeddingsModel: z.string().nullable(),
  traces: z.array(similarTraceSchema),
});
export interface SimilarTracesResultSchema extends Named<
  typeof similarTracesResultSchemaDefinition
> {}
export const similarTracesResultSchema: SimilarTracesResultSchema =
  similarTracesResultSchemaDefinition;
export type SimilarTracesResult = z.infer<typeof similarTracesResultSchema>;
