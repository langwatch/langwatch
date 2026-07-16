import { describe, expect, it, vi } from "vitest";

import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import { LANGY_CONVERSATION_EVENT_TYPES } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import { createLangyTurnAdmissionLifecycleSubscriber } from "../langy-turn-admission-lifecycle.subscriber";

const context: EventSubscriberContext = {
  tenantId: "ignored-project",
  aggregateId: "ignored-conversation",
};

function event(
  type: string,
  data: Record<string, unknown>,
): LangyConversationProcessingEvent {
  return {
    id: `event-${type}`,
    aggregateId: "conversation-1",
    aggregateType: "langy_conversation",
    tenantId: "project-1",
    createdAt: 1_000,
    occurredAt: 1_000,
    type,
    version: "1",
    data: { conversationId: "conversation-1", ...data },
  } as LangyConversationProcessingEvent;
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
      event(LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED, {
        turnId: "turn-1",
        questionParts: [],
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
      event(LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED, {
        turnId: "turn-old",
        parts: [],
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
      event(LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED, {}),
      context,
    );

    expect(deps.admissions.release).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
    });
  });
});
