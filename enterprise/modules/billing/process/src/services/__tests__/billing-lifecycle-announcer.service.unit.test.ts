// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import type { EventingCommandSender } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import type {
  RecordCheckoutCompletedCommandData,
  RecordSubscriptionChangedCommandData,
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
  const checkouts: RecordCheckoutCompletedCommandData[] = [];
  const service = BillingLifecycleAnnouncerService.create({
    subscriptions: { findLastNonCancelled: async () => (input.remaining ? { id: "sub-2" } : null) },
    organizations: { getAllMembers: async () => [{ id: "user-1" }, { id: "user-2" }] },
  });
  service.connect({
    recordSubscriptionChanged: recorder(changed),
    recordCheckoutCompleted: recorder(checkouts),
  });
  return { service, changed, checkouts };
}

describe("BillingLifecycleAnnouncerService", () => {
  it("records an activation for every member of the organization", async () => {
    const { service, changed } = announcerOver({ remaining: false });

    await service.subscriptionActivated({ organizationId: "org-1" });

    expect(changed).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        memberUserIds: ["user-1", "user-2"],
        hasSubscription: true,
      }),
    ]);
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

  it("never throws when its senders are not connected", async () => {
    const service = BillingLifecycleAnnouncerService.create({
      subscriptions: { findLastNonCancelled: async () => null },
      organizations: { getAllMembers: async () => [] },
    });

    await expect(
      service.subscriptionActivated({ organizationId: "org-1" }),
    ).resolves.toBeUndefined();
  });
});
