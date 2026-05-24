/**
 * Regression test for the prod incident where storeResults silently
 * dropped trace→topic assignments on SaaS.
 *
 * Repro: SaaS prod runs without Elasticsearch (ClickHouse-only).
 * esClient() returns a throwing proxy whose .bulk() throws
 * `Elasticsearch is not configured`. storeResults' legacy ES dual-write
 * sits BEFORE the AssignTopic command queue, so the throw bubbled up
 * and the event-sourcing path never fired. Topic rows landed in
 * Postgres, but trace_summaries.TopicId in ClickHouse stayed null
 * forever, leaving "Top Topics" empty in the UI.
 *
 * Fix: guard the ES bulk with isElasticsearchConfigured.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({
  prisma: {
    topic: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    cost: { create: vi.fn() },
  },
}));

vi.mock("~/server/elasticsearch", () => ({
  esClient: vi.fn(),
  isElasticsearchConfigured: vi.fn(),
  TRACE_INDEX: { alias: "search-traces-alias" },
  traceIndexId: vi.fn(({ traceId }: { traceId: string }) => traceId),
}));

vi.mock("~/server/embeddings", () => ({
  getProjectEmbeddingsModel: vi.fn().mockResolvedValue({
    model: "text-embedding-3-small",
    modelProvider: { enabled: true },
  }),
}));

const assignTopicMock = vi.fn().mockResolvedValue(undefined);
const esBulkMock = vi.fn();
const throwingEsClient = {
  bulk: () => {
    throw new Error(
      "Elasticsearch is not configured (called .bulk()). Set ELASTICSEARCH_NODE_URL or remove this code path.",
    );
  },
};

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    traces: { assignTopic: assignTopicMock },
  })),
}));

vi.mock("~/server/metrics", () => ({
  getPayloadSizeHistogram: vi.fn().mockReturnValue({ observe: vi.fn() }),
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/background/queues/topicClusteringQueue", () => ({
  scheduleTopicClusteringNextPage: vi.fn(),
}));

vi.mock("fetch-h2", () => ({ fetch: vi.fn() }));

import {
  esClient,
  isElasticsearchConfigured,
} from "~/server/elasticsearch";
import { storeResults } from "../topicClustering";

const sampleClusteringResult = {
  topics: [
    {
      id: "topic_a",
      name: "Greetings",
      centroid: [0.1, 0.2],
      p95_distance: 0.5,
    },
  ],
  subtopics: [],
  traces: [
    { trace_id: "trace_1", topic_id: "topic_a", subtopic_id: null },
    { trace_id: "trace_2", topic_id: "topic_a", subtopic_id: null },
  ],
  cost: { amount: 0, currency: "USD" as const },
};

beforeEach(() => {
  assignTopicMock.mockClear();
  esBulkMock.mockClear();
  vi.mocked(esClient).mockReset();
  vi.mocked(isElasticsearchConfigured).mockReset();
});

describe("storeResults", () => {
  describe("when Elasticsearch is not configured (SaaS prod)", () => {
    /** @scenario "Trace assignments survive when Elasticsearch is not configured" */
    it("skips the ES bulk write and still emits AssignTopic commands", async () => {
      vi.mocked(isElasticsearchConfigured).mockResolvedValue(false);
      vi.mocked(esClient).mockResolvedValue(throwingEsClient as any);

      await storeResults("project_regression", sampleClusteringResult, false);

      expect(esClient).not.toHaveBeenCalled();
      expect(assignTopicMock).toHaveBeenCalledTimes(2);
      expect(assignTopicMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project_regression",
          traceId: "trace_1",
          topicId: "topic_a",
          topicName: "Greetings",
        }),
      );
    });
  });

  describe("when Elasticsearch IS configured (self-hosted on ES)", () => {
    /** @scenario "Trace assignments dual-write to Elasticsearch when configured" */
    it("performs the ES bulk write AND emits AssignTopic commands", async () => {
      vi.mocked(isElasticsearchConfigured).mockResolvedValue(true);
      const workingEsClient = { bulk: esBulkMock.mockResolvedValue({}) };
      vi.mocked(esClient).mockResolvedValue(workingEsClient as any);

      await storeResults("project_dualwrite", sampleClusteringResult, false);

      expect(esBulkMock).toHaveBeenCalledTimes(1);
      expect(esBulkMock).toHaveBeenCalledWith(
        expect.objectContaining({
          index: "search-traces-alias",
          refresh: true,
        }),
      );
      expect(assignTopicMock).toHaveBeenCalledTimes(2);
    });
  });
});
