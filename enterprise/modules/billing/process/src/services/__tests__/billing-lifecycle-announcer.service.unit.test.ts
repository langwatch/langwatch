// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/features/customer-io-nurturing-integration.feature
 * @see specs/analytics/posthog-campaign-conversion.feature
 */
import type { EventingCommandSender } from "@langwatch/eventing";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RecordBillingAuditCommandData,
  RecordCheckoutCompletedCommandData,
  RecordSubscriptionChangedCommandData,
  RecordSubscriptionStartedCommandData,
  RecordUsageBillingChangedCommandData,
} from "../../eventing/billing-lifecycle.events.ts";
import type { BillingReportOrganizationLookup } from "../../repositories/billing-report-organization.repository.ts";
import {
  BillingLifecycleAnnouncerService,
  USAGE_BILLING_SEND_ATTEMPTS,
} from "../billing-lifecycle-announcer.service.ts";

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

const billedLookup: BillingReportOrganizationLookup = {
  outcome: "usage_billed",
  organization: {
    id: "org-1",
    stripeCustomerId: "cus_1",
    subscriptions: [{ id: "sub-1" }],
    contract: "cloud",
  },
};

function announcerOver(input: {
  remaining: boolean;
  lookup?: () => Promise<BillingReportOrganizationLookup>;
  /** Fails the usage-billing send on these attempts, counted from 1. */
  failingUsageSends?: readonly number[];
}) {
  const changed: RecordSubscriptionChangedCommandData[] = [];
  const started: RecordSubscriptionStartedCommandData[] = [];
  const checkouts: RecordCheckoutCompletedCommandData[] = [];
  const usageBilling: RecordUsageBillingChangedCommandData[] = [];
  const pauses: number[] = [];
  const usageSends = { attempts: 0 };
  const { logger, lines } = createTestLogger();
  const service = BillingLifecycleAnnouncerService.create({
    subscriptions: { findLastNonCancelled: async () => (input.remaining ? { id: "sub-2" } : null) },
    organizations: { getAllMembers: async () => [{ id: "user-1" }, { id: "user-2" }] },
    resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
    planLimitAlerts: { notifyPlanLimitReached: async () => {} },
    billingOrganizations: {
      getOrganizationForBilling: input.lookup ?? (async () => billedLookup),
    },
    pause: async (ms) => {
      pauses.push(ms);
    },
    logger,
  });
  const usageRecorder = recorder(usageBilling);
  service.connect({
    recordSubscriptionChanged: recorder(changed),
    recordSubscriptionStarted: recorder(started),
    recordCheckoutCompleted: recorder(checkouts),
    recordUsageBillingChanged: {
      ...usageRecorder,
      send: async (payload) => {
        usageSends.attempts += 1;
        if (input.failingUsageSends?.includes(usageSends.attempts)) {
          throw new Error("event store down");
        }
        await usageRecorder.send(payload);
      },
    },
    recordAudit: recorder<RecordBillingAuditCommandData>([]),
  });
  return { service, changed, started, checkouts, usageBilling, usageSends, pauses, lines };
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
      planLimitAlerts: { notifyPlanLimitReached: async () => {} },
      billingOrganizations: { getOrganizationForBilling: async () => billedLookup },
    });
    service.connect({
      recordSubscriptionChanged: recorder(changed),
      recordSubscriptionStarted: recorder(started),
      recordCheckoutCompleted: recorder<RecordCheckoutCompletedCommandData>([]),
      recordUsageBillingChanged: recorder<RecordUsageBillingChangedCommandData>([]),
      recordAudit: recorder<RecordBillingAuditCommandData>([]),
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
      planLimitAlerts: { notifyPlanLimitReached: async () => {} },
      billingOrganizations: { getOrganizationForBilling: async () => billedLookup },
    });

    await expect(service.subscriptionActivated(activation)).resolves.toBeUndefined();
  });

  describe("when the usage-billing fact is recorded", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("records the meter's answer as a real fact after an activation", async () => {
      const { service, usageBilling } = announcerOver({ remaining: false });

      await service.subscriptionActivated(activation);

      expect(usageBilling).toEqual([
        expect.objectContaining({
          tenantId: "org-1",
          organizationId: "org-1",
          usageBilled: true,
          fromCatchUp: false,
        }),
      ]);
    });

    it("records the answer billing reads after a cancellation", async () => {
      const { service, usageBilling } = announcerOver({
        remaining: false,
        lookup: async () => ({ outcome: "not_usage_billed" }),
      });

      await service.subscriptionCancelled({ organizationId: "org-1" });

      expect(usageBilling).toEqual([
        expect.objectContaining({ organizationId: "org-1", usageBilled: false }),
      ]);
    });

    it("stamps the fact before reading billing, never after", async () => {
      vi.useFakeTimers({ now: 1_000 });
      const { service, usageBilling } = announcerOver({
        remaining: false,
        lookup: async () => {
          vi.setSystemTime(5_000);
          return billedLookup;
        },
      });

      await service.usageBillingChanged({ organizationId: "org-1" });

      expect(usageBilling[0]?.occurredAt).toBe(1_000);
    });

    it("never throws when billing cannot be read", async () => {
      const { service, usageBilling } = announcerOver({
        remaining: false,
        lookup: async () => {
          throw new Error("database down");
        },
      });

      await expect(
        service.usageBillingChanged({ organizationId: "org-1" }),
      ).resolves.toBeUndefined();
      expect(usageBilling).toEqual([]);
    });

    it("retries a failed send and records the fact once", async () => {
      const { service, usageBilling, usageSends, pauses } = announcerOver({
        remaining: false,
        failingUsageSends: [1, 2],
      });

      await expect(
        service.subscriptionCancelled({ organizationId: "org-1" }),
      ).resolves.toBeUndefined();

      expect(usageSends.attempts).toBe(3);
      expect(usageBilling).toHaveLength(1);
      expect(pauses).toEqual([200, 400]);
    });

    it("logs one error naming the organization and the catch-up job once every attempt fails", async () => {
      const { service, usageBilling, usageSends, lines } = announcerOver({
        remaining: false,
        failingUsageSends: [1, 2, 3, 4],
      });

      await expect(
        service.subscriptionCancelled({ organizationId: "org-1" }),
      ).resolves.toBeUndefined();

      expect(usageSends.attempts).toBe(USAGE_BILLING_SEND_ATTEMPTS);
      expect(usageBilling).toEqual([]);
      const errors = lines.filter((line) => line.level === 50);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual(
        expect.objectContaining({
          organizationId: "org-1",
          msg: expect.stringContaining("usage-billing-catch-up"),
        }),
      );
    });

    it("re-stamps and re-reads billing on each retry", async () => {
      vi.useFakeTimers({ now: 1_000 });
      const answers: BillingReportOrganizationLookup[] = [
        billedLookup,
        { outcome: "not_usage_billed" },
      ];
      let reads = 0;
      const { service, usageBilling } = announcerOver({
        remaining: false,
        failingUsageSends: [1],
        lookup: async () => {
          const answer = answers[reads] ?? billedLookup;
          reads += 1;
          vi.setSystemTime(1_000 + reads * 1_000);
          return answer;
        },
      });

      await service.usageBillingChanged({ organizationId: "org-1" });

      expect(reads).toBe(2);
      expect(usageBilling).toEqual([
        expect.objectContaining({ occurredAt: 2_000, usageBilled: false }),
      ]);
    });
  });
});
