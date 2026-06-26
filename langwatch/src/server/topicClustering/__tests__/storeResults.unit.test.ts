/**
 * Regression test for the prod incident where storeResults silently
 * dropped trace→topic assignments on SaaS.
 *
 * Original repro: storeResults ran a legacy ES dual-write BEFORE the
 * AssignTopic command queue. With ES unconfigured on SaaS, the throwing
 * proxy bubbled up and the queue never fired — trace_summaries.TopicId
 * stayed null forever, leaving "Top Topics" empty in the UI.
 *
 * Fix: deleted the ES dual-write entirely. The AssignTopic queue is now
 * the only path. This test pins that contract so a future re-add of an
 * ES write would have to deliberately update the test.
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

vi.mock("~/server/embeddings", () => ({
  getProjectEmbeddingsModel: vi.fn().mockResolvedValue({
    model: "text-embedding-3-small",
    modelProvider: { enabled: true },
  }),
}));

const assignTopicMock = vi.fn().mockResolvedValue(undefined);

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

vi.mock("~/server/topicClustering/topicClusteringQueue", () => ({
  scheduleTopicClusteringNextPage: vi.fn(),
}));

vi.mock("fetch-h2", () => ({ fetch: vi.fn() }));

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
});

describe("storeResults", () => {
  describe("when called with a clustering result", () => {
    /** @scenario "Trace assignments flow through the AssignTopic command queue" */
    it("emits AssignTopic commands for every assigned trace and does not touch Elasticsearch", async () => {
      // No mock of ~/server/elasticsearch is set up. If storeResults
      // accidentally re-grew an ES code path, the missing module would
      // surface as an import-time failure or a vi.fn() not configured —
      // either way the test fails. The absence is the assertion.
      await storeResults("project_regression", sampleClusteringResult, false);

      expect(assignTopicMock).toHaveBeenCalledTimes(2);
      expect(assignTopicMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project_regression",
          traceId: "trace_1",
          topicId: "topic_a",
          topicName: "Greetings",
        }),
      );
      expect(assignTopicMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project_regression",
          traceId: "trace_2",
          topicId: "topic_a",
          topicName: "Greetings",
        }),
      );
    });
  });
});
