import type { ClickHouseClient } from "@langwatch/clickhouse";
import { describe, expect, it, vi } from "vitest";
import {
  createTopicClusteringProcessingPipeline,
  topicClusteringCommandGroupKey,
  topicClusteringFoldGroupKey,
  topicClusteringProcessGroupKey,
} from "./index";

function fakeClient(
  overrides: Partial<ClickHouseClient> = {},
): ClickHouseClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    stream: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function baseDeps() {
  return {
    client: fakeClient(),
    ports: { runClusteringPage: vi.fn(async () => undefined) },
  };
}

describe("createTopicClusteringProcessingPipeline", () => {
  it("names itself 'topic_clustering' and derives the dotted event types already in event_log", () => {
    const built = createTopicClusteringProcessingPipeline(baseDeps());
    expect(built.name).toBe("topic_clustering");
    expect([...built.eventTypes].sort()).toEqual([
      "lw.obs.topic_clustering.requested",
      "lw.obs.topic_clustering.run_completed",
      "lw.obs.topic_clustering.run_failed",
      "lw.obs.topic_clustering.run_started",
      "lw.obs.topic_clustering.topics_recorded",
    ]);
  });

  it("mounts the three folds, five commands and the process manager", () => {
    const built = createTopicClusteringProcessingPipeline(baseDeps());
    expect(Object.keys(built.folds).sort()).toEqual([
      "topicClusteringRunHistory",
      "topicClusteringRunStatus",
      "topicModel",
    ]);
    expect(Object.keys(built.commands).sort()).toEqual([
      "recordClusteringRunCompleted",
      "recordClusteringRunFailed",
      "recordClusteringRunStarted",
      "recordTopics",
      "requestClustering",
    ]);
    expect(Object.keys(built.processManagers)).toEqual(["topicClustering"]);
  });

  it("pins each fold's stamp to its own deployed version rather than deriving one", () => {
    const built = createTopicClusteringProcessingPipeline(baseDeps());
    expect(built.folds.topicClusteringRunStatus!.stateVersion).toBe(
      "2026-07-17",
    );
    // topicClusteringRunHistory and topicModel shipped on the same deploy
    // (TOPIC_CLUSTERING_PROJECTION_VERSIONS), so their pins are equal on
    // purpose — the pin travels with the fold, not with schema-hash
    // uniqueness.
    expect(built.folds.topicClusteringRunHistory!.stateVersion).toBe(
      "2026-07-20",
    );
    expect(built.folds.topicModel!.stateVersion).toBe("2026-07-20");

    for (const fold of Object.values(built.folds)) {
      expect(fold.schemaHash).not.toBe(fold.stateVersion);
    }
  });

  it("mounts every fold as an aggregate-scoped, batching replace store", () => {
    const built = createTopicClusteringProcessingPipeline(baseDeps());
    for (const fold of Object.values(built.folds)) {
      expect(
        fold.eventTypes.every((type) => built.eventTypes.includes(type)),
      ).toBe(true);
    }
  });

  it("gives every lane of one project the same aggregate scope", () => {
    const scope = {
      kind: "aggregate",
      aggregateType: "topic_clustering",
      aggregateId: "project-1",
    } as const;

    expect(
      topicClusteringFoldGroupKey({
        tenantId: "project-1",
        projection: "topicClusteringRunStatus",
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

  describe("the requestClustering command", () => {
    it("stamps its emitted event with the derived persisted type", async () => {
      const built = createTopicClusteringProcessingPipeline(baseDeps());
      const input = {
        projectId: "project-1",
        trigger: "manual" as const,
        occurredAt: 1_700_000_000_000,
      };
      const events = await built.commands.requestClustering!.handle(input, {
        now: 1,
        tenantId: "project-1",
      });
      expect(events).toEqual([
        { type: "lw.obs.topic_clustering.requested", data: input },
      ]);
    });
  });

  describe("the topicClustering process manager", () => {
    it("delivers the run intent through the injected port", async () => {
      const runClusteringPage = vi.fn(async () => undefined);
      const built = createTopicClusteringProcessingPipeline({
        client: fakeClient(),
        ports: { runClusteringPage },
      });

      const payload = { runId: "run-1", page: 1, searchAfter: null };
      await built.processManagers.topicClustering!.intents.run!.deliver(
        payload,
        { now: 1, tenantId: "project-1" },
      );

      expect(runClusteringPage).toHaveBeenCalledWith(payload, {
        now: 1,
        tenantId: "project-1",
      });
    });

    it("evolves on the project's own events", () => {
      const built = createTopicClusteringProcessingPipeline(baseDeps());
      const step = built.processManagers.topicClustering!.evolve(
        built.processManagers.topicClustering!.init(),
        {
          type: "lw.obs.topic_clustering.requested",
          data: {
            projectId: "project-1",
            trigger: "manual",
            occurredAt: 1_700_000_000_000,
          },
        },
        {
          now: 1_700_000_000_000,
          tenantId: "project-1",
          processKey: "project-1",
        },
      );
      expect(step?.intents).toHaveLength(1);
    });
  });
});
