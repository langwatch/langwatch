import { describe, expect, it, vi } from "vitest";

import type { HandleResult } from "~/server/event-sourcing/process-manager";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/constants";
import type { TopicClusteringProcessingEvent } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/events";

import {
  createTopicClusteringProcessSubscriber,
  type TopicClusteringProcessManagerPort,
} from "../topicClusteringProcessSubscriber";

const PROJECT_ID = "project-1";
const NOW = 1_700_000_000_000;

function makeEvent(): TopicClusteringProcessingEvent {
  return {
    id: "evt-requested-1",
    aggregateId: PROJECT_ID,
    aggregateType: "topic_clustering",
    tenantId: PROJECT_ID,
    createdAt: 1_000,
    occurredAt: 1_000,
    version: "2026-07-17",
    type: "lw.obs.topic_clustering.requested",
    data: { trigger: "manual" },
  } as TopicClusteringProcessingEvent;
}

const CONTEXT: EventSubscriberContext = {
  tenantId: PROJECT_ID,
  aggregateId: PROJECT_ID,
};

function harness(result: HandleResult) {
  const handleEvent = vi.fn<TopicClusteringProcessManagerPort["handleEvent"]>(
    async () => result,
  );
  const notifyOutbox = vi.fn();
  const subscriber = createTopicClusteringProcessSubscriber({
    processManager: { handleEvent },
    notifyOutbox,
    clock: () => NOW,
  });
  return { handleEvent, notifyOutbox, subscriber };
}

const COMMITTED: HandleResult = {
  outcome: "committed",
  revision: 3,
  insertedMessageKeys: ["run:run-1:page-1"],
  duplicateMessageKeys: [],
};

describe("createTopicClusteringProcessSubscriber()", () => {
  describe("given a committed topic clustering event", () => {
    describe("when the process manager returns a revision conflict", () => {
      it("throws so the queue redelivers the event", async () => {
        const { subscriber } = harness({
          outcome: "revisionConflict",
          actualRevision: 7,
        });

        await expect(subscriber.handle(makeEvent(), CONTEXT)).rejects.toThrow(
          /revision conflict/i,
        );
      });

      it("does not nudge the outbox for a transition that never committed", async () => {
        const { subscriber, notifyOutbox } = harness({
          outcome: "revisionConflict",
          actualRevision: 7,
        });

        await expect(subscriber.handle(makeEvent(), CONTEXT)).rejects.toThrow();

        expect(notifyOutbox).not.toHaveBeenCalled();
      });
    });

    describe("when the process manager commits the transition", () => {
      it("nudges the outbox dispatcher once", async () => {
        const { subscriber, notifyOutbox } = harness(COMMITTED);

        await subscriber.handle(makeEvent(), CONTEXT);

        expect(notifyOutbox).toHaveBeenCalledTimes(1);
      });

      it("hands the manager the process envelope and the clock instant", async () => {
        const { subscriber, handleEvent } = harness(COMMITTED);

        await subscriber.handle(makeEvent(), CONTEXT);

        expect(handleEvent).toHaveBeenCalledTimes(1);
        expect(handleEvent.mock.calls[0]![0]).toMatchObject({
          now: NOW,
          envelope: {
            eventId: "evt-requested-1",
            eventType: "lw.obs.topic_clustering.requested",
            projectId: PROJECT_ID,
            tenantId: PROJECT_ID,
            processKey: PROJECT_ID,
          },
        });
      });
    });

    describe("when the event was already consumed", () => {
      it("returns without nudging the outbox", async () => {
        const { subscriber, notifyOutbox } = harness({
          outcome: "duplicateEvent",
        });

        await expect(subscriber.handle(makeEvent(), CONTEXT)).resolves.toBeUndefined();

        expect(notifyOutbox).not.toHaveBeenCalled();
      });
    });
  });

  describe("given no outbox notifier is wired", () => {
    describe("when the process manager commits the transition", () => {
      it("completes without error", async () => {
        const subscriber = createTopicClusteringProcessSubscriber({
          processManager: { handleEvent: async () => COMMITTED },
          clock: () => NOW,
        });

        await expect(subscriber.handle(makeEvent(), CONTEXT)).resolves.toBeUndefined();
      });
    });
  });

  describe("given the subscriber registration", () => {
    it("subscribes to every topic clustering event type", () => {
      const { subscriber } = harness(COMMITTED);

      expect(subscriber.name).toBe("topicClusteringProcess");
      expect(subscriber.eventTypes).toEqual(
        TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES,
      );
    });
  });
});
