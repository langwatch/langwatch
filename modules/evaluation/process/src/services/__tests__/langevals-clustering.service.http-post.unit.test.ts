import type { BatchClusteringParams } from "@langwatch/topic-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpLangevalsChannel } from "../../channels/http/http.langevals.channel.ts";
import { STAGED_PAYLOAD_HEADER } from "../../channels/langevals.channel.ts";
import { LangevalsClusteringService } from "../langevals-clustering.service.ts";

const ENDPOINT = "https://langevals.example";

const PAGE: BatchClusteringParams = {
  project_id: "project-1",
  litellm_params: { model: "openai/gpt-5-mini" },
  embeddings_litellm_params: { model: "openai/text-embedding-3-small" },
  traces: [{ trace_id: "trace-1", input: "hello", topic_id: null, subtopic_id: null }],
};

const CLUSTERED = { topics: [], subtopics: [], traces: [], cost: { amount: 0, currency: "USD" } };

const posts: { url: string; init: RequestInit | undefined }[] = [];

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, init });
      return Response.json(CLUSTERED);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LangevalsClusteringService over the live langevals channel", () => {
  describe("given the deployment named an evaluator service endpoint", () => {
    /** @scenario "The clustering page posts its body directly" */
    it("posts the page body to that endpoint as JSON, with nothing parked behind a staging header", async () => {
      const service = LangevalsClusteringService.create({
        endpoint: ENDPOINT,
        langevals: HttpLangevalsChannel.create({
          config: {
            stagingThresholdBytes: undefined,
            stagingTtlSeconds: 600,
            evaluationMaxPayloadBytes: 50_000,
            topicClusteringMaxPayloadBytes: 500_000,
          },
          staging: {
            stage: async () => {
              throw new Error("a page that is posted directly is never parked");
            },
          },
        }),
      });

      await service.request({
        projectId: "project-1",
        signal: new AbortController().signal,
        mode: "batch",
        params: PAGE,
      });

      expect(posts).toHaveLength(1);
      const [post] = posts;
      expect(post?.url).toBe(`${ENDPOINT}/topics/batch_clustering`);
      expect(post?.init?.method).toBe("POST");
      const headers = new Headers(post?.init?.headers);
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get(STAGED_PAYLOAD_HEADER)).toBeNull();
      expect(post?.init?.body).toEqual(Buffer.from(JSON.stringify(PAGE)));
    });
  });
});
