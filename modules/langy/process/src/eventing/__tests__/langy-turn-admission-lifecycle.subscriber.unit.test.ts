import { createTenantId, type EventSubscriberContext } from "@langwatch/eventing";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
} from "@langwatch/langy-contract";
import { createLangyTurnAdmissionLifecycleSubscriber } from "@langwatch/langy-process";
import { describe, expect, it, vi } from "vitest";

import type { LangyConversationProcessingEvent } from "../langy-conversation-state.projection.ts";

const context: EventSubscriberContext = {
  tenantId: "ignored-project",
  aggregateId: "ignored-conversation",
};

type EventBody<E = LangyConversationProcessingEvent> = E extends LangyConversationProcessingEvent
  ? Pick<E, "type" | "version" | "data">
  : never;

function event(body: EventBody): LangyConversationProcessingEvent {
  return {
    id: `event-${body.type}`,
    aggregateId: "conversation-1",
    aggregateType: "langy_conversation",
    tenantId: createTenantId("project-1"),
    createdAt: 1_000,
    occurredAt: 1_000,
    ...body,
  };
}

function makeDeps() {
  return {
    admissions: {
      confirmAccepted: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("Langy turn admission lifecycle subscriber", () => {
  it("promotes the exact turn from its canonical acceptance event", async () => {
    const deps = makeDeps();
    const subscriber = createLangyTurnAdmissionLifecycleSubscriber(deps);

    await subscriber.handle(
      event({
        type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
        version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
        data: { conversationId: "conversation-1", turnId: "turn-1", questionParts: [] },
      }),
      context,
    );

    expect(deps.admissions.confirmAccepted).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
    });
    expect(deps.admissions.release).not.toHaveBeenCalled();
  });

  it("fences terminal release with the event's turn id", async () => {
    const deps = makeDeps();
    const subscriber = createLangyTurnAdmissionLifecycleSubscriber(deps);

    await subscriber.handle(
      event({
        type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
        version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_RESPONDED,
        data: {
          conversationId: "conversation-1",
          turnId: "turn-old",
          messageId: "message-1",
          role: "assistant",
          parts: [],
          outcome: "completed",
        },
      }),
      context,
    );

    expect(deps.admissions.release).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      turnId: "turn-old",
    });
  });

  it("releases an archived conversation even though archive has no turn id", async () => {
    const deps = makeDeps();
    const subscriber = createLangyTurnAdmissionLifecycleSubscriber(deps);

    await subscriber.handle(
      event({
        type: LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
        version: LANGY_CONVERSATION_EVENT_VERSIONS.ARCHIVED,
        data: { conversationId: "conversation-1" },
      }),
      context,
    );

    expect(deps.admissions.release).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
    });
  });
});
