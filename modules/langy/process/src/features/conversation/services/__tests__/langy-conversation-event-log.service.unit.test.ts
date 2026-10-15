/**
 * The conversation's event log as each role holds it: bound where the role folds the
 * conversation, an empty tail where it only sends.
 * @vitest-environment node
 * @see modules/langy/specs/langy-unattended-turn.feature
 */
import { createTenantId, type PriorEventsRead } from "@langwatch/eventing";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { langyConversationEventing } from "../../../../eventing/langy-conversation.pipeline.ts";
import { LangyConversationEventLogService } from "../langy-conversation-event-log.service.ts";

const QUERY = {
  aggregateId: "conv-1",
  context: { tenantId: createTenantId("project-1") },
  aggregateType: "langy_conversation",
  occurredAtFromMs: 0,
} as const;

const accepted = {
  id: "evt-1",
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  occurredAt: 100,
  createdAt: 110,
  data: { conversationId: "conv-1", turnId: "turn-1" },
};
const responded = {
  id: "evt-2",
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  occurredAt: 200,
  createdAt: 210,
  data: { conversationId: "conv-1", turnId: "turn-1", messageId: "msg-1", outcome: "completed" },
};
const foreign = { id: "evt-3", type: "lw.other.thing_happened", occurredAt: 300, createdAt: 310 };

/** A pipeline's own read over a fixed log, recording which aggregate it was asked for. */
function pipelineLog(stored: readonly unknown[]) {
  const asked: { tenantId: string; aggregateId: string }[] = [];
  const read: PriorEventsRead = async ({ tenantId, aggregateId, accepts }) => {
    asked.push({ tenantId, aggregateId });
    return stored.filter(accepts);
  };
  return { read, asked };
}

/** As much of the module's app as the declaration reaches when a process installs it. */
function installedApp() {
  const eventLog = LangyConversationEventLogService.create();
  const app = {
    connectConversationEventLog: (read: PriorEventsRead) => eventLog.connect(read),
    conversationPipeline: () => ({ name: "langy_conversation_processing" }),
  };
  return { eventLog, app };
}

describe("LangyConversationEventLogService", () => {
  describe("given a role that bound no event log", () => {
    it("answers an empty tail", async () => {
      const eventLog = LangyConversationEventLogService.create();

      await expect(eventLog.getEventsOccurredSince(QUERY)).resolves.toEqual([]);
    });
  });

  describe("given the pipeline's own read was bound", () => {
    it("reads the conversation's aggregate for its tenant", async () => {
      const log = pipelineLog([accepted, responded]);
      const eventLog = LangyConversationEventLogService.create();
      eventLog.connect(log.read);

      const events = await eventLog.getEventsOccurredSince(QUERY);

      expect(events.map((event) => event.id)).toEqual(["evt-1", "evt-2"]);
      expect(log.asked).toEqual([{ tenantId: "project-1", aggregateId: "conv-1" }]);
    });

    it("keeps the events at or after the lower bound", async () => {
      const eventLog = LangyConversationEventLogService.create();
      eventLog.connect(pipelineLog([accepted, responded]).read);

      const events = await eventLog.getEventsOccurredSince({ ...QUERY, occurredAtFromMs: 200 });

      expect(events.map((event) => event.id)).toEqual(["evt-2"]);
    });

    it("keeps only events the conversation aggregate declared", async () => {
      const eventLog = LangyConversationEventLogService.create();
      eventLog.connect(pipelineLog([accepted, foreign, null, "text"]).read);

      const events = await eventLog.getEventsOccurredSince(QUERY);

      expect(events.map((event) => event.id)).toEqual(["evt-1"]);
    });
  });
});

describe("langy_conversation_processing, installed by a process", () => {
  describe("when the process folds the conversation", () => {
    /** @scenario "A wait in the process that folds the conversation reads its own event log" */
    it("binds the pipeline's own read, so the turn's answer is read from the log", async () => {
      const { eventLog, app } = installedApp();
      const log = pipelineLog([accepted, responded]);

      langyConversationEventing.build({
        app: app as never,
        participation: "consume",
        priorEvents: log.read,
        repositories: {} as never,
        processStore: {} as never,
      });

      const events = await eventLog.getEventsOccurredSince(QUERY);
      expect(events.map((event) => event.type)).toContain(
        LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      );
    });
  });

  describe("when the process only sends commands", () => {
    /** @scenario "A process that only sends reads an empty tail and never asks its event store" */
    it("binds no read, so the tail is empty and the log is never asked", async () => {
      const { eventLog, app } = installedApp();
      const log = pipelineLog([accepted, responded]);

      langyConversationEventing.build({
        app: app as never,
        participation: "produce",
        priorEvents: log.read,
        repositories: {} as never,
        processStore: {} as never,
      });

      await expect(eventLog.getEventsOccurredSince(QUERY)).resolves.toEqual([]);
      expect(log.asked).toEqual([]);
    });
  });
});
