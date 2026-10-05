// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/features/customer-io-nurturing-integration.feature
 * @see specs/analytics/posthog-campaign-conversion.feature
 */
import type { EventingCommandSender } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type {
  RecordCheckoutCompletedCommandData,
  RecordSubscriptionChangedCommandData,
  RecordSubscriptionStartedCommandData,
} from "../../eventing/billing-lifecycle.events.ts";
import { BillingLifecycleAnnouncerService } from "../billing-lifecycle-announcer.service.ts";

function recorder<Payload>(sent: Payload[]): EventingCommandSender<Payload> {
  return {
    send: async (payload) => {
      sent.push(payload);
    },
    sendBatch: async (payloads) => {
      sent.push(...payloads);
    },
    close: async () => {},
    waitUntilReady: async () => {},
  };
}

function announcerOver(input: { remaining: boolean }) {
  const changed: RecordSubscriptionChangedCommandData[] = [];
  const started: RecordSubscriptionStartedCommandData[] = [];
  const checkouts: RecordCheckoutCompletedCommandData[] = [];
  const service = BillingLifecycleAnnouncerService.create({
    subscriptions: { findLastNonCancelled: async () => (input.remaining ? { id: "sub-2" } : null) },
    organizations: { getAllMembers: async () => [{ id: "user-1" }, { id: "user-2" }] },
    resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
  });
  service.connect({
    recordSubscriptionChanged: recorder(changed),
    recordSubscriptionStarted: recorder(started),
    recordCheckoutCompleted: recorder(checkouts),
  });
  return { service, changed, started, checkouts };
}

const activation = { organizationId: "org-1", subscriptionId: "sub-1", plan: "LAUNCH" };

describe("BillingLifecycleAnnouncerService", () => {
  it("records an activation for every member of the organization", async () => {
    const { service, changed } = announcerOver({ remaining: false });

    await service.subscriptionActivated(activation);

    expect(changed).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        memberUserIds: ["user-1", "user-2"],
        hasSubscription: true,
      }),
    ]);
  });

  it("records the started subscription with its plan and every member", async () => {
    const { service, started } = announcerOver({ remaining: false });

    await service.subscriptionActivated(activation);

    expect(started).toEqual([
      expect.objectContaining({
        tenantId: "org-1",
        organizationId: "org-1",
        subscriptionId: "sub-1",
        plan: "LAUNCH",
        memberUserIds: ["user-1", "user-2"],
      }),
    ]);
  });

  it("records no started subscription for a cancellation", async () => {
    const { service, started } = announcerOver({ remaining: false });

    await service.subscriptionCancelled({ organizationId: "org-1" });

    expect(started).toEqual([]);
  });

  it("records a cancellation as no subscription only when none remains", async () => {
    const none = announcerOver({ remaining: false });
    const some = announcerOver({ remaining: true });

    await none.service.subscriptionCancelled({ organizationId: "org-1" });
    await some.service.subscriptionCancelled({ organizationId: "org-1" });

    expect(none.changed[0]?.hasSubscription).toBe(false);
    expect(some.changed[0]?.hasSubscription).toBe(true);
  });

  it("records a completed checkout with the session's creation instant", async () => {
    const { service, checkouts } = announcerOver({ remaining: false });

    await service.checkoutCompleted({
      organizationId: "org-1",
      subscriptionId: "sub_1",
      checkoutCreatedAt: "2026-09-30T10:00:00.000Z",
    });

    expect(checkouts).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        subscriptionId: "sub_1",
        checkoutCreatedAt: "2026-09-30T10:00:00.000Z",
      }),
    ]);
  });

  /** @scenario A failed member lookup does not break the webhook */
  it("never throws and records nothing when the member lookup fails", async () => {
    const changed: RecordSubscriptionChangedCommandData[] = [];
    const started: RecordSubscriptionStartedCommandData[] = [];
    const service = BillingLifecycleAnnouncerService.create({
      subscriptions: { findLastNonCancelled: async () => null },
      organizations: {
        getAllMembers: async () => {
          throw new Error("member lookup failed");
        },
      },
      resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
    });
    service.connect({
      recordSubscriptionChanged: recorder(changed),
      recordSubscriptionStarted: recorder(started),
      recordCheckoutCompleted: recorder<RecordCheckoutCompletedCommandData>([]),
    });

    await expect(service.subscriptionActivated(activation)).resolves.toBeUndefined();
    expect(changed).toEqual([]);
    expect(started).toEqual([]);
  });

  it("never throws when its senders are not connected", async () => {
    const service = BillingLifecycleAnnouncerService.create({
      subscriptions: { findLastNonCancelled: async () => null },
      organizations: { getAllMembers: async () => [] },
      resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
    });

    await expect(service.subscriptionActivated(activation)).resolves.toBeUndefined();
  });
});
