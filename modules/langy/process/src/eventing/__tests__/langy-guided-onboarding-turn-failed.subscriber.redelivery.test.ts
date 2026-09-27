/**
 * A redelivered turn failure is tracked with the same event uuid as the first delivery, so the
 * analytics sink, which dedups on it, records one guided_onboarding_turn_failed.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { EventSubscriberContext } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { createGuidedOnboardingTurnFailedSubscriber } from "../langy-guided-onboarding-turn-failed.subscriber.ts";
import { agentResponseFailedEvent, CONVERSATION_ID, PROJECT_ID, T0 } from "./langyEventFixtures.ts";

const context: EventSubscriberContext = { tenantId: PROJECT_ID, aggregateId: CONVERSATION_ID };

function subscriberTracking(uuids: string[]) {
  return createGuidedOnboardingTurnFailedSubscriber({
    guidedOnboarding: {
      getByProject: async () => ({
        organizationId: "org-1",
        conversationId: CONVERSATION_ID,
        currentPath: "gateway",
        experimentProperties: {},
      }),
    },
    conversations: { getById: async () => ({ ownerUserId: "user-1" }) },
    analytics: { track: ({ uuid }) => void uuids.push(uuid) },
  });
}

describe("createGuidedOnboardingTurnFailedSubscriber redelivery", () => {
  it("tracks both deliveries of one failure under the same event uuid", async () => {
    const uuids: string[] = [];
    const subscriber = subscriberTracking(uuids);
    const failed = agentResponseFailedEvent({ id: "evt_failed", occurredAt: T0, turnId: "turn-1" });

    await subscriber.handle(failed, context);
    await subscriber.handle(failed, context);

    expect(uuids).toHaveLength(2);
    expect(new Set(uuids).size).toBe(1);
    expect(uuids[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("tracks a different failure under a different uuid", async () => {
    const uuids: string[] = [];
    const subscriber = subscriberTracking(uuids);

    await subscriber.handle(
      agentResponseFailedEvent({ id: "evt_one", occurredAt: T0, turnId: "turn-1" }),
      context,
    );
    await subscriber.handle(
      agentResponseFailedEvent({ id: "evt_two", occurredAt: T0, turnId: "turn-2" }),
      context,
    );

    expect(new Set(uuids).size).toBe(2);
  });
});
