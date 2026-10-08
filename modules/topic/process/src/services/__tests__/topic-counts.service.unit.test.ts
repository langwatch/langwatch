/**
 * Trace counts traces per topic id; topic names the buckets.
 * Spec: modules/topic/specs/topic-read-surface.feature.
 */
import type { Topic } from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { TopicCountsService } from "../topic-counts.service.ts";

const FILTER = { projectId: "project_1", startDate: 1, endDate: 2, filters: {} };

function topic(id: string, name: string, parentId: string | null = null): Topic {
  return { id, name, parentId } as Topic;
}

function serviceOver({ counts, topics }: { counts: unknown; topics: Topic[] }) {
  return TopicCountsService.create({
    traces: { readTopicCounts: async () => counts },
    topics: { getAll: async () => topics },
  });
}

describe("TopicCountsService", () => {
  describe("when trace counts topics and subtopics the project has", () => {
    /** @scenario "name the trace counts for the topic filter" */
    it("names each bucket and carries each subtopic's parent", async () => {
      const service = serviceOver({
        counts: {
          topicCounts: [{ key: "t1", count: 4 }],
          subtopicCounts: [{ key: "s1", count: 3 }],
        },
        topics: [topic("t1", "Billing"), topic("s1", "Refunds", "t1")],
      });

      await expect(service.getTopicCounts(FILTER)).resolves.toEqual({
        topicCounts: [{ id: "t1", name: "Billing", count: 4 }],
        subtopicCounts: [{ id: "s1", name: "Refunds", count: 3, parentId: "t1" }],
      });
    });
  });

  describe("when a counted topic is gone from the project", () => {
    /** @scenario "a counted topic the project no longer has is left out" */
    it("drops that bucket and keeps the named ones", async () => {
      const service = serviceOver({
        counts: {
          topicCounts: [
            { key: "gone", count: 9 },
            { key: "t1", count: 1 },
          ],
          subtopicCounts: [{ key: "gone-sub", count: 2 }],
        },
        topics: [topic("t1", "Billing")],
      });

      await expect(service.getTopicCounts(FILTER)).resolves.toEqual({
        topicCounts: [{ id: "t1", name: "Billing", count: 1 }],
        subtopicCounts: [],
      });
    });
  });

  describe("when trace answers a malformed count", () => {
    /** @scenario "a malformed count answer fails the read" */
    it("fails rather than answering empty counts", async () => {
      const service = serviceOver({ counts: { buckets: [] }, topics: [topic("t1", "Billing")] });

      await expect(service.getTopicCounts(FILTER)).rejects.toBeInstanceOf(ZodError);
    });
  });
});
