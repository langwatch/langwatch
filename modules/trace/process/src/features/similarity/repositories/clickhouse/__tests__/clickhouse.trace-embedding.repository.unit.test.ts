/**
 * The statements `trace_embeddings` is written and read with.
 * @see modules/trace/specs/similar-traces.feature
 */
import { narrowAuthorization } from "@langwatch/authorization";
import { AuthorizedClickHouse, type QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { ClickHouseTraceEmbeddingRepository } from "../clickhouse.trace-embedding.repository.ts";

type Sent = { sql: string; params: Record<string, unknown> };

function repositoryAnswering(rows: unknown[]) {
  const sent: Sent[] = [];
  const insert = vi.fn(async (_input: unknown) => undefined);
  const authorized = clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => {
      sent.push({ sql: request.sql, params: request.params ?? {} });
      return { rows };
    },
  });
  const repository = ClickHouseTraceEmbeddingRepository.create({
    resolveClient: async () => ({
      query: async () => ({ json: async () => [] }),
      insert,
    }),
    clickhouse: new AuthorizedClickHouse({ resolveClient: async () => authorized }),
  });
  return { repository, sent, insert };
}

/** Every tenant id the expanded fence binds, whatever its parameter names. */
function tenantsBound(params: Record<string, unknown>): string[] {
  return Object.entries(params)
    .filter(([name]) => name.startsWith("tenantScope"))
    .flatMap(([, value]) => (Array.isArray(value) ? value : []))
    .filter((value): value is string => typeof value === "string");
}

describe("ClickHouseTraceEmbeddingRepository", () => {
  describe("upsert()", () => {
    it("writes one row per trace with its anchor, model, vector and retention", async () => {
      const { repository, insert } = repositoryAnswering([]);

      await repository.upsert({
        tenantId: "project-a",
        embeddingsModel: "text-embedding-3-small",
        retentionDays: 30,
        embeddings: [{ traceId: "trace-1", occurredAtMs: 1_000, vector: [64, 127] }],
      });

      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: "trace_embeddings",
          values: [
            {
              TenantId: "project-a",
              TraceId: "trace-1",
              OccurredAt: new Date(1_000),
              EmbeddingsModel: "text-embedding-3-small",
              Embedding: [64, 127],
              _retention_days: 30,
            },
          ],
        }),
      );
    });

    it("sends nothing for an empty page", async () => {
      const { repository, insert } = repositoryAnswering([]);

      await repository.upsert({
        tenantId: "project-a",
        embeddingsModel: "m",
        retentionDays: 30,
        embeddings: [],
      });

      expect(insert).not.toHaveBeenCalled();
    });
  });

  describe("findNearest()", () => {
    /** @scenario "The similar traces read sends only the proof's one project to ClickHouse" */
    it("ranks by cosineDistance inside the narrowed member's fence alone", async () => {
      const { repository, sent } = repositoryAnswering([
        { TraceId: "trace-2", OccurredAtMs: "1000", Distance: 0.25 },
      ]);
      const narrowed = narrowAuthorization({
        authorization: aggregateProof({
          projectId: "aggregate",
          members: [
            { projectId: "member-a", from: 0 },
            { projectId: "member-b", from: 0 },
          ],
        }),
        projectId: "member-a",
      });

      const nearest = await repository.findNearest({
        authorization: narrowed!,
        traceId: "trace-1",
        source: { embeddingsModel: "text-embedding-3-small", vector: [127, 0] },
        windowStartMs: 500,
        limit: 5,
      });

      expect(nearest).toEqual([{ traceId: "trace-2", occurredAtMs: 1000, distance: 0.25 }]);
      const [statement] = sent;
      expect(statement!.sql).toContain("cosineDistance(Embedding, {vector:Array(Int8)})");
      expect(statement!.sql).toContain("EmbeddingsModel = {embeddingsModel:String}");
      expect(statement!.sql).toContain("TraceId != {traceId:String}");
      expect(new Set(tenantsBound(statement!.params))).toEqual(new Set(["member-a"]));
      expect(statement!.params).toMatchObject({
        vector: [127, 0],
        embeddingsModel: "text-embedding-3-small",
        limit: 5,
        windowStartMs: 500,
      });
    });
  });

  describe("findSource()", () => {
    it("answers the latest vector and its model, or null when none is held", async () => {
      const found = repositoryAnswering([{ EmbeddingsModel: "m", Vector: [64] }]);
      const missing = repositoryAnswering([]);
      const authorization = ownProof({ projectId: "project-a" });

      const source = await found.repository.findSource({
        authorization,
        traceId: "trace-1",
        windowStartMs: 0,
      });
      const none = await missing.repository.findSource({
        authorization,
        traceId: "trace-1",
        windowStartMs: 0,
      });

      expect(source).toEqual({ embeddingsModel: "m", vector: [64] });
      expect(none).toBeNull();
      expect(new Set(tenantsBound(found.sent[0]!.params))).toEqual(new Set(["project-a"]));
    });
  });
});
