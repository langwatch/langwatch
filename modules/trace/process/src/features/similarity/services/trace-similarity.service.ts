import { type Authorization, narrowAuthorization } from "@langwatch/authorization";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  type SimilarTracesInput,
  type SimilarTracesResult,
  TRACE_EMBEDDING_COMPONENT_MAX,
  TRACE_EMBEDDING_DIMENSIONS,
  type TraceEmbedding,
  type TraceEmbeddingsRecord,
  TraceNotFoundError,
} from "@langwatch/trace-contract";

import type { TraceEmbeddingRepository } from "../repositories/trace-embedding.repository.ts";

const logger = createLogger("langwatch:trace:similarity");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Clustering embeds traces from its 49-day fetch window, which is also the hot storage tier. */
const SIMILARITY_WINDOW_DAYS = 49;

/** Keeps clustering's embeddings and answers "traces like this one" (trace ADR-003). */
export class TraceSimilarityService {
  static create(options: {
    repository: TraceEmbeddingRepository;
    dataRetention: Pick<DataRetentionApi, "getRetentionDays">;
    now?: () => number;
  }): TraceSimilarityService {
    return new TraceSimilarityService(
      options.repository,
      options.dataRetention,
      options.now ?? (() => nowInstant().epochMilliseconds),
    );
  }

  private constructor(
    private readonly repository: TraceEmbeddingRepository,
    private readonly dataRetention: Pick<DataRetentionApi, "getRetentionDays">,
    private readonly now: () => number,
  ) {}

  async record(input: TraceEmbeddingsRecord): Promise<void> {
    const embeddings = input.embeddings.filter((embedding) =>
      TraceSimilarityService.isStorable(embedding),
    );
    const refused = input.embeddings.length - embeddings.length;
    if (refused > 0) {
      logger.warn(
        { tenantId: input.tenantId, refused, expectedDimensions: TRACE_EMBEDDING_DIMENSIONS },
        "Dropped trace embeddings that are the wrong width, outside int8 or all zero",
      );
    }
    if (embeddings.length === 0) return;

    const retentionDays = await this.dataRetention.getRetentionDays({
      projectId: input.tenantId,
      category: "traces",
    });
    await this.repository.upsert({ ...input, embeddings, retentionDays });
  }

  async findSimilar(
    input: SimilarTracesInput & { authorization: Authorization },
  ): Promise<SimilarTracesResult> {
    // Narrowed to the one project holding the trace, so no neighbour comes from another project.
    const authorization = narrowAuthorization({
      authorization: input.authorization,
      projectId: input.tenantId ?? input.projectId,
    });
    if (!authorization) throw new TraceNotFoundError(input.traceId);

    const windowStartMs = this.now() - SIMILARITY_WINDOW_DAYS * DAY_MS;
    const source = await this.repository.findSource({
      authorization,
      traceId: input.traceId,
      windowStartMs,
    });
    if (!source) return { status: "not_embedded", embeddingsModel: null, traces: [] };

    const traces = await this.repository.findNearest({
      authorization,
      traceId: input.traceId,
      source,
      windowStartMs,
      limit: input.limit,
    });

    return { status: "ready", embeddingsModel: source.embeddingsModel, traces };
  }

  private static isStorable(embedding: TraceEmbedding): boolean {
    return (
      embedding.vector.length === TRACE_EMBEDDING_DIMENSIONS &&
      embedding.vector.every(
        (value) => Number.isInteger(value) && Math.abs(value) <= TRACE_EMBEDDING_COMPONENT_MAX,
      ) &&
      embedding.vector.some((value) => value !== 0)
    );
  }
}
