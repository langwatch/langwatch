/**
 * A redelivered turn failure is recorded under the same source event id as the first delivery,
 * and the fact's command keys on it, so langy keeps one guided_onboarding_turn_failed fact.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import type { GuidedOnboardingTurnFailedEventData } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { createGuidedOnboardingTurnFailedSubscriber } from "../langy-guided-onboarding-turn-failed.subscriber.ts";
import { RecordGuidedOnboardingTurnFailedCommand } from "../langy-guided-onboarding.commands.ts";
import { agentResponseFailedEvent, CONVERSATION_ID, PROJECT_ID, T0 } from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

function subscriberRecording(recorded: GuidedOnboardingTurnFailedEventData[]) {
  return createGuidedOnboardingTurnFailedSubscriber({
    guidedOnboarding: {
      getByProject: async () => ({
        organizationId: "org-1",
        conversationId: CONVERSATION_ID,
        currentPath: "gateway",
        variant: null,
      }),
    },
    conversations: { getById: async () => ({ ownerUserId: "user-1" }) },
    facts: { recordTurnFailed: async (data) => void recorded.push(data) },
  });
}

function keyOf(data: GuidedOnboardingTurnFailedEventData): string | undefined {
  const [event] = new RecordGuidedOnboardingTurnFailedCommand().handle({
    tenantId: createTenantId(PROJECT_ID),
    aggregateId: data.conversationId,
    type: "lw.langy_guided_onboarding.record_turn_failed",
    data,
  });
  return event?.idempotencyKey;
}

describe("createGuidedOnboardingTurnFailedSubscriber redelivery", () => {
  it("records both deliveries of one failure under one fact key", async () => {
    const recorded: GuidedOnboardingTurnFailedEventData[] = [];
    const subscriber = subscriberRecording(recorded);
    const failed = agentResponseFailedEvent({ id: "evt_failed", occurredAt: T0, turnId: "turn-1" });

    await subscriber.handle(failed, context);
    await subscriber.handle(failed, context);

    expect(recorded).toHaveLength(2);
    expect(new Set(recorded.map(keyOf)).size).toBe(1);
  });

  it("records a different failure under a different fact key", async () => {
    const recorded: GuidedOnboardingTurnFailedEventData[] = [];
    const subscriber = subscriberRecording(recorded);

    await subscriber.handle(
      agentResponseFailedEvent({ id: "evt_one", occurredAt: T0, turnId: "turn-1" }),
      context,
    );
    await subscriber.handle(
      agentResponseFailedEvent({ id: "evt_two", occurredAt: T0, turnId: "turn-2" }),
      context,
    );

    expect(new Set(recorded.map(keyOf)).size).toBe(2);
  });
});
