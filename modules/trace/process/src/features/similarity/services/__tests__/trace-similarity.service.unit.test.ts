/**
 * Keeping clustering's embeddings and reading the nearest traces.
 * @see modules/trace/specs/similar-traces.feature
 */
import { TRACE_EMBEDDING_DIMENSIONS, TraceNotFoundError } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { MemoryTraceEmbeddingRepository } from "../../repositories/memory/memory.trace-embedding.repository.ts";
import { TraceSimilarityService } from "../trace-similarity.service.ts";

const NOW = 1_760_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MODEL = "text-embedding-3-small";

/** A full-width int8 vector along `axis`, tilted by `tilt` towards the next axis. */
function vector({ axis, tilt = 0 }: { axis: number; tilt?: number }): number[] {
  const values = Array.from({ length: TRACE_EMBEDDING_DIMENSIONS }, () => 0);
  values[axis] = 127;
  values[axis + 1] = tilt;
  return values;
}

function setup() {
  const repository = MemoryTraceEmbeddingRepository.create();
  const getRetentionDays = vi.fn(async () => 90);
  const service = TraceSimilarityService.create({
    repository,
    dataRetention: { getRetentionDays },
    now: () => NOW,
  });
  return { repository, service, getRetentionDays };
}

async function seed(
  service: TraceSimilarityService,
  tenantId: string,
  embeddings: { traceId: string; vector: number[]; occurredAtMs?: number }[],
  embeddingsModel = MODEL,
) {
  await service.record({
    tenantId,
    embeddingsModel,
    embeddings: embeddings.map((embedding) => ({
      occurredAtMs: NOW - DAY_MS,
      ...embedding,
    })),
  });
}

describe("TraceSimilarityService", () => {
  describe("record()", () => {
    /** @scenario "A kept embedding carries the project's trace retention" */
    it("writes each embedding with the project's trace retention", async () => {
      const { repository, service, getRetentionDays } = setup();

      await seed(service, "project-a", [{ traceId: "trace-1", vector: vector({ axis: 0 }) }]);

      expect(getRetentionDays).toHaveBeenCalledWith({ projectId: "project-a", category: "traces" });
      expect(repository.rows).toMatchObject([
        {
          tenantId: "project-a",
          traceId: "trace-1",
          embeddingsModel: MODEL,
          retentionDays: 90,
          occurredAtMs: NOW - DAY_MS,
        },
      ]);
    });

    /** @scenario "An embedding that is not 1536 int8 components is not kept" */
    it("drops a vector of the wrong width, one outside int8 and an all-zero one", async () => {
      const { repository, service } = setup();
      const nonFinite = vector({ axis: 0 });
      nonFinite[3] = Number.NaN;
      const fractional = vector({ axis: 0 });
      fractional[4] = 0.5;
      const tooLarge = vector({ axis: 0 });
      tooLarge[5] = 128;

      await seed(service, "project-a", [
        { traceId: "short", vector: [1, 2, 3] },
        { traceId: "nan", vector: nonFinite },
        { traceId: "fractional", vector: fractional },
        { traceId: "too-large", vector: tooLarge },
        { traceId: "zero", vector: Array.from({ length: TRACE_EMBEDDING_DIMENSIONS }, () => 0) },
        { traceId: "good", vector: vector({ axis: 0 }) },
      ]);

      expect(repository.rows.map((row) => row.traceId)).toEqual(["good"]);
    });

    it("asks no retention and writes nothing when no embedding is storable", async () => {
      const { repository, service, getRetentionDays } = setup();

      await seed(service, "project-a", [{ traceId: "short", vector: [1] }]);

      expect(getRetentionDays).not.toHaveBeenCalled();
      expect(repository.rows).toEqual([]);
    });
  });

  describe("findSimilar()", () => {
    /** @scenario "Similar traces are the nearest by cosine distance, nearest first" */
    it("answers the project's other traces nearest first, up to the limit", async () => {
      const { service } = setup();
      await seed(service, "project-a", [
        { traceId: "asked", vector: vector({ axis: 0 }) },
        { traceId: "near", vector: vector({ axis: 0, tilt: 20 }) },
        { traceId: "nearer", vector: vector({ axis: 0, tilt: 2 }) },
        { traceId: "far", vector: vector({ axis: 5 }) },
      ]);

      const result = await service.findSimilar({
        projectId: "project-a",
        traceId: "asked",
        limit: 2,
        authorization: ownProof({ projectId: "project-a" }),
      });

      expect(result.status).toBe("ready");
      expect(result.embeddingsModel).toBe(MODEL);
      expect(result.traces.map((trace) => trace.traceId)).toEqual(["nearer", "near"]);
      expect(result.traces[0]!.distance).toBeLessThan(result.traces[1]!.distance);
    });

    /** @scenario "Similar traces never come from another project" */
    it("reads only the member that holds the trace, even under an aggregate's proof", async () => {
      const { service } = setup();
      await seed(service, "member-a", [
        { traceId: "asked", vector: vector({ axis: 0 }) },
        { traceId: "same-project", vector: vector({ axis: 0, tilt: 60 }) },
      ]);
      await seed(service, "member-b", [{ traceId: "twin", vector: vector({ axis: 0 }) }]);
      const authorization = aggregateProof({
        projectId: "aggregate",
        members: [
          { projectId: "member-a", from: 0 },
          { projectId: "member-b", from: 0 },
        ],
      });

      const result = await service.findSimilar({
        projectId: "aggregate",
        tenantId: "member-a",
        traceId: "asked",
        limit: 10,
        authorization,
      });

      expect(result.traces.map((trace) => trace.traceId)).toEqual(["same-project"]);
    });

    /** @scenario "Similar traces never come from another project" */
    it("answers not found for a member the proof does not read", async () => {
      const { service } = setup();

      await expect(
        service.findSimilar({
          projectId: "project-a",
          tenantId: "someone-elses-project",
          traceId: "asked",
          limit: 10,
          authorization: ownProof({ projectId: "project-a" }),
        }),
      ).rejects.toBeInstanceOf(TraceNotFoundError);
    });

    /** @scenario "A trace clustering never embedded answers not embedded" */
    it("answers not embedded for a trace without an embedding in the window", async () => {
      const { service } = setup();
      await seed(service, "project-a", [
        { traceId: "old", vector: vector({ axis: 0 }), occurredAtMs: NOW - 60 * DAY_MS },
        { traceId: "other", vector: vector({ axis: 0 }) },
      ]);

      const missing = await service.findSimilar({
        projectId: "project-a",
        traceId: "never-clustered",
        limit: 10,
        authorization: ownProof({ projectId: "project-a" }),
      });
      const outOfWindow = await service.findSimilar({
        projectId: "project-a",
        traceId: "old",
        limit: 10,
        authorization: ownProof({ projectId: "project-a" }),
      });

      expect(missing).toEqual({ status: "not_embedded", embeddingsModel: null, traces: [] });
      expect(outOfWindow).toEqual({ status: "not_embedded", embeddingsModel: null, traces: [] });
    });

    /** @scenario "Embeddings from a different model are never compared" */
    it("ranks only traces embedded by the asked trace's model", async () => {
      const { service } = setup();
      await seed(service, "project-a", [
        { traceId: "asked", vector: vector({ axis: 0 }) },
        { traceId: "same-model", vector: vector({ axis: 7 }) },
      ]);
      await seed(
        service,
        "project-a",
        [{ traceId: "other-model", vector: vector({ axis: 0 }) }],
        "other-embedding-model",
      );

      const result = await service.findSimilar({
        projectId: "project-a",
        traceId: "asked",
        limit: 10,
        authorization: ownProof({ projectId: "project-a" }),
      });

      expect(result.traces.map((trace) => trace.traceId)).toEqual(["same-model"]);
    });
  });
});
