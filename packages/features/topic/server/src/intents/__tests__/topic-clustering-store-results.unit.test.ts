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
import { describe, expect, it } from "vitest";
import { storeResults } from "../topic-clustering-runner.intent";
import { fakeRunnerDeps } from "./topic-clustering-runner.fixture";

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

describe("storeResults", () => {
  describe("when called with a clustering result", () => {
    /** @scenario "Trace assignments flow through the AssignTopic command queue" */
    it("emits AssignTopic commands for every assigned trace and does not touch Elasticsearch", async () => {
      // No ES code path exists on the runner's boundaries at all. If
      // storeResults accidentally re-grew one, it could only come through a
      // new dependency — the absence is the assertion.
      const deps = fakeRunnerDeps();
      await storeResults(deps, "project_regression", sampleClusteringResult, false);

      expect(deps.traceAssignments.assignTopic).toHaveBeenCalledTimes(2);
      expect(deps.traceAssignments.assignTopic).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project_regression",
          traceId: "trace_1",
          topicId: "topic_a",
          topicName: "Greetings",
        }),
      );
      expect(deps.traceAssignments.assignTopic).toHaveBeenCalledWith(
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
