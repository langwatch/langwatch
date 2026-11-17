// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import {
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_EVENT_VERSION,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  type SubscriptionChangedEventData,
} from "@langwatch/enterprise-billing-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { buildNurturingPipeline } from "../nurturing.pipeline.ts";

/** Nurturing's built pipeline, its peer subscribers as the registry receives them. */
function registeredSubscribers(): EventSubscriberDefinition<Event>[] {
  const pipeline = buildNurturingPipeline({
    deliver: async () => undefined,
    projectCreated: async () => undefined,
    guidedTurnFailed: async () => undefined,
    usageReportReceived: async () => undefined,
    evaluationsCompleted: async () => undefined,
    simulationRunsFinished: async () => undefined,
    codingSessionsStored: async () => undefined,
    recordPersonalOwner: async () => undefined,
    recordTracedProject: async () => undefined,
    forgetErasedUser: async () => undefined,
    virtualKeyCreated: async () => undefined,
    keyBudgetCrossed: async () => undefined,
  });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void subscribers.push(subscriber),
    // Any fold registers too; this test reads only the event subscribers.
    registerPeerFoldProjection: () => {},
    registerSubscriber: () => {},
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  return subscribers;
}

function subscriptionChanged(organizationId: string): Event<SubscriptionChangedEventData> {
  return {
    id: `evt-subscription-${organizationId}`,
    aggregateId: `subscription-${organizationId}`,
    aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
    tenantId: createTenantId(organizationId),
    createdAt: 1_000,
    occurredAt: 1_000,
    type: SUBSCRIPTION_CHANGED_EVENT_TYPE,
    version: BILLING_LIFECYCLE_EVENT_VERSION,
    data: {
      tenantId: organizationId,
      occurredAt: 1_000,
      organizationId,
      memberUserIds: ["user-1"],
      hasSubscription: true,
      plan: "GROWTH",
    },
  };
}

describe("nurturing's subscriptionChanged peer subscriber", () => {
  describe("when it registers", () => {
    /** @scenario "The plan copy keeps the newest fact, and a real fact wins a tie" */
    it("groups its jobs by organization, so a plan copy folds one fact at a time", () => {
      const lane = registeredSubscribers().find(({ name }) =>
        name.endsWith(".subscriptionChanged"),
      );

      expect(lane?.eventTypes).toEqual([SUBSCRIPTION_CHANGED_EVENT_TYPE]);
      expect(lane?.options?.groupKeyFn?.(subscriptionChanged("org-1"))).toBe(
        "subscriptionChanged:org-1",
      );
      expect(lane?.options?.groupKeyFn?.(subscriptionChanged("org-2"))).toBe(
        "subscriptionChanged:org-2",
      );
    });
  });
});
