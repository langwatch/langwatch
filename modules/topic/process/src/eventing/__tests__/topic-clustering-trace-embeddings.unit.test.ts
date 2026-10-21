import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { clusterTopicsForProject } from "../topic-clustering-runner.intent.ts";
import { fakeRunnerDeps, tracePage } from "./topic-clustering-runner.fixture.ts";

const NOW = 1_760_000_000_000;

function encoded(vector: readonly number[]): string {
  return Buffer.from(new Int8Array(vector).buffer).toString("base64");
}

function depsClustering(options: {
  trace_embeddings?: { trace_id: string; embedding: string }[];
  incremental?: boolean;
}) {
  const deps = fakeRunnerDeps();
  deps.traces.readTopicClusteringCounts.mockResolvedValue({
    totalTracesCount: 2000,
    recentTracesCount: 2000,
    assignedTracesCount: options.incremental ? 1500 : 0,
  });
  deps.traces.readTopicClusteringPage.mockResolvedValue(tracePage(12, NOW));
  if (options.incremental) {
    deps.repository.findTopicIndexRows.mockResolvedValue([
      { id: "topic_1", parentId: null, createdAt: Temporal.Instant.fromEpochMilliseconds(NOW) },
    ]);
  }
  deps.evaluations.requestTopicClustering.mockResolvedValue({
    kind: "clustered",
    response: {
      topics: [],
      subtopics: [],
      traces: [],
      cost: null,
      ...(options.trace_embeddings ? { trace_embeddings: options.trace_embeddings } : {}),
    },
  });
  return deps;
}

describe("clusterTopicsForProject", () => {
  describe("when a page is clustered", () => {
    it("asks langevals to hand back the embeddings in batch mode", async () => {
      const deps = depsClustering({});

      await clusterTopicsForProject(deps, { projectId: "proj-1" });

      const [call] = deps.evaluations.requestTopicClustering.mock.calls[0]!;
      expect(call.mode).toBe("batch");
      expect(call.params.return_trace_embeddings).toBe(true);
    });

    it("asks langevals to hand back the embeddings in incremental mode", async () => {
      const deps = depsClustering({ incremental: true });

      await clusterTopicsForProject(deps, { projectId: "proj-1" });

      const [call] = deps.evaluations.requestTopicClustering.mock.calls[0]!;
      expect(call.mode).toBe("incremental");
      expect(call.params.return_trace_embeddings).toBe(true);
    });

    /** @scenario "Topic clustering keeps the embeddings it already computed" */
    it("hands trace each embedding with its model and the trace's own time", async () => {
      const deps = depsClustering({
        trace_embeddings: [
          { trace_id: "trace-0", embedding: encoded([64, -32]) },
          { trace_id: "trace-3", embedding: encoded([1, 2]) },
        ],
      });

      await clusterTopicsForProject(deps, { projectId: "proj-1" });

      const [call] = deps.evaluations.requestTopicClustering.mock.calls[0]!;
      expect(call.params.return_trace_embeddings).toBe(true);
      expect(call.params.max_response_bytes).toBe(5 * 1024 * 1024);
      expect(deps.traces.recordTraceEmbeddings).toHaveBeenCalledWith({
        tenantId: "proj-1",
        embeddingsModel: "text-embedding-3-small",
        embeddings: [
          { traceId: "trace-0", occurredAtMs: NOW, vector: [64, -32] },
          { traceId: "trace-3", occurredAtMs: NOW - 3000, vector: [1, 2] },
        ],
      });
    });

    it("leaves out an embedding for a trace the page did not read", async () => {
      const deps = depsClustering({
        trace_embeddings: [
          { trace_id: "trace-1", embedding: encoded([1]) },
          { trace_id: "someone-else", embedding: encoded([2]) },
        ],
      });

      await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(deps.traces.recordTraceEmbeddings).toHaveBeenCalledWith(
        expect.objectContaining({
          embeddings: [{ traceId: "trace-1", occurredAtMs: NOW - 1000, vector: [1] }],
        }),
      );
    });

    /** @scenario "An older langevals that returns no embeddings changes nothing" */
    it("writes nothing to trace when langevals sends no embeddings", async () => {
      const deps = depsClustering({});

      const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(deps.traces.recordTraceEmbeddings).not.toHaveBeenCalled();
      expect(outcome.tracesProcessed).toBe(12);
    });

    /** @scenario "Failing to keep embeddings never fails the clustering page" */
    it("finishes the page when trace refuses the embeddings", async () => {
      const deps = depsClustering({
        trace_embeddings: [{ trace_id: "trace-0", embedding: encoded([1]) }],
      });
      deps.traces.recordTraceEmbeddings.mockRejectedValue(new Error("clickhouse down"));

      const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(outcome.tracesProcessed).toBe(12);
      expect(outcome.skippedReason).toBeUndefined();
      expect(deps.evaluations.requestTopicClustering).toHaveBeenCalledTimes(1);
    });
  });
});
