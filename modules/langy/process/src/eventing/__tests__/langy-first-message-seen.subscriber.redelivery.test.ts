/**
 * A redelivered answer records the fact again for the same person, and the fact's command keys on
 * the person alone, so langy keeps one first_message_seen fact.
 * @see modules/langy/specs/langy-first-message-seen.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import type { LangyFirstMessageSeenEventData } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { createLangyFirstMessageSeenSubscriber } from "../langy-first-message-seen.subscriber.ts";
import { RecordLangyFirstMessageSeenCommand } from "../langy-guided-onboarding.commands.ts";
import { agentRespondedEvent, CONVERSATION_ID, PROJECT_ID, T0 } from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

function keyOf(data: LangyFirstMessageSeenEventData): string | undefined {
  const [event] = new RecordLangyFirstMessageSeenCommand().handle({
    tenantId: createTenantId(PROJECT_ID),
    aggregateId: RecordLangyFirstMessageSeenCommand.getAggregateId(data),
    type: "lw.langy_guided_onboarding.record_first_message_seen",
    data,
  });
  return event?.idempotencyKey;
}

describe("createLangyFirstMessageSeenSubscriber redelivery", () => {
  it("records both deliveries of one answer under one fact key", async () => {
    const recorded: LangyFirstMessageSeenEventData[] = [];
    const subscriber = createLangyFirstMessageSeenSubscriber({
      conversations: { getById: async () => ({ ownerUserId: "user-1" }) },
      facts: { recordFirstMessageSeen: async (data) => void recorded.push(data) },
    });
    const event = agentRespondedEvent({ id: "evt_answer", occurredAt: T0, turnId: "turn-1" });
    const answer = { ...event, data: { ...event.data, outcome: "completed" as const } };

    await subscriber.handle(answer, context);
    await subscriber.handle(answer, context);

    expect(recorded).toHaveLength(2);
    expect(new Set(recorded.map(keyOf))).toEqual(new Set(["langy-first-message-seen:user-1"]));
  });
});
