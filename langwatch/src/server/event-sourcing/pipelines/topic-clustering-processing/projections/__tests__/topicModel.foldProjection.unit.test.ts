import { describe, expect, it } from "vitest";

import type { StateProjectionStore } from "../../../../projections/stateProjection.types";
import type { TopicClusteringTopicsRecordedEvent } from "../../schemas/events";
import {
  type TopicModelData,
  TopicModelFoldProjection,
} from "../topicModel.foldProjection";

const stubStore = {
  load: async () => null,
  store: async () => undefined,
} as StateProjectionStore<TopicModelData>;

const projection = new TopicModelFoldProjection({ store: stubStore });

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Topic ${id}`,
    parentId: null,
    embeddingsModel: "text-embedding-3-small",
    centroid: [0.1, 0.2],
    p95Distance: 0.5,
    automaticallyGenerated: true,
    ...overrides,
  };
}

function recorded(params: {
  mode: "replace" | "merge";
  source?: "clustering" | "seed";
  topics: unknown[];
  occurredAt?: number;
}): TopicClusteringTopicsRecordedEvent {
  return {
    id: `evt-${params.occurredAt ?? 1_000}`,
    aggregateId: "project-1",
    aggregateType: "topic_clustering",
    tenantId: "project-1",
    createdAt: params.occurredAt ?? 1_000,
    occurredAt: params.occurredAt ?? 1_000,
    type: "lw.obs.topic_clustering.topics_recorded",
    version: "2026-07-20",
    data: {
      mode: params.mode,
      source: params.source ?? "clustering",
      dedupeKey: "run:r:page-1",
      topics: params.topics,
    },
  } as TopicClusteringTopicsRecordedEvent;
}

function initState(): TopicModelData {
  return { ...projection.init() };
}

describe("TopicModelFoldProjection", () => {
  describe("when a replace event is recorded", () => {
    it("the event's topics ARE the model, ids passed through unchanged", () => {
      let state = projection.handleTopicClusteringTopicsRecorded(
        recorded({ mode: "replace", topics: [entry("old-1")] }),
        initState(),
      );
      state = projection.handleTopicClusteringTopicsRecorded(
        recorded({
          mode: "replace",
          topics: [entry("new-1"), entry("new-2", { parentId: "new-1" })],
          occurredAt: 2_000,
        }),
        state,
      );
      expect(state.Topics.map((t) => t.id)).toEqual(["new-1", "new-2"]);
      expect(state.Topics[1]?.parentId).toBe("new-1");
    });
  });

  describe("when a merge event arrives", () => {
    it("upserts by id and keeps everything else", () => {
      let state = projection.handleTopicClusteringTopicsRecorded(
        recorded({ mode: "replace", topics: [entry("a"), entry("b")] }),
        initState(),
      );
      state = projection.handleTopicClusteringTopicsRecorded(
        recorded({
          mode: "merge",
          topics: [entry("b", { name: "Renamed" }), entry("c")],
          occurredAt: 2_000,
        }),
        state,
      );
      expect(state.Topics.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
      expect(state.Topics.find((t) => t.id === "b")?.name).toBe("Renamed");
    });
  });

  describe("when a duplicate seed folds after the model already has topics", () => {
    // Regression: nothing upstream enforces the `seed:v1` idempotency key
    // (no queue dedup on recordTopics; ClickHouse inserts cannot be unique),
    // so a boot seed racing the write-path seed during projection lag CAN
    // append a second replace-mode seed with a later occurredAt. Folding it
    // would delete the clustering delta recorded in between. A seed is only
    // meaningful as the model's first record — later ones must be no-ops.
    it("folds as a no-op instead of replacing away the clustering delta", () => {
      // Write-path seed: legacy topics onto the empty model.
      let state = projection.handleTopicClusteringTopicsRecorded(
        recorded({
          mode: "replace",
          source: "seed",
          topics: [entry("legacy-1")],
          occurredAt: 100,
        }),
        initState(),
      );
      // Clustering delta merges on top.
      state = projection.handleTopicClusteringTopicsRecorded(
        recorded({ mode: "merge", topics: [entry("delta-1")], occurredAt: 101 }),
        state,
      );
      // The racing boot seed, appended later, carries only the legacy rows.
      const after = projection.handleTopicClusteringTopicsRecorded(
        recorded({
          mode: "replace",
          source: "seed",
          topics: [entry("legacy-1")],
          occurredAt: 150,
        }),
        state,
      );
      expect(after).toBe(state);
      expect(after.Topics.map((t) => t.id).sort()).toEqual([
        "delta-1",
        "legacy-1",
      ]);
    });

    it("still applies a seed to a genuinely empty model", () => {
      const state = projection.handleTopicClusteringTopicsRecorded(
        recorded({
          mode: "replace",
          source: "seed",
          topics: [entry("legacy-1")],
          occurredAt: 100,
        }),
        initState(),
      );
      expect(state.Topics.map((t) => t.id)).toEqual(["legacy-1"]);
    });
  });

  describe("when a seed carries the topic's original age", () => {
    it("keeps firstRecordedAt from the event, not the fold instant", () => {
      const state = projection.handleTopicClusteringTopicsRecorded(
        recorded({
          mode: "replace",
          source: "seed",
          topics: [entry("a", { firstRecordedAt: 111 })],
          occurredAt: 9_999,
        }),
        initState(),
      );
      expect(state.Topics[0]?.firstRecordedAt).toBe(111);
    });

    it("an unseeded topic is dated from the event instant, and a merge never restamps it", () => {
      let state = projection.handleTopicClusteringTopicsRecorded(
        recorded({ mode: "replace", topics: [entry("a")], occurredAt: 1_000 }),
        initState(),
      );
      state = projection.handleTopicClusteringTopicsRecorded(
        recorded({ mode: "merge", topics: [entry("a")], occurredAt: 5_000 }),
        state,
      );
      expect(state.Topics[0]?.firstRecordedAt).toBe(1_000);
    });
  });
});
