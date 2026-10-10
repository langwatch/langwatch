/**
 * Regression: a clustering call returning NOTHING used to wipe the project's
 * topic model (defaulted to empty arrays, then batch-mode delete-then-recreate
 * deleted every Topic row while still reporting the run completed).
 */
import { describe, expect, it, vi } from "vitest";

import { clusterTopicsForProject, storeResults } from "../topic-clustering-runner.intent.ts";
import { fakeRunnerDeps, tracePage } from "./topic-clustering-runner.fixture.ts";

describe("clusterTopicsForProject", () => {
  describe("given the clustering service endpoint is not configured", () => {
    describe("when a batch page of clusterable traces is run", () => {
      const depsWithUsablePage = () => {
        // The deployment shape that triggers the bug: no clustering endpoint.
        return fakeRunnerDeps({
          traces: {
            readTopicClusteringCounts: vi.fn().mockResolvedValue({
              totalTracesCount: 100,
              recentTracesCount: 100,
              assignedTracesCount: 0,
            }),
            readTopicClusteringPage: vi.fn().mockResolvedValue(tracePage(12)),
            assignTopic: vi.fn().mockResolvedValue(undefined),
          },
          evaluations: {
            requestTopicClustering: vi.fn().mockResolvedValue({ kind: "not_configured" }),
          },
        });
      };

      it("deletes no topics and records nothing", async () => {
        const deps = depsWithUsablePage();
        await clusterTopicsForProject(deps, { projectId: "proj-1" });

        expect(deps.commands.recordTopics).not.toHaveBeenCalled();
      });

      it("reports the run as skipped for missing configuration", async () => {
        const deps = depsWithUsablePage();
        const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

        expect(outcome.skippedReason).toBe("not_configured");
        // The run must not read as productive work: reporting traces
        // processed here is what made the wipe look like a completed run.
        expect(outcome.tracesProcessed).toBe(0);
        expect(outcome.topicsCount).toBe(0);
      });

      it("stops the page walk rather than paging into the same wall", async () => {
        const deps = depsWithUsablePage();
        const outcome = await clusterTopicsForProject(deps, { projectId: "proj-1" });

        expect(outcome.nextSearchAfter).toBeUndefined();
      });
    });
  });
});

describe("storeResults", () => {
  describe("given the clustering call returned an empty topic set", () => {
    describe("when storing in batch mode", () => {
      it("keeps the previous topics rather than replacing them with nothing", async () => {
        // An empty replacement would leave the project with no topics at
        // all, which is strictly worse than keeping the previous model.
        const deps = fakeRunnerDeps();
        await storeResults({
          deps,
          projectId: "proj-1",
          clusteringResult: { topics: [], subtopics: [], traces: [], cost: undefined } as never,
          isIncremental: false,
        });

        expect(deps.commands.recordTopics).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the clustering call returned topics", () => {
    describe("when storing in batch mode", () => {
      it("replaces the topic model as before", async () => {
        const deps = fakeRunnerDeps();
        await storeResults({
          deps,
          projectId: "proj-1",
          clusteringResult: {
            topics: [
              {
                id: "topic_a",
                name: "Greetings",
                centroid: [0.1, 0.2],
                p95_distance: 0.5,
              },
            ],
            subtopics: [],
            traces: [],
            cost: undefined,
          } as never,
          isIncremental: false,
        });

        expect(deps.commands.recordTopics).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "proj-1",
            mode: "replace",
            source: "clustering",
            topics: [expect.objectContaining({ id: "topic_a", name: "Greetings" })],
          }),
        );
      });

      it("awaits the write-path seed guard before recording the model", async () => {
        // Per-aggregate log order is the whole guarantee: the seed must fold
        // before this run's topics_recorded, or the replace can reconcile the
        // table down to just its own delta.
        const deps = fakeRunnerDeps();
        const order: string[] = [];
        deps.migration.seedProjectTopicModel.mockImplementation(async () => {
          order.push("seeded");
          return "skipped";
        });
        deps.commands.recordTopics.mockImplementation(async () => {
          order.push("recorded");
        });

        await storeResults({
          deps,
          projectId: "proj-1",
          clusteringResult: {
            topics: [
              {
                id: "topic_a",
                name: "Greetings",
                centroid: [0.1, 0.2],
                p95_distance: 0.5,
              },
            ],
            subtopics: [],
            traces: [],
            cost: undefined,
          } as never,
          isIncremental: false,
        });

        expect(deps.migration.seedProjectTopicModel).toHaveBeenCalledWith("proj-1");
        expect(order).toEqual(["seeded", "recorded"]);
      });
    });
  });
});
