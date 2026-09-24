import { LangevalsClusteringError } from "@langwatch/evaluation-contract";
import type { BatchClusteringParams, IncrementalClusteringParams } from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";

import { MemoryLangevalsChannel } from "../../channels/memory/memory.langevals.channel.ts";
import { LangevalsClusteringService } from "../langevals-clustering.service.ts";

const ENDPOINT = "https://langevals.example";

const BATCH: BatchClusteringParams = {
  project_id: "project-1",
  litellm_params: { model: "openai/gpt-5-mini" },
  embeddings_litellm_params: { model: "openai/text-embedding-3-small" },
  traces: [{ trace_id: "trace-1", input: "hello", topic_id: null, subtopic_id: null }],
};

const INCREMENTAL: IncrementalClusteringParams = { ...BATCH, topics: [], subtopics: [] };

const CLUSTERED = {
  topics: [{ id: "topic-1", name: "Greetings", centroid: [0.1, 0.2], p95_distance: 0.3 }],
  subtopics: [],
  traces: [{ trace_id: "trace-1", topic_id: "topic-1", subtopic_id: null }],
  cost: { amount: 0.01, currency: "USD" },
};

function setup(endpoint: string | undefined) {
  const langevals = MemoryLangevalsChannel.create();
  return { langevals, service: LangevalsClusteringService.create({ endpoint, langevals }) };
}

describe("LangevalsClusteringService", () => {
  describe("given no langevals endpoint", () => {
    /** @scenario "Topic clustering sends nothing when the deployment names no langevals endpoint" */
    it("answers not configured without posting", async () => {
      const { langevals, service } = setup(undefined);

      const outcome = await service.request({
        projectId: "project-1",
        signal: new AbortController().signal,
        mode: "batch",
        params: BATCH,
      });

      expect(outcome).toEqual({ kind: "not_configured" });
      expect(langevals.posts).toHaveLength(0);
    });
  });

  describe("given a langevals endpoint", () => {
    /** @scenario "Topic clustering posts a batch to langevals and returns its checked answer" */
    it("posts the params to the batch route and returns the parsed answer", async () => {
      const { langevals, service } = setup(ENDPOINT);
      langevals.answerWith(Response.json(CLUSTERED));
      const signal = new AbortController().signal;

      const outcome = await service.request({
        projectId: "project-1",
        signal,
        mode: "batch",
        params: BATCH,
      });

      expect(outcome).toEqual({ kind: "clustered", response: CLUSTERED });
      expect(langevals.posts).toEqual([
        {
          url: `${ENDPOINT}/topics/batch_clustering`,
          body: BATCH,
          projectId: "project-1",
          kind: "topic_clustering_batch",
          signal,
        },
      ]);
    });

    /** @scenario "A langevals clustering failure is refused with its status and body" */
    it("refuses a non-2xx answer naming the mode, status text and body", async () => {
      const { langevals, service } = setup(ENDPOINT);
      langevals.answerWith(
        Response.json({ detail: "boom" }, { status: 500, statusText: "Internal Server Error" }),
      );

      const refusal = service.request({
        projectId: "project-1",
        signal: new AbortController().signal,
        mode: "incremental",
        params: INCREMENTAL,
      });

      await expect(refusal).rejects.toBeInstanceOf(LangevalsClusteringError);
      await expect(refusal).rejects.toThrow(
        'Failed to fetch topics incremental clustering (langevals): Internal Server Error\n\n{\n  "detail": "boom"\n}',
      );
      expect(langevals.posts[0]?.url).toBe(`${ENDPOINT}/topics/incremental_clustering`);
    });

    /** @scenario "A clustering call aborted by its caller does not reach langevals" */
    it("rejects with the caller's abort and posts nothing", async () => {
      const { langevals, service } = setup(ENDPOINT);
      const controller = new AbortController();
      controller.abort();

      await expect(
        service.request({
          projectId: "project-1",
          signal: controller.signal,
          mode: "batch",
          params: BATCH,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(langevals.posts).toHaveLength(0);
    });
  });
});
