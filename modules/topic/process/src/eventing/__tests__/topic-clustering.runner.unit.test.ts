import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clusterTopicsForProject,
  fetchTracesFromClickHouse,
} from "../topic-clustering-runner.intent.ts";
import { fakeRunnerDeps } from "./topic-clustering-runner.fixture.ts";

describe("clusterTopicsForProject", () => {
  describe("when ClickHouse is available", () => {
    it("reads counts from CH and searches CH, no ES calls", async () => {
      const mockClickHouseQuery = vi.fn();
      const deps = fakeRunnerDeps({
        resolveClickHouseClient: vi.fn().mockResolvedValue({ query: mockClickHouseQuery }),
      });

      // CH count query (single query for all counts)
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ total: "5", recent: "5", assigned: "0" }]),
      });

      // CH search query returns fewer than minimumTraces (10 for batch)
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([]),
      });

      const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(mockClickHouseQuery).toHaveBeenCalledTimes(2); // counts + search
      expect(outcome.skippedReason).toBe("not_enough_traces");
      expect(outcome.nextSearchAfter).toBeUndefined();
    });

    it("returns the next-page cursor when a full page yields zero usable traces", async () => {
      // Regression: a full page of empty-input traces clusters nothing, but
      // the cursor must still advance or older eligible traces are stranded.
      // The fetch returns rows (so returnedCount > 10 and lastSort is set)
      // whose ComputedInput is empty (so no usable traces survive extraction).
      const mockClickHouseQuery = vi.fn();
      const deps = fakeRunnerDeps({
        resolveClickHouseClient: vi.fn().mockResolvedValue({ query: mockClickHouseQuery }),
      });

      // Counts
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ total: "100", recent: "100", assigned: "0" }]),
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

      const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(outcome.skippedReason).toBe("not_enough_traces");
      expect(outcome.nextSearchAfter).toEqual([now - 14 * 1000, "trace-14"]);
    });

    it("maps CH results to TopicClusteringTrace and calls clustering", async () => {
      const mockClickHouseQuery = vi.fn();
      const deps = fakeRunnerDeps({
        resolveClickHouseClient: vi.fn().mockResolvedValue({ query: mockClickHouseQuery }),
      });

      // Counts
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ total: "100", recent: "100", assigned: "0" }]),
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

      await clusterTopicsForProject(deps, { projectId: "proj-1" });

      // clustering service (langevals) was called
      expect(deps.evaluations.requestTopicClustering).toHaveBeenCalled();
    });
  });

  describe("when the ClickHouse resolver is unavailable for the project", () => {
    it("throws because ClickHouse is required", async () => {
      const deps = fakeRunnerDeps({
        resolveClickHouseClient: vi
          .fn()
          .mockRejectedValue(new Error("ClickHouse not available for tenant proj-1")),
      });

      await expect(clusterTopicsForProject(deps, { projectId: "proj-1" })).rejects.toThrow(
        "ClickHouse client not available for project proj-1",
      );
    });
  });

  describe("when topics were just created by the run's previous page", () => {
    // The cadence gate recomputed from topics page 1 just wrote would
    // otherwise throttle every batch backlog after one page. The gate
    // throttles run STARTS only — a continuation page (searchAfter
    // present) must go through.
    const freshTopics = [{ id: "topic-1", parentId: null, createdAt: nowInstant() }];

    let mockClickHouseQuery: ReturnType<typeof vi.fn>;
    let deps: ReturnType<typeof fakeRunnerDeps>;

    beforeEach(() => {
      mockClickHouseQuery = vi.fn();
      deps = fakeRunnerDeps({
        resolveClickHouseClient: vi.fn().mockResolvedValue({ query: mockClickHouseQuery }),
      });
      deps.repository.findTopicIndexRows.mockResolvedValue(freshTopics);
    });

    it("skips a NEW run as recently clustered", async () => {
      // Counts: topics exist but < 1200 assigned, so still batch mode.
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ total: "100", recent: "100", assigned: "0" }]),
      });

      const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(outcome.skippedReason).toBe("recently_clustered");
      expect(mockClickHouseQuery).toHaveBeenCalledTimes(1); // counts only
    });

    it("lets a continuation page through instead of ending the walk", async () => {
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ total: "100", recent: "100", assigned: "0" }]),
      });
      // The fetch runs (the gate did not fire) and returns nothing further.
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([]),
      });

      const outcome = await clusterTopicsForProject(deps, {
        projectId: "proj-1",
        searchAfter: [1700000000000, "trace-xyz"],
      });

      expect(outcome.skippedReason).not.toBe("recently_clustered");
      expect(mockClickHouseQuery).toHaveBeenCalledTimes(2); // counts + search
    });
  });

  describe("when CH search uses pagination (search_after)", () => {
    it("passes cursor params to CH query", async () => {
      const mockClickHouseQuery = vi.fn();
      const deps = fakeRunnerDeps({
        resolveClickHouseClient: vi.fn().mockResolvedValue({ query: mockClickHouseQuery }),
      });

      // Counts
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ total: "100", recent: "100", assigned: "0" }]),
      });

      // Search - empty result
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([]),
      });

      const searchAfter: [number, string] = [1700000000000, "trace-xyz"];
      await clusterTopicsForProject(deps, { projectId: "proj-1", searchAfter });

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
      const mockClickHouseQuery = vi.fn();
      const deps = fakeRunnerDeps({
        resolveClickHouseClient: vi.fn().mockResolvedValue({ query: mockClickHouseQuery }),
      });

      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ total: "100", recent: "100", assigned: "0" }]),
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

      await clusterTopicsForProject(deps, { projectId: "proj-1" });

      // Traces with empty/null input should be filtered, leaving 10
      const body = deps.evaluations.requestTopicClustering.mock.calls[0]?.[0]?.params;
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
            {
              TraceId: "t-0",
              ComputedInput: JSON.stringify("a"),
              TopicId: null,
              SubTopicId: null,
              OccurredAtMs: String(now),
            },
            {
              TraceId: "t-0",
              ComputedInput: JSON.stringify("a"),
              TopicId: null,
              SubTopicId: null,
              OccurredAtMs: String(now - 1),
            },
            {
              TraceId: "t-1",
              ComputedInput: JSON.stringify("b"),
              TopicId: null,
              SubTopicId: null,
              OccurredAtMs: String(now - 2),
            },
          ]),
      }),
    };

    const res = await fetchTracesFromClickHouse({
      clickhouse: mockCh,
      projectId: "proj-1",
      isIncrementalProcessing: false,
      topicIds: [],
      subtopicIds: [],
    });

    expect(res.returnedCount).toBe(2); // t-0 counted once + t-1
    expect(res.traces).toHaveLength(2);
    expect(res.traces.map((t) => t.trace_id)).toEqual(["t-0", "t-1"]);
    // Cursor lands on the last distinct trace, not the dropped duplicate.
    expect(res.lastSort).toEqual([now - 2, "t-1"]);
  });
});
