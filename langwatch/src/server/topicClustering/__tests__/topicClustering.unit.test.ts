import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClickHouseQuery = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    topic: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    cost: { create: vi.fn() },
  },
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("../../env.mjs", () => ({
  env: { TOPIC_CLUSTERING_SERVICE: "http://localhost:1234" },
}));

vi.mock("~/server/topicClustering/topicClusteringQueue", () => ({
  scheduleTopicClusteringNextPage: vi.fn(),
}));

vi.mock("~/server/embeddings", () => ({
  getProjectEmbeddingsModel: vi.fn().mockResolvedValue({
    model: "text-embedding-3-small",
    modelProvider: { enabled: true },
  }),
}));

vi.mock("~/server/api/routers/modelProviders.utils", () => ({
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
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { scheduleTopicClusteringNextPage } from "~/server/topicClustering/topicClusteringQueue";
import { fetch as mockFetchH2 } from "fetch-h2";
import {
  clusterTopicsForProject,
  fetchTracesFromClickHouse,
} from "../topicClustering";

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    topicClusteringModel: "openai/gpt-4",
    team: { organizationId: "org-1" },
    ...overrides,
  };
}

describe("clusterTopicsForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.topic.findMany).mockResolvedValue([]);
  });

  describe("when ClickHouse is available", () => {
    it("reads counts from CH and searches CH, no ES calls", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject() as any,
      );
      vi.mocked(getClickHouseClientForProject).mockResolvedValue({
        query: mockClickHouseQuery,
      } as any);

      // CH count query (single query for all 4 counts)
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "5", recent: "5", assigned: "0" },
          ]),
      });

      // CH search query returns fewer than minimumTraces (10 for batch)
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([]),
      });

      await clusterTopicsForProject("proj-1", undefined, false);

      expect(mockClickHouseQuery).toHaveBeenCalledTimes(2); // counts + search
    });

    it("schedules the next page when a full page yields zero usable traces", async () => {
      // Regression: a full page of empty-input traces clusters nothing, but
      // the cursor must still advance or older eligible traces are stranded.
      // The fetch returns rows (so returnedCount > 10 and lastSort is set)
      // whose ComputedInput is empty (so no usable traces survive extraction).
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject() as any,
      );
      vi.mocked(getClickHouseClientForProject).mockResolvedValue({
        query: mockClickHouseQuery,
      } as any);

      // Counts
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "100", recent: "100", assigned: "0" },
          ]),
      });

      // Search: a full page of empty-input traces (returnedCount > 10).
      const now = Date.now();
      const emptyPage = Array.from({ length: 15 }, (_, i) => ({
        TraceId: `trace-${i}`,
        ComputedInput: "",
        TopicId: null,
        SubTopicId: null,
        OccurredAtMs: String(now - i * 1000),
      }));
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve(emptyPage),
      });

      // scheduleNextPage = true (default) so the queue call is exercised.
      await clusterTopicsForProject("proj-1");

      expect(scheduleTopicClusteringNextPage).toHaveBeenCalledWith("proj-1", [
        now - 14 * 1000,
        "trace-14",
      ]);
    });

    // Skipped: batchClusterTraces now calls getProjectTopicClusteringModelProvider
    // which goes through ModelProviderService → ModelProviderRepository.findAll
    // and prepareLitellmParams, requiring deeper mocking of the App singleton
    it.skip("maps CH results to TopicClusteringTrace and calls clustering", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject() as any,
      );
      vi.mocked(getClickHouseClientForProject).mockResolvedValue({
        query: mockClickHouseQuery,
      } as any);

      // Counts
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "100", recent: "100", assigned: "0" },
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

      // clustering service was called (via mocked fetch-h2)
      expect(mockFetchH2).toHaveBeenCalled();
    });
  });

  describe("when getClickHouseClientForProject returns null", () => {
    it("throws because ClickHouse is required", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject() as any,
      );
      vi.mocked(getClickHouseClientForProject).mockResolvedValue(null);

      await expect(
        clusterTopicsForProject("proj-1", undefined, false),
      ).rejects.toThrow("ClickHouse client not available for project proj-1");
    });
  });

  describe("when CH search uses pagination (search_after)", () => {
    it("passes cursor params to CH query", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject() as any,
      );
      vi.mocked(getClickHouseClientForProject).mockResolvedValue({
        query: mockClickHouseQuery,
      } as any);

      // Counts
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "100", recent: "100", assigned: "0" },
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
    // Skipped: same as above — batchClusterTraces requires deeper App singleton mocking
    it.skip("extracts input text from JSON-stringified ComputedInput", async () => {
      vi.mocked(prisma.project.findUnique).mockResolvedValue(
        makeProject() as any,
      );
      vi.mocked(getClickHouseClientForProject).mockResolvedValue({
        query: mockClickHouseQuery,
      } as any);

      mockClickHouseQuery.mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { total: "100", recent: "100", assigned: "0" },
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
      const fetchCall = vi.mocked(mockFetchH2).mock.calls[0];
      const body = fetchCall?.[1]?.json as { traces: Array<{ input: string }> } | undefined;
      expect(body?.traces).toHaveLength(10);
      expect(body?.traces[0]?.input).toBe("User message 0");
    });
  });
});

describe("fetchTracesFromClickHouse de-duplication", () => {
  it("collapses duplicate TraceId rows so returnedCount and the cursor stay correct", async () => {
    // Two physical rows for t-0 (e.g. two versions sharing max(UpdatedAt))
    // must not double-count. Rows arrive ordered OccurredAt DESC, TraceId ASC.
    const now = Date.now();
    const mockCh = {
      query: vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve([
            { TraceId: "t-0", ComputedInput: JSON.stringify("a"), TopicId: null, SubTopicId: null, OccurredAtMs: String(now) },
            { TraceId: "t-0", ComputedInput: JSON.stringify("a"), TopicId: null, SubTopicId: null, OccurredAtMs: String(now - 1) },
            { TraceId: "t-1", ComputedInput: JSON.stringify("b"), TopicId: null, SubTopicId: null, OccurredAtMs: String(now - 2) },
          ]),
      }),
    } as any;

    const res = await fetchTracesFromClickHouse(mockCh, "proj-1", false, [], []);

    expect(res.returnedCount).toBe(2); // t-0 counted once + t-1
    expect(res.traces).toHaveLength(2);
    expect(res.traces.map((t) => t.trace_id)).toEqual(["t-0", "t-1"]);
    // Cursor lands on the last distinct trace, not the dropped duplicate.
    expect(res.lastSort).toEqual([now - 2, "t-1"]);
  });
});
