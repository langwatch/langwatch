import {
  type AggregateEvent,
  checkOrderInvariance,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { topicClustering } from "../aggregate";
import type { TopicModelEntry, TopicsRecordedData } from "../schema";
import {
  applyTopicModelEvent,
  deriveTopicModelView,
  initTopicModelState,
} from "./topicModel";

function topic(
  id: string,
  overrides: Partial<TopicModelEntry> = {},
): TopicModelEntry {
  return {
    id,
    name: `topic-${id}`,
    parentId: null,
    embeddingsModel: "text-embedding-3-small",
    centroid: [0, 0],
    p95Distance: 0.5,
    automaticallyGenerated: true,
    ...overrides,
  };
}

// Built through `topicClustering.events.topicsRecorded` — see
// `runStatus.unit.test.ts`'s identical note for why this never hand-types a
// `topic_clustering/...` literal.
const recorded = (overrides: Partial<TopicsRecordedData> = {}) =>
  topicClustering.events.topicsRecorded({
    mode: "replace",
    source: "clustering",
    topics: [],
    occurredAt: 1_000,
    ...overrides,
  });

function topicIds(state: ReturnType<typeof initTopicModelState>): string[] {
  return deriveTopicModelView(state)
    .topics.map((t) => t.id)
    .sort();
}

describe("topicModel fold", () => {
  /** @scenario A batch clustering run replaces the topic model through the stream */
  it("replaces the model wholesale on a replace-mode event", () => {
    let state = initTopicModelState();
    state = applyTopicModelEvent(
      state,
      recorded({ topics: [topic("a"), topic("b")], occurredAt: 1_000 }),
    );
    state = applyTopicModelEvent(
      state,
      recorded({ topics: [topic("c")], occurredAt: 2_000 }),
    );
    expect(topicIds(state)).toEqual(["c"]);
  });

  /** @scenario An incremental clustering run extends the model */
  it("merge-mode upserts into the existing model without dropping other topics", () => {
    let state = initTopicModelState();
    state = applyTopicModelEvent(
      state,
      recorded({ topics: [topic("a"), topic("b")], occurredAt: 1_000 }),
    );
    state = applyTopicModelEvent(
      state,
      recorded({ mode: "merge", topics: [topic("c")], occurredAt: 2_000 }),
    );
    expect(topicIds(state)).toEqual(["a", "b", "c"]);
  });

  it("merge-mode updates an existing topic's fields, keeping its id", () => {
    let state = initTopicModelState();
    state = applyTopicModelEvent(
      state,
      recorded({
        topics: [topic("a", { name: "old-name" })],
        occurredAt: 1_000,
      }),
    );
    state = applyTopicModelEvent(
      state,
      recorded({
        mode: "merge",
        topics: [topic("a", { name: "new-name" })],
        occurredAt: 2_000,
      }),
    );
    expect(
      deriveTopicModelView(state).topics.find((t) => t.id === "a")?.name,
    ).toBe("new-name");
  });

  /** @scenario Recording the same run's topics twice changes nothing */
  it("recording the identical topics again is a no-op on the projected model", () => {
    let state = initTopicModelState();
    const event = recorded({
      topics: [topic("a"), topic("b")],
      occurredAt: 1_000,
    });
    state = applyTopicModelEvent(state, event);
    const once = deriveTopicModelView(state);
    state = applyTopicModelEvent(state, event);
    expect(deriveTopicModelView(state)).toEqual(once);
  });

  describe("firstRecordedAt", () => {
    it("takes an explicit firstRecordedAt over the event's own occurredAt", () => {
      const state = applyTopicModelEvent(
        initTopicModelState(),
        recorded({
          topics: [topic("a", { firstRecordedAt: 500 })],
          occurredAt: 1_000,
        }),
      );
      expect(deriveTopicModelView(state).topics[0]?.firstRecordedAt).toBe(500);
    });

    it("preserves an already-projected topic's firstRecordedAt across an update", () => {
      let state = initTopicModelState();
      state = applyTopicModelEvent(
        state,
        recorded({ topics: [topic("a")], occurredAt: 1_000 }),
      );
      state = applyTopicModelEvent(
        state,
        recorded({
          mode: "merge",
          topics: [topic("a", { name: "renamed" })],
          occurredAt: 5_000,
        }),
      );
      expect(deriveTopicModelView(state).topics[0]?.firstRecordedAt).toBe(
        1_000,
      );
    });

    it("falls back to the event's occurredAt for a genuinely new topic", () => {
      const state = applyTopicModelEvent(
        initTopicModelState(),
        recorded({ topics: [topic("a")], occurredAt: 1_000 }),
      );
      expect(deriveTopicModelView(state).topics[0]?.firstRecordedAt).toBe(
        1_000,
      );
    });
  });

  describe("given a stale replace arrives after a newer one (the watermark's job)", () => {
    /**
     * Reproduces, by hand, the worked example in `topicModel.ts`'s module
     * docblock: forward and reverse delivery order of the same two events
     * must converge on the identical model. Written out explicitly (not
     * only via `checkOrderInvariance` below) because this is the one place
     * in the pipeline where getting it wrong silently resurrects deleted
     * data, and a reader should be able to see the exact mechanism without
     * running a property test.
     */
    it("does not let a stale replace resurrect a topic a newer replace already dropped", () => {
      const t3ReplaceFirst = [
        recorded({ topics: [topic("a"), topic("d")], occurredAt: 3_000 }),
        recorded({ topics: [topic("a"), topic("b")], occurredAt: 1_000 }),
      ];
      const forward = t3ReplaceFirst.reduce(
        applyTopicModelEvent,
        initTopicModelState(),
      );
      const backward = [...t3ReplaceFirst]
        .reverse()
        .reduce(applyTopicModelEvent, initTopicModelState());

      expect(topicIds(forward)).toEqual(["a", "d"]);
      expect(topicIds(backward)).toEqual(["a", "d"]);
      expect(deriveTopicModelView(forward)).toEqual(
        deriveTopicModelView(backward),
      );
    });

    it("still lets a chronologically-later merge survive a chronologically-earlier replace, regardless of delivery order", () => {
      const events = [
        recorded({ mode: "merge", topics: [topic("x")], occurredAt: 4_000 }),
        recorded({ topics: [topic("a"), topic("d")], occurredAt: 3_000 }),
      ];
      const forward = events.reduce(
        applyTopicModelEvent,
        initTopicModelState(),
      );
      const backward = [...events]
        .reverse()
        .reduce(applyTopicModelEvent, initTopicModelState());

      expect(topicIds(forward)).toEqual(["a", "d", "x"]);
      expect(deriveTopicModelView(forward)).toEqual(
        deriveTopicModelView(backward),
      );
    });

    it("drops a merge that predates the last accepted replace, regardless of delivery order", () => {
      const events = [
        recorded({ topics: [topic("a"), topic("d")], occurredAt: 3_000 }),
        recorded({ mode: "merge", topics: [topic("x")], occurredAt: 1_000 }),
      ];
      const forward = events.reduce(
        applyTopicModelEvent,
        initTopicModelState(),
      );
      const backward = [...events]
        .reverse()
        .reduce(applyTopicModelEvent, initTopicModelState());

      expect(topicIds(forward)).toEqual(["a", "d"]);
      expect(deriveTopicModelView(forward)).toEqual(
        deriveTopicModelView(backward),
      );
    });
  });

  describe("the seed guard — documented exception (see module docblock)", () => {
    /** @scenario Existing topics are seeded into the stream on service start */
    it("applies a seed normally when the model is still empty", () => {
      const state = applyTopicModelEvent(
        initTopicModelState(),
        recorded({
          source: "seed",
          topics: [topic("legacy-1"), topic("legacy-2")],
          occurredAt: 1_000,
        }),
      );
      expect(topicIds(state)).toEqual(["legacy-1", "legacy-2"]);
    });

    /** @scenario A late duplicate seed can never remove recorded topics */
    it("no-ops a seed once the model has any topics, regardless of the seed's own occurredAt", () => {
      let state = initTopicModelState();
      state = applyTopicModelEvent(
        state,
        recorded({ topics: [topic("a")], occurredAt: 5_000 }),
      );
      state = applyTopicModelEvent(
        state,
        // A seed carrying a LATER occurredAt than the real clustering event —
        // still must not run, because the guard is content-gated, not
        // timestamp-ordered (see the module docblock).
        recorded({
          source: "seed",
          topics: [topic("legacy-1")],
          occurredAt: 9_000,
        }),
      );
      expect(topicIds(state)).toEqual(["a"]);
    });

    /**
     * The one pair of orderings where this guard genuinely is not
     * order-invariant, pinned deliberately (module docblock's "documented,
     * deliberate exception") rather than hidden. Not exercised through
     * `checkOrderInvariance` below for the same reason.
     */
    it("is content-gated, not timestamp-ordered — the one documented order-dependent case", () => {
      const seedAt9000 = recorded({
        source: "seed",
        topics: [topic("legacy")],
        occurredAt: 9_000,
      });
      const clusteringAt5000 = recorded({
        topics: [topic("a")],
        occurredAt: 5_000,
      });

      const seedFirst = [seedAt9000, clusteringAt5000].reduce(
        applyTopicModelEvent,
        initTopicModelState(),
      );
      const clusteringFirst = [clusteringAt5000, seedAt9000].reduce(
        applyTopicModelEvent,
        initTopicModelState(),
      );

      expect(topicIds(seedFirst)).not.toEqual(topicIds(clusteringFirst));
    });
  });

  describe("order invariance (ADR-098 decision 4) — excluding the documented seed exception", () => {
    /** @scenario A batch clustering run replaces the topic model through the stream */
    it("reaches the same model regardless of the order two replaces are delivered in", () => {
      const events: AggregateEvent[] = [
        recorded({ topics: [topic("a"), topic("b")], occurredAt: 1_000 }),
        recorded({ topics: [topic("a"), topic("d")], occurredAt: 3_000 }),
      ];
      const report = checkOrderInvariance({
        init: initTopicModelState,
        apply: applyTopicModelEvent,
        events,
      });
      expect(report.invariant).toBe(true);
    });

    /** @scenario An incremental clustering run extends the model */
    it("reaches the same model regardless of the order a replace and several merges are delivered in", () => {
      const events: AggregateEvent[] = [
        recorded({ topics: [topic("a")], occurredAt: 1_000 }),
        recorded({ mode: "merge", topics: [topic("b")], occurredAt: 2_000 }),
        recorded({ mode: "merge", topics: [topic("c")], occurredAt: 3_000 }),
        recorded({ topics: [topic("a"), topic("d")], occurredAt: 4_000 }),
      ];
      const report = checkOrderInvariance({
        init: initTopicModelState,
        apply: applyTopicModelEvent,
        events,
        maxPermutations: 24,
      });
      expect(report.invariant).toBe(true);
    });

    it("reaches the same model regardless of the order repeated merges to one topic are delivered in", () => {
      const events: AggregateEvent[] = [
        recorded({
          mode: "merge",
          topics: [topic("a", { name: "v1" })],
          occurredAt: 1_000,
        }),
        recorded({
          mode: "merge",
          topics: [topic("a", { name: "v2" })],
          occurredAt: 2_000,
        }),
        recorded({
          mode: "merge",
          topics: [topic("a", { name: "v3" })],
          occurredAt: 3_000,
        }),
      ];
      const report = checkOrderInvariance({
        init: initTopicModelState,
        apply: applyTopicModelEvent,
        events,
      });
      expect(report.invariant).toBe(true);
    });
  });
});
