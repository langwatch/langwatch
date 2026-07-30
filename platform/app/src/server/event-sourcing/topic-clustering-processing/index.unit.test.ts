import { describe, expect, it } from "vitest";
import * as pipeline from "./index";

/**
 * A smoke test over the barrel: every named export the module docblock
 * promises must actually resolve to something, and the aggregate + mounts
 * built from module-load-time composition must not throw.
 */
describe("topic-clustering-processing index", () => {
  it("exports the aggregate, built without throwing", () => {
    expect(pipeline.topicClustering.name).toBe("topic_clustering");
    expect(pipeline.topicClustering.eventTypes.length).toBe(5);
  });

  it("exports working fold init/apply pairs", () => {
    expect(pipeline.initRunStatusState()).toBeDefined();
    expect(pipeline.initRunHistoryState()).toBeDefined();
    expect(pipeline.initTopicModelState()).toBeDefined();
  });

  it("exports mounts that pass validation", () => {
    expect(() => pipeline.assertTopicClusteringMountsAreLegal()).not.toThrow();
  });

  it("exports group key builders that produce typed descriptors", () => {
    const key = pipeline.topicClusteringRunStatusGroupKey({
      tenantId: "project-1",
    });
    expect(key).toEqual({
      tenantId: "project-1",
      lane: { kind: "fold", name: "topicClusteringRunStatus" },
      scope: {
        kind: "aggregate",
        aggregateType: "topic_clustering",
        aggregateId: "project-1",
      },
    });
  });

  it("exports ClickHouse table declarations", () => {
    expect(pipeline.topicClusteringRunStatusTable.name).toBe(
      "topic_clustering_run_status",
    );
    expect(pipeline.topicClusteringRunHistoryTable.name).toBe(
      "topic_clustering_run_history",
    );
    expect(pipeline.topicModelTable.name).toBe("topic_clustering_topic_model");
  });

  it("exports the process manager definition, built without throwing", () => {
    expect(pipeline.topicClusteringProcessDefinition.name).toBe(
      "topicClustering",
    );
    expect(
      [...pipeline.topicClusteringProcessDefinition.eventTypes].sort(),
    ).toEqual(["requested", "runCompleted", "runFailed"]);
  });

  it("exports the idempotency-key helpers", () => {
    expect(
      pipeline.requestClusteringIdempotencyKey({
        trigger: "bootstrap",
        occurredAt: 1,
      }),
    ).toBe("topic_clustering:bootstrap");
  });

  it("exports runIdentity helpers", () => {
    expect(pipeline.mintManualRunId(1)).toBe("manual-1");
  });
});
