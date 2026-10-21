/**
 * @vitest-environment node
 * The trace embedding contract, run against every backend the package can reach
 * without a database: the memory twin. The ClickHouse statements are pinned in
 * clickhouse/__tests__. Spec: modules/trace/specs/similar-traces.feature
 */
import { describe, expect, it } from "vitest";

import { ownProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { MemoryTraceEmbeddingRepository } from "../memory/memory.trace-embedding.repository.ts";
import type { TraceEmbeddingRepository } from "../trace-embedding.repository.ts";

const NOW = 1_760_000_000_000;
const MODEL = "text-embedding-3-small";

const backends: readonly { name: string; create: () => TraceEmbeddingRepository }[] = [
  { name: "memory", create: () => MemoryTraceEmbeddingRepository.create() },
];

async function seeded(create: () => TraceEmbeddingRepository) {
  const repository = create();
  await repository.upsert({
    tenantId: "project-1",
    embeddingsModel: MODEL,
    retentionDays: 90,
    embeddings: [
      { traceId: "source", occurredAtMs: NOW, vector: [127, 0, 0] },
      { traceId: "near", occurredAtMs: NOW - 1000, vector: [127, 10, 0] },
      { traceId: "far", occurredAtMs: NOW - 2000, vector: [0, 127, 0] },
      { traceId: "old", occurredAtMs: NOW - 100_000, vector: [127, 0, 0] },
    ],
  });
  await repository.upsert({
    tenantId: "project-2",
    embeddingsModel: MODEL,
    retentionDays: 90,
    embeddings: [{ traceId: "elsewhere", occurredAtMs: NOW, vector: [127, 0, 0] }],
  });
  return repository;
}

describe.each(backends)("given the $name trace embedding repository", ({ create }) => {
  describe("when a trace is embedded again", () => {
    /** @scenario "Every trace embedding repository answers alike" */
    it("answers the later vector as the trace's own", async () => {
      const repository = await seeded(create);
      await repository.upsert({
        tenantId: "project-1",
        embeddingsModel: MODEL,
        retentionDays: 90,
        embeddings: [{ traceId: "source", occurredAtMs: NOW, vector: [0, 0, 127] }],
      });

      await expect(
        repository.findSource({
          authorization: ownProof({ projectId: "project-1", now: NOW }),
          traceId: "source",
          windowStartMs: NOW - 50_000,
        }),
      ).resolves.toEqual({ embeddingsModel: MODEL, vector: [0, 0, 127] });
    });
  });

  describe("when the nearest traces are read", () => {
    it("ranks the proof's project inside the window, nearest first, without the source", async () => {
      const repository = await seeded(create);
      const authorization = ownProof({ projectId: "project-1", now: NOW });

      const nearest = await repository.findNearest({
        authorization,
        traceId: "source",
        source: { embeddingsModel: MODEL, vector: [127, 0, 0] },
        windowStartMs: NOW - 50_000,
        limit: 10,
      });

      expect(nearest.map((trace) => trace.traceId)).toEqual(["near", "far"]);
      expect(nearest[0]?.distance).toBeCloseTo(1 - 127 / Math.hypot(127, 10), 9);
      expect(nearest[1]?.distance).toBeCloseTo(1, 9);
    });
  });

  describe("when the trace was never embedded in the window", () => {
    it("answers no source", async () => {
      const repository = await seeded(create);

      await expect(
        repository.findSource({
          authorization: ownProof({ projectId: "project-1", now: NOW }),
          traceId: "old",
          windowStartMs: NOW - 50_000,
        }),
      ).resolves.toBeNull();
    });
  });
});
