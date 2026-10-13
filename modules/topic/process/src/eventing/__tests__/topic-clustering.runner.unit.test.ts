import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { clusterTopicsForProject } from "../topic-clustering-runner.intent.ts";
import { fakeRunnerDeps, tracePage } from "./topic-clustering-runner.fixture.ts";

function depsReading(options: { assigned?: number; page: ReturnType<typeof tracePage> }) {
  const deps = fakeRunnerDeps();
  deps.traces.readTopicClusteringCounts.mockResolvedValue({
    totalTracesCount: 100,
    recentTracesCount: 100,
    assignedTracesCount: options.assigned ?? 0,
  });
  deps.traces.readTopicClusteringPage.mockResolvedValue(options.page);
  return deps;
}

describe("clusterTopicsForProject", () => {
  describe("when trace answers the counts and a page", () => {
    it("reads the counts and one page through trace", async () => {
      const deps = depsReading({ page: tracePage(0) });

      const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(deps.traces.readTopicClusteringCounts).toHaveBeenCalledWith({ projectId: "proj-1" });
      expect(deps.traces.readTopicClusteringPage).toHaveBeenCalledWith({
        projectId: "proj-1",
        isIncrementalProcessing: false,
        topicIds: [],
        subtopicIds: [],
      });
      expect(outcome.skippedReason).toBe("not_enough_traces");
      expect(outcome.nextSearchAfter).toBeUndefined();
    });

    it("returns the next-page cursor when a full page yields zero usable traces", async () => {
      // A full page of empty-input traces clusters nothing, but the cursor
      // must still advance or older eligible traces are stranded.
      const deps = depsReading({
        page: { traces: [], lastSort: [1_700_000_000_000, "trace-14"], returnedCount: 15 },
      });

      const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(outcome.skippedReason).toBe("not_enough_traces");
      expect(outcome.nextSearchAfter).toEqual([1_700_000_000_000, "trace-14"]);
    });

    it("sends the page's traces to clustering", async () => {
      const deps = depsReading({ page: tracePage(12) });

      await clusterTopicsForProject(deps, { projectId: "proj-1" });

      const body = deps.evaluations.requestTopicClustering.mock.calls[0]?.[0]?.params;
      expect(body?.traces).toHaveLength(12);
      expect(body?.traces[0]?.input).toBe("User message 0");
    });

    it("passes the cursor through to trace", async () => {
      const deps = depsReading({ page: tracePage(0) });
      const searchAfter: [number, string] = [1_700_000_000_000, "trace-xyz"];

      await clusterTopicsForProject(deps, { projectId: "proj-1", searchAfter });

      expect(deps.traces.readTopicClusteringPage).toHaveBeenCalledWith(
        expect.objectContaining({ searchAfter }),
      );
    });
  });

  describe("when trace cannot answer the counts", () => {
    it("fails the page with trace's error", async () => {
      const deps = fakeRunnerDeps();
      deps.traces.readTopicClusteringCounts.mockRejectedValue(new Error("trace unavailable"));

      await expect(clusterTopicsForProject(deps, { projectId: "proj-1" })).rejects.toThrow(
        "trace unavailable",
      );
    });
  });

  describe("when topics were just created by the run's previous page", () => {
    // The cadence gate throttles run STARTS only — a continuation page
    // (searchAfter present) must go through.
    const freshTopics = [{ id: "topic-1", parentId: null, createdAt: nowInstant() }];

    let deps: ReturnType<typeof fakeRunnerDeps>;

    beforeEach(() => {
      deps = depsReading({ page: tracePage(0) });
      deps.repository.findTopicIndexRows.mockResolvedValue(freshTopics);
    });

    it("skips a NEW run as recently clustered", async () => {
      const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(outcome.skippedReason).toBe("recently_clustered");
      expect(deps.traces.readTopicClusteringPage).not.toHaveBeenCalled();
    });

    it("lets a continuation page through instead of ending the walk", async () => {
      const outcome = await clusterTopicsForProject(deps, {
        projectId: "proj-1",
        searchAfter: [1_700_000_000_000, "trace-xyz"],
      });

      expect(outcome.skippedReason).not.toBe("recently_clustered");
      expect(deps.traces.readTopicClusteringPage).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the project carries enough assigned traces for incremental mode", () => {
    it("asks trace for the traces outside the known topics", async () => {
      const deps = depsReading({ assigned: 1200, page: tracePage(0) });
      deps.repository.findTopicIndexRows.mockResolvedValue([
        { id: "topic-1", parentId: null, createdAt: nowInstant() },
        { id: "sub-1", parentId: "topic-1", createdAt: nowInstant() },
      ]);

      await clusterTopicsForProject(deps, { projectId: "proj-1" });

      expect(deps.traces.readTopicClusteringPage).toHaveBeenCalledWith({
        projectId: "proj-1",
        isIncrementalProcessing: true,
        topicIds: ["topic-1"],
        subtopicIds: ["sub-1"],
      });
    });
  });
});
