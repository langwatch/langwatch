import type { Authorization } from "@langwatch/authorization";
import { type AuthorizedClickHouse, tenantScope } from "@langwatch/clickhouse-client";
import { EventUtils } from "@langwatch/eventing";
import type { SimilarTrace, TraceEmbeddingsRecord } from "@langwatch/trace-contract";
import { z } from "zod";

import type { TraceClickHouseWriteResolver } from "../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import {
  type TraceEmbeddingSource,
  TraceEmbeddingRepository,
} from "../trace-embedding.repository.ts";

const TABLE_NAME = "trace_embeddings" as const;

/** A clustering page is up to 2000 rows of 1.5 KiB; batching them server-side keeps parts few. */
const INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_skip_unknown_fields: 0,
} as const;

const sourceRowsSchema = z.array(
  z.object({
    EmbeddingsModel: z.string(),
    Vector: z.array(z.number()),
  }),
);

const nearestRowsSchema = z.array(
  z.object({
    TraceId: z.string(),
    OccurredAtMs: z.union([z.string(), z.number()]),
    Distance: z.union([z.string(), z.number()]),
  }),
);

/**
 * `trace_embeddings` in ClickHouse. Writes resolve the tenant's own client; reads go through
 * the route's proof (ADR-177), which the caller narrows to the one project holding the trace.
 */
export class ClickHouseTraceEmbeddingRepository extends TraceEmbeddingRepository {
  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    clickhouse: AuthorizedClickHouse;
  }): ClickHouseTraceEmbeddingRepository {
    return new ClickHouseTraceEmbeddingRepository(options.resolveClient, options.clickhouse);
  }

  private constructor(
    private readonly resolveClient: TraceClickHouseWriteResolver,
    private readonly clickhouse: AuthorizedClickHouse,
  ) {
    super();
  }

  async upsert(input: TraceEmbeddingsRecord & { retentionDays: number }): Promise<void> {
    if (input.embeddings.length === 0) return;
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "ClickHouseTraceEmbeddingRepository.upsert",
    );

    const client = await this.resolveClient(input.tenantId);
    await client.insert({
      table: TABLE_NAME,
      values: input.embeddings.map((embedding) => ({
        TenantId: input.tenantId,
        TraceId: embedding.traceId,
        OccurredAt: new Date(embedding.occurredAtMs),
        EmbeddingsModel: input.embeddingsModel,
        Embedding: embedding.vector,
        _retention_days: input.retentionDays,
      })),
      format: "JSONEachRow",
      clickhouse_settings: INSERT_SETTINGS,
    });
  }

  async findSource(input: {
    authorization: Authorization;
    traceId: string;
    windowStartMs: number;
  }): Promise<TraceEmbeddingSource | null> {
    const result = await this.clickhouse.as(input.authorization, { reads: "traces" }).query({
      query: `
          SELECT EmbeddingsModel, argMax(Embedding, UpdatedAt) AS Vector
          FROM ${TABLE_NAME}
          WHERE ${tenantScope("OccurredAt")}
            AND OccurredAt >= fromUnixTimestamp64Milli({windowStartMs:Int64})
            AND TraceId = {traceId:String}
          GROUP BY EmbeddingsModel
          ORDER BY max(UpdatedAt) DESC
          LIMIT 1
        `,
      query_params: { traceId: input.traceId, windowStartMs: input.windowStartMs },
      format: "JSONEachRow",
    });

    const row = sourceRowsSchema.parse(await result.json())[0];
    if (!row) return null;

    return { embeddingsModel: row.EmbeddingsModel, vector: row.Vector };
  }

  async findNearest(input: {
    authorization: Authorization;
    traceId: string;
    source: TraceEmbeddingSource;
    windowStartMs: number;
    limit: number;
  }): Promise<SimilarTrace[]> {
    // GROUP BY TraceId folds rows the engine has not merged yet; only small values leave the scan.
    const result = await this.clickhouse.as(input.authorization, { reads: "traces" }).query({
      query: `
          SELECT
            TraceId,
            toUnixTimestamp64Milli(max(OccurredAt)) AS OccurredAtMs,
            min(cosineDistance(Embedding, {vector:Array(Int8)})) AS Distance
          FROM ${TABLE_NAME}
          WHERE ${tenantScope("OccurredAt")}
            AND OccurredAt >= fromUnixTimestamp64Milli({windowStartMs:Int64})
            AND EmbeddingsModel = {embeddingsModel:String}
            AND TraceId != {traceId:String}
          GROUP BY TraceId
          ORDER BY Distance ASC, TraceId ASC
          LIMIT {limit:UInt32}
        `,
      query_params: {
        traceId: input.traceId,
        windowStartMs: input.windowStartMs,
        embeddingsModel: input.source.embeddingsModel,
        vector: [...input.source.vector],
        limit: input.limit,
      },
      format: "JSONEachRow",
    });

    return nearestRowsSchema.parse(await result.json()).map((row) => ({
      traceId: row.TraceId,
      occurredAtMs: Number(row.OccurredAtMs),
      distance: Number(row.Distance),
    }));
  }
}
