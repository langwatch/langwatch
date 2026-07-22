import { describe, expect, it, vi } from "vitest";

import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "@langwatch/langy";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";

import { createLangyConversationUpdateBroadcastSubscriber } from "../langy-conversation-update-broadcast.subscriber";

const ACCEPTED_AT = 1_752_600_000_000;
const context: EventSubscriberContext = {
  tenantId: "ignored_context_project",
  aggregateId: "ignored_context_conversation",
};

function makeEvent(
  overrides: Partial<LangyConversationProcessingEvent> = {},
): LangyConversationProcessingEvent {
  return {
    id: "evt_b",
    aggregateId: "conv_1",
    aggregateType: "langy_conversation",
    tenantId: "project_1",
    createdAt: ACCEPTED_AT,
    occurredAt: ACCEPTED_AT - 10,
    type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.CONVERSATION_STARTED,
    data: { conversationId: "conv_1", userId: "user_1" },
    ...overrides,
  } as LangyConversationProcessingEvent;
}

function makeDeps(params?: {
  cursor?: { acceptedAt: number; eventId: string };
}) {
  return {
    conversations: {
      read: vi.fn().mockResolvedValue({
        cursor: params?.cursor ?? {
          acceptedAt: ACCEPTED_AT,
          eventId: "evt_b",
        },
        ownerUserId: "user_1",
        isShared: false,
        foldedState: { title: "must not leak", messageCount: 99 },
      }),
    },
    broadcast: {
      broadcastToTenant: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("Langy conversation update broadcast subscriber", () => {
  it("retries without publishing while the Postgres cursor is behind", async () => {
    const deps = makeDeps({
      cursor: { acceptedAt: ACCEPTED_AT, eventId: "evt_a" },
    });
    const subscriber = createLangyConversationUpdateBroadcastSubscriber(deps);

    await expect(subscriber.handle(makeEvent(), context)).rejects.toThrow(
      "langyConversation has not projected event evt_b yet",
    );
    expect(deps.broadcast.broadcastToTenant).not.toHaveBeenCalled();
  });

  it("publishes only an authorized invalidation after the cursor reaches the event", async () => {
    const deps = makeDeps();
    const subscriber = createLangyConversationUpdateBroadcastSubscriber(deps);

    await subscriber.handle(makeEvent(), context);

    expect(deps.conversations.read).toHaveBeenCalledWith({
      projectId: "project_1",
      conversationId: "conv_1",
    });
    const [projectId, rawPayload, eventName] =
      deps.broadcast.broadcastToTenant.mock.calls[0]!;
    expect(projectId).toBe("project_1");
    expect(eventName).toBe("langy_conversation_updated");
    expect(JSON.parse(rawPayload as string)).toEqual({
      event: "langy_conversation_updated",
      conversationId: "conv_1",
      // The projection's position (ADR-059): the one non-identity field the
      // signal may carry — inert, lets the client decide whether to fetch the
      // event tail. Still no conversation CONTENT on the tenant-wide channel.
      cursor: { acceptedAt: ACCEPTED_AT, eventId: "evt_b" },
      ownerUserId: "user_1",
      isShared: false,
    });
    expect(rawPayload).not.toContain("foldedState");
    expect(rawPayload).not.toContain("title");
    expect(rawPayload).not.toContain("messageCount");
  });

  it("scopes reads, deduplication, and publication from the committed event", async () => {
    const deps = makeDeps();
    const subscriber = createLangyConversationUpdateBroadcastSubscriber(deps);
    const event = makeEvent({
      tenantId: createTenantId("project_2"),
      aggregateId: "conv_2",
    });

    await subscriber.handle(event, context);

    expect(deps.conversations.read).toHaveBeenCalledWith({
      projectId: "project_2",
      conversationId: "conv_2",
    });
    expect(deps.broadcast.broadcastToTenant).toHaveBeenCalledWith(
      "project_2",
      expect.stringContaining('"conversationId":"conv_2"'),
      "langy_conversation_updated",
    );
    const deduplication = subscriber.options?.deduplication;
    expect(typeof deduplication).toBe("object");
    if (typeof deduplication === "object") {
      expect(deduplication.makeId(event)).toBe(
        "langy-conversation-update:project_2:conv_2",
      );
    }
  });
});
