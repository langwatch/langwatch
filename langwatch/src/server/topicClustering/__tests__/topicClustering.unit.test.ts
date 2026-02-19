import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEsClient = {
  count: vi.fn(),
  search: vi.fn(),
  bulk: vi.fn(),
};
const mockClickHouseQuery = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    topic: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    cost: { create: vi.fn() },
  },
}));

vi.mock("~/server/elasticsearch", () => ({
  esClient: vi.fn().mockResolvedValue({
    count: (...args: unknown[]) => mockEsClient.count(...args),
    search: (...args: unknown[]) => mockEsClient.search(...args),
    bulk: (...args: unknown[]) => mockEsClient.bulk(...args),
  }),
  TRACE_INDEX: { alias: "search-traces-alias" },
  traceIndexId: vi.fn(({ traceId }: { traceId: string }) => traceId),
}));

vi.mock("~/server/clickhouse/client", () => ({
  getClickHouseClient: vi.fn(),
}));

vi.mock("../../env.mjs", () => ({
  env: { TOPIC_CLUSTERING_SERVICE: "http://localhost:1234" },
}));

vi.mock("~/server/license-enforcement/license-enforcement.repository", () => ({
  createCostChecker: () => ({
    maxMonthlyUsageLimit: vi.fn().mockResolvedValue(Infinity),
    getCurrentMonthCost: vi.fn().mockResolvedValue(0),
  }),
}));

vi.mock("~/server/background/queues/topicClusteringQueue", () => ({
  scheduleTopicClusteringNextPage: vi.fn(),
}));

vi.mock("~/server/embeddings", () => ({
  getProjectEmbeddingsModel: vi.fn().mockResolvedValue({
    model: "text-embedding-3-small",
    modelProvider: { enabled: true },
  }),
}));

vi.mock("~/server/api/routers/modelProviders", () => ({
  getProjectModelProviders: vi.fn().mockResolvedValue({
    openai: { enabled: true },
  }),
  prepareLitellmParams: vi.fn().mockResolvedValue({ model: "gpt-4" }),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn().mockReturnValue({
    traces: { assignTopic: vi.fn().mockResolvedValue(undefined) },
  }),
}));

vi.mock("~/server/metrics", () => ({
  getPayloadSizeHistogram: vi.fn().mockReturnValue({ observe: vi.fn() }),
}));

vi.mock("fetch-h2", () => ({
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        topics: [],
        subtopics: [],
        traces: [],
        cost: null,
      }),
  }),
}));

import { prisma } from "~/server/db";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { clusterTopicsForProject } from "../topicClustering";

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    topicClusteringModel: "openai/gpt-4",
    featureClickHouseDataSourceTraces: false,
    featureEventSourcingTraceIngestion: false,
    team: { organizationId: "org-1" },
    ...overrides,
  };
}

describe("clusterTopicsForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.topic.findMany).mockResolvedValue([]);
  });

  describe("when CH flag is off", () => {
    it("reads counts from ES, does not call CH", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject() as any,
      );
      vi.mocked(getClickHouseClient).mockReturnValue(null);

      // 4 count queries return low counts
      mockEsClient.count.mockResolvedValue({ count: 0 });
      mockEsClient.search.mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
      });

      await clusterTopicsForProject("proj-1", undefined, false);

      expect(mockEsClient.count).toHaveBeenCalledTimes(4);
      expect(mockClickHouseQuery).not.toHaveBeenCalled();
    });
  });

  describe("when CH flag is on", () => {
    it("reads counts from CH and searches CH, no ES calls", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject({ featureClickHouseDataSourceTraces: true }) as any,
      );
      vi.mocked(getClickHouseClient).mockReturnValue({
        query: mockClickHouseQuery,
      } as any);

      // CH count query (single query for all 4 counts)
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "5", withInput: "3", recent: "5", assigned: "0" },
          ]),
      });

      // CH search query returns fewer than minimumTraces (10 for batch)
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([]),
      });

      await clusterTopicsForProject("proj-1", undefined, false);

      expect(mockClickHouseQuery).toHaveBeenCalledTimes(2); // counts + search
      expect(mockEsClient.count).not.toHaveBeenCalled();
      expect(mockEsClient.search).not.toHaveBeenCalled();
    });

    it("maps CH results to TopicClusteringTrace and calls clustering", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject({ featureClickHouseDataSourceTraces: true }) as any,
      );
      vi.mocked(getClickHouseClient).mockReturnValue({
        query: mockClickHouseQuery,
      } as any);

      // Counts
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "100", withInput: "80", recent: "100", assigned: "0" },
          ]),
      });

      // CH search returns 12 traces (above the 10 minimum for batch)
      const chRows = Array.from({ length: 12 }, (_, i) => ({
        TraceId: `trace-${i}`,
        ComputedInput: JSON.stringify(`Hello world ${i}`),
        TopicId: null,
        SubTopicId: null,
        OccurredAtMs: String(Date.now() - i * 1000),
      }));
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve(chRows),
      });

      await clusterTopicsForProject("proj-1", undefined, false);

      // Should not have called ES at all
      expect(mockEsClient.search).not.toHaveBeenCalled();
      expect(mockEsClient.count).not.toHaveBeenCalled();
      // clustering service was called (via mocked fetch-h2)
      const { fetch } = await import("fetch-h2");
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe("when CH flag is on but getClickHouseClient returns null", () => {
    it("falls back to ES", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject({ featureClickHouseDataSourceTraces: true }) as any,
      );
      vi.mocked(getClickHouseClient).mockReturnValue(null);

      mockEsClient.count.mockResolvedValue({ count: 0 });
      mockEsClient.search.mockResolvedValue({
        hits: { total: { value: 0 }, hits: [] },
      });

      await clusterTopicsForProject("proj-1", undefined, false);

      expect(mockEsClient.count).toHaveBeenCalledTimes(4);
    });
  });

  describe("when CH search uses pagination (search_after)", () => {
    it("passes cursor params to CH query", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject({ featureClickHouseDataSourceTraces: true }) as any,
      );
      vi.mocked(getClickHouseClient).mockReturnValue({
        query: mockClickHouseQuery,
      } as any);

      // Counts
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "100", withInput: "80", recent: "100", assigned: "0" },
          ]),
      });

      // Search - empty result
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([]),
      });

      const searchAfter: [number, string] = [1700000000000, "trace-xyz"];
      await clusterTopicsForProject("proj-1", searchAfter, false);

      // Verify the search query included cursor params
      const searchCall = mockClickHouseQuery.mock.calls[1]!;
      expect(searchCall[0].query_params).toEqual(
        expect.objectContaining({
          lastTs: 1700000000000,
          lastTraceId: "trace-xyz",
        }),
      );
    });
  });

  describe("when CH search returns ComputedInput", () => {
    it("extracts input text from JSON-stringified ComputedInput", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject({ featureClickHouseDataSourceTraces: true }) as any,
      );
      vi.mocked(getClickHouseClient).mockReturnValue({
        query: mockClickHouseQuery,
      } as any);

      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "100", withInput: "80", recent: "100", assigned: "0" },
          ]),
      });

      // Return traces with various ComputedInput formats
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            // Simple JSON string
            ...Array.from({ length: 10 }, (_, i) => ({
              TraceId: `trace-${i}`,
              ComputedInput: JSON.stringify(`User message ${i}`),
              TopicId: null,
              SubTopicId: null,
              OccurredAtMs: String(Date.now() - i * 1000),
            })),
            // Null/empty should be filtered out
            {
              TraceId: "trace-empty",
              ComputedInput: "",
              TopicId: null,
              SubTopicId: null,
              OccurredAtMs: String(Date.now()),
            },
            {
              TraceId: "trace-null",
              ComputedInput: null,
              TopicId: null,
              SubTopicId: null,
              OccurredAtMs: String(Date.now()),
            },
          ]),
      });

      await clusterTopicsForProject("proj-1", undefined, false);

      // Traces with empty/null input should be filtered, leaving 10
      const { fetch } = await import("fetch-h2");
      const fetchCall = vi.mocked(fetch as any).mock.calls[0];
      const body = fetchCall?.[1]?.json;
      expect(body?.traces).toHaveLength(10);
      expect(body?.traces[0].input).toBe("User message 0");
    });
  });
});
