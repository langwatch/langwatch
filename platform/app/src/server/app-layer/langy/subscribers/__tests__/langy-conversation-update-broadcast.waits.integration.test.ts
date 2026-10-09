/**
 * The freshness signal for a permission card, over the real projection.
 *
 * A tab that did not start the turn has no live stream, so the only thing that
 * moves its cards is this signal. The subscriber publishes it once the
 * conversation projection has reached the event, and the projection used to
 * skip both card events: the signal was retried until it was dropped, and a
 * card answered in the terminal kept its buttons until the command finished.
 *
 * The projection and the subscriber are both the real ones here, because the
 * bug was in the pair and neither half is wrong on its own.
 *
 * @see specs/langy/langy-local-permissions.feature
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  type LangyConversationStateData,
} from "@langwatch/langy";
import { describe, expect, it, vi } from "vitest";
import { LangyConversationStateFoldProjection } from "~/server/event-sourcing/pipelines/langy-conversation-processing/projections/langyConversationState.foldProjection";
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import type { StateProjectionStore } from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

import { createLangyConversationUpdateBroadcastSubscriber } from "../langy-conversation-update-broadcast.subscriber";

const PROJECT = "project_1";
const CONVERSATION = "conv_1";
const context: EventSubscriberContext = {
  tenantId: PROJECT,
  aggregateId: CONVERSATION,
};

const noopStore: StateProjectionStore<LangyConversationStateData> = {
  store: async () => {},
  load: async () => null,
};

const waitEnded = {
  id: "evt_wait_ended",
  aggregateId: CONVERSATION,
  aggregateType: "langy_conversation",
  tenantId: PROJECT,
  createdAt: 1_752_600_000_000,
  occurredAt: 1_752_600_000_000,
  type: LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED,
  version: LANGY_CONVERSATION_EVENT_VERSIONS.USER_WAIT_ENDED,
  data: {
    conversationId: CONVERSATION,
    turnId: "turn_1",
    waitId: "lwait_1",
    kind: "permission",
    toolCallId: "call_1",
    outcome: "answered",
    userId: "user_1",
    decision: "allow_once",
    source: "terminal",
  },
} as unknown as LangyConversationProcessingEvent;

/**
 * Where the projection's cursor stands after one event, the way the pipeline
 * moves it: an event the projection reads carries the cursor to that event,
 * and an event it does not read leaves the cursor behind.
 */
function projectionCursorAfter(event: LangyConversationProcessingEvent): {
  acceptedAt: number;
  eventId: string;
} {
  const projection = new LangyConversationStateFoldProjection({
    store: noopStore,
  });
  const before = projection.init();
  const after = projection.apply(before, event);
  const wasRead = after.LastEventOccurredAt !== before.LastEventOccurredAt;
  return wasRead
    ? { acceptedAt: event.createdAt, eventId: event.id }
    : { acceptedAt: 0, eventId: "evt_before_the_card" };
}

function subscriberOver(cursor: { acceptedAt: number; eventId: string }) {
  const broadcastToTenant = vi.fn().mockResolvedValue(undefined);
  const subscriber = createLangyConversationUpdateBroadcastSubscriber({
    broadcast: { broadcastToTenant },
    conversations: {
      read: vi.fn().mockResolvedValue({
        cursor,
        ownerUserId: "user_1",
        isShared: false,
      }),
    },
  });
  return { subscriber, broadcastToTenant };
}

describe("the freshness signal for a card answered in the terminal", () => {
  describe("given a card raised on a turn this browser did not start", () => {
    describe("when the developer answers it in the terminal and the command runs on", () => {
      /** @scenario "A card that was answered while a long command runs still settles" */
      it("reaches the projection straight away and publishes the signal", async () => {
        const cursor = projectionCursorAfter(waitEnded);
        expect(cursor).toEqual({
          acceptedAt: waitEnded.createdAt,
          eventId: waitEnded.id,
        });

        const { subscriber, broadcastToTenant } = subscriberOver(cursor);
        await subscriber.handle(waitEnded, context);

        expect(broadcastToTenant).toHaveBeenCalledTimes(1);
        const [projectId, payload] = broadcastToTenant.mock.calls[0]!;
        expect(projectId).toBe(PROJECT);
        expect(JSON.parse(payload as string)).toMatchObject({
          event: "langy_conversation_updated",
          conversationId: CONVERSATION,
          cursor: { eventId: waitEnded.id },
        });
      });

      it("says nothing about the answer on the tenant channel", async () => {
        const { subscriber, broadcastToTenant } = subscriberOver(
          projectionCursorAfter(waitEnded),
        );
        await subscriber.handle(waitEnded, context);

        const payload = broadcastToTenant.mock.calls[0]![1] as string;
        expect(payload).not.toContain("allow_once");
        expect(payload).not.toContain("lwait_1");
      });
    });
  });
});
