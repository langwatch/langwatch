/**
 * @vitest-environment node
 * Trace folds topic's model fact into its own topic names, so it keeps no topic peer.
 * Spec: modules/trace/specs/trace-topic-names.feature
 */
import { TOPIC_MODEL_RECORD_MODE, TOPIC_MODEL_RECORD_SOURCE } from "@langwatch/topic-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceTopicNamingService } from "../../services/trace-topic-naming.service.ts";
import { TRACE_TOPIC_NAMES_LANE } from "../trace-topic-names.pipeline.ts";
import { PROJECT, peerFoldsHarness, topicEntry } from "./trace-peer-folds.fixtures.ts";

const { REPLACE, MERGE } = TOPIC_MODEL_RECORD_MODE;
const { CLUSTERING, SEED } = TOPIC_MODEL_RECORD_SOURCE;

function names(ids: string[], projectId = PROJECT) {
  return (repository: ReturnType<typeof peerFoldsHarness>["topicNames"]) =>
    repository.findNamesByIds({ projectId, ids });
}

describe("given trace's topic name fold beside topic's model fact", () => {
  it("hosts one peer fold lane, named for replay", () => {
    const { topicHost } = peerFoldsHarness();
    expect(topicHost.globalProjections?.map((lane) => [lane.name, lane.peer?.kind])).toEqual([
      [TRACE_TOPIC_NAMES_LANE, "fold"],
    ]);
  });

  describe("when topic records a model with a topic and a subtopic", () => {
    /** @scenario "Trace folds the topics topic records and labels facets with their names" */
    it("names both topics by id for that project only", async () => {
      const { eventing, recordTopics, topicNames } = peerFoldsHarness();
      await recordTopics(
        "event-1",
        {
          mode: REPLACE,
          source: CLUSTERING,
          dedupeKey: "run:1:page-0",
          topics: [topicEntry("t1", "Billing"), topicEntry("t2", "Refunds", "t1")],
        },
        1_000,
      );

      await vi.waitFor(async () =>
        expect(await names(["t1", "t2"])(topicNames)).toEqual(
          new Map([
            ["t1", "Billing"],
            ["t2", "Refunds"],
          ]),
        ),
      );
      expect(await names(["t1"], "project-2")(topicNames)).toEqual(new Map());
      await eventing.close();
    });
  });

  describe("when topic records a replacing model that carries only one of two topics", () => {
    /** @scenario "A replace drops the topics it no longer carries" */
    it("no longer names the removed topic and still names the one that stayed", async () => {
      const { eventing, recordTopics, topicNames } = peerFoldsHarness();
      const two = [topicEntry("t1", "Billing"), topicEntry("t2", "Refunds")];
      await recordTopics(
        "event-1",
        { mode: REPLACE, source: CLUSTERING, dedupeKey: "a", topics: two },
        1_000,
      );
      await vi.waitFor(async () => expect((await names(["t1", "t2"])(topicNames)).size).toBe(2));

      await recordTopics(
        "event-2",
        {
          mode: REPLACE,
          source: CLUSTERING,
          dedupeKey: "b",
          topics: [topicEntry("t1", "Billing")],
        },
        2_000,
      );

      await vi.waitFor(async () =>
        expect(await names(["t1", "t2"])(topicNames)).toEqual(new Map([["t1", "Billing"]])),
      );
      await eventing.close();
    });
  });

  describe("when topic records a merging model that renames one of two topics", () => {
    /** @scenario "A merge renames a topic and keeps the others" */
    it("names the renamed topic by its new name and keeps the other", async () => {
      const { eventing, recordTopics, topicNames } = peerFoldsHarness();
      const two = [topicEntry("t1", "Billing"), topicEntry("t2", "Refunds")];
      await recordTopics(
        "event-1",
        { mode: REPLACE, source: CLUSTERING, dedupeKey: "a", topics: two },
        1_000,
      );
      await recordTopics(
        "event-2",
        { mode: MERGE, source: CLUSTERING, dedupeKey: "b", topics: [topicEntry("t2", "Returns")] },
        2_000,
      );

      await vi.waitFor(async () =>
        expect(await names(["t1", "t2"])(topicNames)).toEqual(
          new Map([
            ["t1", "Billing"],
            ["t2", "Returns"],
          ]),
        ),
      );
      await eventing.close();
    });
  });

  describe("when topic records a seed after topics exist", () => {
    /** @scenario "A seed after topics exist changes nothing" */
    it("names only the topic it already held", async () => {
      const { eventing, recordTopics, topicNames } = peerFoldsHarness();
      await recordTopics(
        "event-1",
        {
          mode: REPLACE,
          source: CLUSTERING,
          dedupeKey: "a",
          topics: [topicEntry("t1", "Billing")],
        },
        1_000,
      );
      await recordTopics(
        "event-2",
        { mode: REPLACE, source: SEED, dedupeKey: "seed:v1", topics: [topicEntry("t9", "Old")] },
        2_000,
      );
      await recordTopics(
        "event-3",
        { mode: MERGE, source: CLUSTERING, dedupeKey: "c", topics: [topicEntry("t3", "Tax")] },
        3_000,
      );

      await vi.waitFor(async () => expect((await names(["t3"])(topicNames)).size).toBe(1));
      expect(await names(["t1", "t9"])(topicNames)).toEqual(new Map([["t1", "Billing"]]));
      await eventing.close();
    });
  });

  describe("when the trace list asks for the names of topic ids trace does not hold", () => {
    /** @scenario "An unknown topic id has no label" */
    it("names no id, and the facet keeps the id as its label", async () => {
      const { topicNames } = peerFoldsHarness();
      const naming = TraceTopicNamingService.create({ topicNames });

      const result = await naming.enrichTopicNames(PROJECT, {
        values: [{ value: "t-unknown", count: 2 }],
        totalDistinct: 1,
      } as never);

      expect(result.values).toEqual([{ value: "t-unknown", count: 2 }]);
    });
  });
});
