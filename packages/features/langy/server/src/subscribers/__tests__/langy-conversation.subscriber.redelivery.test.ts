/**
 * Redelivery contract for the three Langy conversation subscribers, required by
 * the `eventing-subscriber-idempotency` architecture rule.
 *
 * Each of the three earns its idempotency a different way, and the rule's own
 * wording is why they are worth separating: queue deduplication alone is not
 * sufficient. All three declare a `deduplication.makeId`, and every one of those
 * windows expires — 15 seconds for the broadcast, twice the heartbeat grace for
 * liveness, and the admission lifecycle's default. A redelivery after the window
 * reaches `handle` for real, so what follows exercises `handle` directly rather
 * than the dedup key.
 *
 *   * `agentTurnLiveness` is LEVEL-TRIGGERED on the conversation projection. It
 *     acts only while the conversation is still RUNNING on the turn the event
 *     names, so the write it performs is also what makes the second delivery a
 *     no-op.
 *   * `langyConversationUpdateBroadcast` is an INVALIDATION. A second broadcast
 *     is a second message on the wire and that is fine — what matters is that
 *     the payload is identical, because a client applying it twice lands in the
 *     same place. A payload that carried a delta rather than a cursor would not
 *     have that property.
 *   * `langyTurnAdmissionLifecycle` DELEGATES idempotency to the admission
 *     capability, so what is pinned here is that a redelivery asks for exactly
 *     the same thing on the same turn, which is the precondition for the
 *     capability's own guarantee to hold.
 */
import { createTenantId, type EventSubscriberContext } from "@langwatch/eventing";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_EVENT_VERSIONS,
  LANGY_CONVERSATION_STATUS,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";
import type { LangyConversationProcessingEvent } from "../../adapters/eventing.langy.adapter";
import type { LangyConversationLivenessRecord } from "../langy-conversation.subscriber";
import {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
} from "../langy-conversation.subscriber";

const OCCURRED_AT = 1_752_600_000_000;
const PROJECT_ID = "project_1";
const CONVERSATION_ID = "conv_1";
const TURN_ID = "turn_1";

/** The subscribers read the envelope, never this; it is the framework's. */
const context: EventSubscriberContext = {
  tenantId: "ignored_context_project",
  aggregateId: "ignored_context_conversation",
};

function makeEvent(
  overrides: Partial<LangyConversationProcessingEvent> = {},
): LangyConversationProcessingEvent {
  return {
    id: "evt_1",
    aggregateId: CONVERSATION_ID,
    aggregateType: "langy_conversation",
    tenantId: createTenantId(PROJECT_ID),
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
    version: LANGY_CONVERSATION_EVENT_VERSIONS.AGENT_TURN_ACCEPTED,
    data: { conversationId: CONVERSATION_ID, turnId: TURN_ID, questionParts: [] },
    ...overrides,
  } as unknown as LangyConversationProcessingEvent;
}

const cursorAt = (eventId: string) => ({ acceptedAt: OCCURRED_AT, eventId });

describe("agentTurnLiveness redelivery", () => {
  describe("given a turn stalled past the maximum", () => {
    it("fails the turn once, because the failure moves the conversation off it", async () => {
      const event = makeEvent();
      // The projection the subscriber reads. `failTurn` is what production
      // advances it, so the fake advances it here: after the failure the
      // conversation is no longer RUNNING on this turn, which is precisely the
      // condition the handler re-reads on the second delivery.
      let record: LangyConversationLivenessRecord = {
        cursor: cursorAt("evt_1"),
        status: LANGY_CONVERSATION_STATUS.RUNNING,
        currentTurnId: TURN_ID,
        lastActivityAtMs: null,
      };
      const failTurn = vi.fn(async () => {
        record = { ...record, status: "failed", currentTurnId: null };
      });
      const subscriber = createAgentTurnLivenessSubscriber({
        conversations: { read: vi.fn(async () => record) },
        buffer: {
          liveness: vi.fn(async () => ({ stale: true })),
          appendStatus: vi.fn(async () => undefined),
          markError: vi.fn(async () => undefined),
        },
        failTurn: { failTurn },
        handoffStore: { read: vi.fn(async () => null) },
        worker: { dispatch: vi.fn(async () => undefined) },
        clock: () => OCCURRED_AT,
      });

      await subscriber.handle!(event, context);
      await subscriber.handle!(event, context);

      expect(failTurn).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the conversation has already moved to a later turn", () => {
    it("does nothing at all, so an old delivery cannot fail the current turn", async () => {
      const failTurn = vi.fn(async () => undefined);
      const dispatch = vi.fn(async () => undefined);
      const subscriber = createAgentTurnLivenessSubscriber({
        conversations: {
          read: vi.fn(async () => ({
            cursor: cursorAt("evt_1"),
            status: LANGY_CONVERSATION_STATUS.RUNNING,
            currentTurnId: "turn_2",
            lastActivityAtMs: null,
          })),
        },
        buffer: {
          liveness: vi.fn(async () => ({ stale: true })),
          appendStatus: vi.fn(async () => undefined),
          markError: vi.fn(async () => undefined),
        },
        failTurn: { failTurn },
        handoffStore: { read: vi.fn(async () => null) },
        worker: { dispatch },
        clock: () => OCCURRED_AT,
      });

      await subscriber.handle!(makeEvent(), context);
      await subscriber.handle!(makeEvent(), context);

      expect(failTurn).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });
});

describe("langyConversationUpdateBroadcast redelivery", () => {
  it("sends the identical invalidation both times", async () => {
    const broadcastToTenant = vi.fn(async () => undefined);
    const subscriber = createLangyConversationUpdateBroadcastSubscriber({
      conversations: {
        read: vi.fn(async () => ({
          cursor: cursorAt("evt_1"),
          ownerUserId: "user_1",
          isShared: false,
        })),
      },
      broadcast: { broadcastToTenant },
    });
    const event = makeEvent({ type: LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED });

    await subscriber.handle!(event, context);
    await subscriber.handle!(event, context);

    // Two messages, one meaning. The assertion is on the payload rather than the
    // call count, because a client that applies this twice must land where it
    // landed the first time — which holds only while the message names a cursor
    // instead of describing a change.
    expect(broadcastToTenant).toHaveBeenCalledTimes(2);
    const [first, second] = broadcastToTenant.mock.calls;
    expect(second).toEqual(first);
  });
});

describe("langyTurnAdmissionLifecycle redelivery", () => {
  it("confirms the same turn on both deliveries rather than a different one", async () => {
    const confirmAccepted = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const subscriber = createLangyTurnAdmissionLifecycleSubscriber({
      admissions: { confirmAccepted, release },
    });
    const event = makeEvent();

    await subscriber.handle!(event, context);
    await subscriber.handle!(event, context);

    const expected = {
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
    };
    expect(confirmAccepted).toHaveBeenCalledTimes(2);
    expect(confirmAccepted).toHaveBeenNthCalledWith(1, expected);
    expect(confirmAccepted).toHaveBeenNthCalledWith(2, expected);
    expect(release).not.toHaveBeenCalled();
  });

  it("releases the same turn on both deliveries of a terminal event", async () => {
    const confirmAccepted = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const subscriber = createLangyTurnAdmissionLifecycleSubscriber({
      admissions: { confirmAccepted, release },
    });
    const event = makeEvent({
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      data: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        messageId: "message_1",
        role: "assistant",
        parts: [],
        outcome: "completed",
      },
    } as Partial<LangyConversationProcessingEvent>);

    await subscriber.handle!(event, context);
    await subscriber.handle!(event, context);

    const expected = {
      projectId: PROJECT_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
    };
    expect(release).toHaveBeenNthCalledWith(1, expected);
    expect(release).toHaveBeenNthCalledWith(2, expected);
    expect(confirmAccepted).not.toHaveBeenCalled();
  });
});
