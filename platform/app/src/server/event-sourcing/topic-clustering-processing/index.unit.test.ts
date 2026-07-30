import type { ClickHouseClient } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import {
  topicClustering,
  topicClusteringCommandGroupKey,
  topicClusteringProcessGroupKey,
  topicClusteringProcessing,
} from "./index";

/** Never called: these tests exercise composition, not I/O. */
const client = {} as ClickHouseClient;

describe("topic-clustering-processing composition", () => {
  it("mounts the aggregate, three folds and the process manager without throwing", () => {
    const pipeline = topicClusteringProcessing({ client });

    expect(pipeline.aggregate.name).toBe("topic_clustering");
    expect(Object.keys(pipeline.folds).sort()).toEqual([
      "topicClusteringRunHistory",
      "topicClusteringRunStatus",
      "topicModel",
    ]);
    expect(pipeline.process.definition.name).toBe("topicClustering");
  });

  it("mounts every fold as an aggregate-scoped, batching replace store", () => {
    const pipeline = topicClusteringProcessing({ client });

    for (const fold of Object.values(pipeline.folds)) {
      expect(fold.mount).toEqual({
        projection: "fold",
        store: "replace",
        scope: "aggregate",
        collapse: "batch",
      });
    }
  });

  it("gives every lane of one project the same aggregate scope", () => {
    const pipeline = topicClusteringProcessing({ client });
    const scope = {
      kind: "aggregate",
      aggregateType: "topic_clustering",
      aggregateId: "project-1",
    };

    expect(
      pipeline.folds.topicClusteringRunStatus.groupKey({
        tenantId: "project-1",
      }),
    ).toEqual({
      tenantId: "project-1",
      lane: { kind: "fold", name: "topicClusteringRunStatus" },
      scope,
    });
    expect(topicClusteringCommandGroupKey({ tenantId: "project-1" })).toEqual({
      tenantId: "project-1",
      lane: { kind: "command" },
      scope,
    });
    expect(topicClusteringProcessGroupKey({ tenantId: "project-1" })).toEqual({
      tenantId: "project-1",
      lane: { kind: "processManager", name: "topicClustering" },
      scope,
    });
  });

  it("gives each fold its own state version, derived from its own schema", () => {
    const pipeline = topicClusteringProcessing({ client });
    const versions = Object.values(pipeline.folds).map(
      (fold) => fold.projection.version,
    );
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("subscribes every fold only to events the aggregate declares", () => {
    const pipeline = topicClusteringProcessing({ client });
    const declared = new Set<string>(topicClustering.eventTypes);

    for (const fold of Object.values(pipeline.folds)) {
      for (const eventType of fold.projection.eventTypes) {
        expect(declared.has(eventType)).toBe(true);
      }
    }
  });
});
