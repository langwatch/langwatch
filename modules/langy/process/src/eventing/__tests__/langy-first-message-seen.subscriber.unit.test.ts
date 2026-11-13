/**
 * first_message_seen: a completed answer from Langy is the owner getting Langy's message, recorded
 * as a fact against the owner, once per person. Nurturing sets saw_langy_first_message from it.
 * @see modules/langy/specs/langy-first-message-seen.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import { createTenantId, DispatchError } from "@langwatch/eventing";
import { NotFoundError } from "@langwatch/handled-error";
import { LANGY_FIRST_MESSAGE_SEEN_EVENT_TYPE } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { createLangyFirstMessageSeenSubscriber } from "../langy-first-message-seen.subscriber.ts";
import { RecordLangyFirstMessageSeenCommand } from "../langy-guided-onboarding.commands.ts";
import { agentRespondedEvent, CONVERSATION_ID, PROJECT_ID, T0 } from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

function responded(outcome: "completed" | "failed" | "stopped") {
  const event = agentRespondedEvent({ id: `evt_${outcome}`, occurredAt: T0, turnId: "turn-1" });
  return { ...event, data: { ...event.data, outcome } };
}

function harness(ownerUserId: string | null = "user-1") {
  const recorded: unknown[] = [];
  const subscriber = createLangyFirstMessageSeenSubscriber({
    conversations: { getById: async () => ({ ownerUserId }) },
    facts: { recordFirstMessageSeen: async (data) => void recorded.push(data) },
  });
  return { subscriber, recorded };
}

describe("the langyFirstMessageSeen subscriber", () => {
  /** @scenario "Langy's completed answer records that its owner got Langy's first message" */
  it("records the fact against the conversation's owner", async () => {
    const { subscriber, recorded } = harness();

    await subscriber.handle(responded("completed"), context);

    expect(recorded).toEqual([
      { tenantId: PROJECT_ID, occurredAt: T0, userId: "user-1", conversationId: CONVERSATION_ID },
    ]);
  });

  /** @scenario "A failed or stopped turn records nothing" */
  it.each(["failed", "stopped"] as const)("records nothing for a %s turn", async (outcome) => {
    const { subscriber, recorded } = harness();

    expect(subscriber.options?.enqueue?.filter?.(responded(outcome))).toBe(false);
    await subscriber.handle(responded(outcome), context);

    expect(recorded).toEqual([]);
  });

  /** @scenario "An answer in a conversation not folded yet is retried, not dropped" */
  it("rethrows a conversation not folded yet as retryable, and records nothing", async () => {
    const recorded: unknown[] = [];
    const subscriber = createLangyFirstMessageSeenSubscriber({
      conversations: {
        getById: async () => {
          throw new NotFoundError("langy_conversation_not_found", {
            resource: "Langy conversation",
            id: CONVERSATION_ID,
          });
        },
      },
      facts: { recordFirstMessageSeen: async (data) => void recorded.push(data) },
    });

    const failure = await subscriber.handle(responded("completed"), context).catch((e) => e);

    expect(failure).toBeInstanceOf(DispatchError);
    expect(failure).toMatchObject({
      retryable: true,
      cause: { code: "langy_conversation_not_found" },
    });
    expect(recorded).toEqual([]);
  });

  it("records nothing for a conversation with no owner", async () => {
    const { subscriber, recorded } = harness(null);

    await subscriber.handle(responded("completed"), context);

    expect(recorded).toEqual([]);
  });

  /** @scenario "The fact is recorded once per person" */
  it("keys the fact by the person alone, so a second answer lands on the same key", () => {
    const data = {
      tenantId: PROJECT_ID,
      occurredAt: T0,
      userId: "user-1",
      conversationId: CONVERSATION_ID,
    };

    const [event] = new RecordLangyFirstMessageSeenCommand().handle({
      tenantId: createTenantId(PROJECT_ID),
      aggregateId: "user:user-1",
      type: "lw.langy_guided_onboarding.record_first_message_seen",
      data,
    });

    expect(event).toMatchObject({
      type: LANGY_FIRST_MESSAGE_SEEN_EVENT_TYPE,
      aggregateId: "user:user-1",
      idempotencyKey: "langy-first-message-seen:user-1",
      data,
    });
  });
});
