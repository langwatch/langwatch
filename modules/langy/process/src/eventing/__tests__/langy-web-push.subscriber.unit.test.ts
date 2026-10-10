/**
 * @vitest-environment node
 * Langy's notifications leave from the server: the events that become a push, who gets
 * it, and the words, link, tag and idempotency key notification receives.
 * Spec: specs/langy/langy-notifications.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "@langwatch/langy-contract";
import type { RequestWebPushDeliveryCommand } from "@langwatch/notification-contract";
import { describe, expect, it, vi } from "vitest";

import {
  LangyToolCallSucceededEventSchema,
  LangyUserWaitStartedEventSchema,
  type LangyConversationProcessingEvent,
} from "../langy-conversation-state.projection.ts";
import { createLangyWebPushSubscriber } from "../langy-web-push.subscriber.ts";
import {
  agentRespondedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  T0,
  USER_ID,
} from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

function harness({
  choice = "enabled",
  turnStartedAt = T0 - 90_000,
  title = "Weekly costs",
  owner = USER_ID,
}: {
  choice?: "enabled" | "declined" | null;
  turnStartedAt?: number | null;
  title?: string | null;
  owner?: string | null;
} = {}) {
  const requests: RequestWebPushDeliveryCommand[] = [];
  const getNotificationPreference = vi.fn(async ({ topic }: { id: string; topic: "langy" }) => ({
    topic,
    choice,
  }));
  const subscriber = createLangyWebPushSubscriber({
    conversations: { find: async () => ({ ownerUserId: owner, title }) },
    turnStartedAt: async () => turnStartedAt,
    users: { getNotificationPreference },
    projects: { findSummaryById: async () => ({ name: "ACME", slug: "acme-x1y2" }) },
    notifications: {
      requestWebPushDelivery: async (input) => {
        requests.push(input);
        return { queued: 1 };
      },
    },
  });
  return { subscriber, requests, getNotificationPreference };
}

function waitStarted(): LangyConversationProcessingEvent {
  return LangyUserWaitStartedEventSchema.parse({
    id: "evt_wait",
    aggregateId: CONVERSATION_ID,
    aggregateType: "langy_conversation",
    tenantId: PROJECT_ID,
    createdAt: T0,
    occurredAt: T0,
    type: LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.USER_WAIT_STARTED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: "turn-1",
      waitId: "wait-1",
      kind: "permission",
      expiresAt: T0 + 600_000,
    },
  });
}

function toolCall(toolName: string, input: unknown): LangyConversationProcessingEvent {
  return LangyToolCallSucceededEventSchema.parse({
    id: `evt_${toolName}`,
    aggregateId: CONVERSATION_ID,
    aggregateType: "langy_conversation",
    tenantId: PROJECT_ID,
    createdAt: T0,
    occurredAt: T0,
    type: LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.TOOL_CALL_SUCCEEDED,
    data: {
      conversationId: CONVERSATION_ID,
      turnId: "turn-1",
      toolCallId: "call-1",
      toolName,
      input,
    },
  });
}

const finished = (outcome: "completed" | "failed" = "completed") =>
  agentRespondedEvent({ id: "evt_done", occurredAt: T0, turnId: "turn-1", outcome });

describe("given a person who turned Langy notifications on", () => {
  describe("when a turn of a minute or more completes", () => {
    /** @scenario "A long turn finishing reaches the person through Web Push" */
    it("asks notification for one push to the owner, linked to the conversation", async () => {
      const { subscriber, requests } = harness();

      await subscriber.handle(finished(), context);

      expect(requests).toEqual([
        {
          userId: USER_ID,
          projectId: PROJECT_ID,
          idempotencyKey: "langy:evt_done",
          topic: `langy:${CONVERSATION_ID}`,
          urgency: "high",
          message: {
            title: "Langy finished",
            body: 'Done with "Weekly costs".',
            url: `/acme-x1y2?langyConversation=${CONVERSATION_ID}`,
            tag: `langy:${CONVERSATION_ID}`,
          },
        },
      ]);
    });
  });

  describe("when a short turn completes", () => {
    /** @scenario "A short turn sends nothing" */
    it("sends nothing", async () => {
      const { subscriber, requests } = harness({ turnStartedAt: T0 - 20_000 });

      await subscriber.handle(finished(), context);

      expect(requests).toEqual([]);
    });
  });

  describe("when a turn ends failed", () => {
    it("is not a candidate", () => {
      const { subscriber } = harness();

      expect(subscriber.options?.enqueue?.filter?.(finished("failed"))).toBe(false);
    });
  });

  describe("when a card starts waiting on the person", () => {
    /** @scenario "A card waiting on the person reaches them through Web Push" */
    it("pushes that Langy needs a decision", async () => {
      const { subscriber, requests } = harness();

      await subscriber.handle(waitStarted(), context);

      expect(requests[0]?.message).toMatchObject({
        title: "Langy needs a decision",
        body: 'Waiting on you in "Weekly costs".',
      });
    });
  });

  describe("when Langy calls the notify tool", () => {
    /** @scenario "Langy's notify tool reaches the person through Web Push" */
    it("pushes the tool's title and body", async () => {
      const { subscriber, requests } = harness();

      await subscriber.handle(
        toolCall("notify", { title: "Export ready", body: "3 files" }),
        context,
      );

      expect(requests[0]?.message).toMatchObject({ title: "Export ready", body: "3 files" });
    });

    it("ignores any other tool", () => {
      const { subscriber } = harness();

      expect(subscriber.options?.enqueue?.filter?.(toolCall("bash", {}))).toBe(false);
    });
  });
});

describe("given a person who declined or never answered", () => {
  /** @scenario "Nothing is pushed to a person who did not turn notifications on" */
  it.each(["declined", null] as const)("sends nothing when the answer is %s", async (choice) => {
    const { subscriber, requests, getNotificationPreference } = harness({ choice });

    await subscriber.handle(waitStarted(), context);

    expect(getNotificationPreference).toHaveBeenCalledWith({ id: USER_ID, topic: "langy" });
    expect(requests).toEqual([]);
  });
});
