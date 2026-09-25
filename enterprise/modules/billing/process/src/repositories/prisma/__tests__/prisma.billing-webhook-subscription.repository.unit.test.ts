import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
/**
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  type BillingSubscription,
  type BillingSubscriptionRecord,
  type BillingSubscriptionWithOrganization,
} from "../../subscription.repository.ts";
import { PrismaBillingWebhookBillingSubscription } from "../prisma.billing-webhook-subscription.repository.ts";

const SUBSCRIPTION: BillingSubscriptionRecord = {
  id: "subscription-1",
  organizationId: "organization-1",
  status: "PENDING",
  plan: "LAUNCH",
  stripeSubscriptionId: "sub_1",
  createdAt: Temporal.Instant.from("2026-01-01T00:00:00.000Z"),
  startDate: null,
  endDate: null,
  maxMembers: null,
  maxMembersLite: null,
  maxMessagesPerMonth: null,
  lastPaymentFailedDate: null,
};

const WITH_ORGANIZATION: BillingSubscriptionWithOrganization = {
  ...SUBSCRIPTION,
  status: "ACTIVE",
  organization: { id: "organization-1", name: "Acme", stripeCustomerId: "cus_1" },
};

/** Prisma's "required record not found", as the client raises it. */
function recordNotFound(): Error & { code: string } {
  return Object.assign(new Error("No Subscription found"), { code: "P2025" });
}

function repositoryDouble(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    findActive: vi.fn(),
    findLastNonCancelled: vi.fn(() => Promise.resolve(SUBSCRIPTION)),
    createPending: vi.fn(() => Promise.resolve(SUBSCRIPTION)),
    updateStatus: vi.fn(() => Promise.resolve(SUBSCRIPTION)),
    updatePlan: vi.fn(() => Promise.resolve(SUBSCRIPTION)),
    findByStripeId: vi.fn(() => Promise.resolve(SUBSCRIPTION)),
    linkStripeId: vi.fn(() => Promise.resolve({ count: 1 })),
    activate: vi.fn(() => Promise.resolve(WITH_ORGANIZATION)),
    recordPaymentFailure: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    cancelTrialSubscriptions: vi.fn(() => Promise.resolve()),
    migrateToSeatEvent: vi.fn(() => Promise.resolve([])),
    updateQuantities: vi.fn(() => Promise.resolve(WITH_ORGANIZATION)),
    ...overrides,
  };
}

function compose(
  options: {
    repository?: BillingSubscription;
    license?: string | null;
  } = {},
) {
  const subscriptions = options.repository ?? repositoryDouble();
  const database = {
    organization: {
      findUnique: vi.fn(() => Promise.resolve({ license: options.license ?? null })),
    },
  } as unknown as Pick<PrismaClient, "organization">;

  return {
    subscriptions,
    adapter: PrismaBillingWebhookBillingSubscription.create({ subscriptions, database }),
  };
}

describe("PrismaBillingWebhookBillingSubscription", () => {
  describe("when a payment activates the subscription", () => {
    /** @scenario "An activation carries the organization's trial licence to the webhook" */
    it("carries the organization's trial licence beside the activated row", async () => {
      const activate = vi.fn(() => Promise.resolve(WITH_ORGANIZATION));
      const { adapter } = compose({
        license: "trial-key",
        repository: repositoryDouble({ activate }),
      });

      const result = await adapter.activate({
        id: "subscription-1",
        previousStatus: "PENDING",
      });

      expect(activate).toHaveBeenCalledWith({
        id: "subscription-1",
        previousStatus: "PENDING",
      });
      expect(result).toEqual({
        outcome: "activated",
        subscription: expect.objectContaining({
          organization: {
            id: "organization-1",
            name: "Acme",
            stripeCustomerId: "cus_1",
            license: "trial-key",
          },
        }),
      });
    });
  });

  describe("when a subscription update raises the priced quantities", () => {
    /** @scenario "An activation carries the organization's trial licence to the webhook" */
    it("writes both quantities and reports no trial licence where there is none", async () => {
      const updateQuantities = vi.fn(() => Promise.resolve(WITH_ORGANIZATION));
      const { adapter } = compose({ repository: repositoryDouble({ updateQuantities }) });

      const result = await adapter.updateQuantities({
        id: "subscription-1",
        maxMembers: 12,
        maxMessagesPerMonth: 100_000,
      });

      expect(updateQuantities).toHaveBeenCalledWith({
        id: "subscription-1",
        maxMembers: 12,
        maxMessagesPerMonth: 100_000,
      });
      expect(result.outcome).toBe("updated");
      expect(result.outcome === "updated" && result.subscription.organization.license).toBeNull();
    });
  });

  describe("when Stripe names a subscription row that is gone", () => {
    /** @scenario "A subscription row Stripe names that is gone is not a failed delivery" */
    it("reports a missing subscription rather than failing the delivery", async () => {
      const { adapter } = compose({
        repository: repositoryDouble({
          activate: vi.fn(() => Promise.reject(recordNotFound())),
        } as Partial<BillingSubscription>),
      });

      await expect(
        adapter.activate({ id: "subscription-gone", previousStatus: "PENDING" }),
      ).resolves.toEqual({ outcome: "missing_subscription" });
    });
  });

  describe("when the database itself fails", () => {
    /** @scenario "A database failure makes Stripe retry rather than acknowledging a plan change that never landed" */
    it("rethrows, so the delivery is retried rather than acknowledged", async () => {
      const { adapter } = compose({
        repository: repositoryDouble({
          activate: vi.fn(() => Promise.reject(new Error("connection refused"))),
        } as Partial<BillingSubscription>),
      });

      await expect(
        adapter.activate({ id: "subscription-1", previousStatus: "PENDING" }),
      ).rejects.toThrow("connection refused");
    });
  });

  describe("when the webhook reads or cancels without renaming anything", () => {
    /** @scenario "The webhook's unrenamed subscription writes reach the repository unchanged" */
    it("passes each call through to the repository unchanged", async () => {
      const cancel = vi.fn(() => Promise.resolve());
      const cancelTrialSubscriptions = vi.fn(() => Promise.resolve());
      const recordPaymentFailure = vi.fn(() => Promise.resolve());
      const linkStripeId = vi.fn(() => Promise.resolve({ count: 1 }));
      const { adapter } = compose({
        repository: repositoryDouble({
          cancel,
          cancelTrialSubscriptions,
          recordPaymentFailure,
          linkStripeId,
        }),
      });

      await adapter.cancel({ id: "subscription-1" });
      await adapter.cancelTrialSubscriptions("organization-1");
      await adapter.recordPaymentFailure({ id: "subscription-1", currentStatus: "ACTIVE" });
      await adapter.linkStripeId({ id: "subscription-1", stripeSubscriptionId: "sub_1" });

      expect(cancel).toHaveBeenCalledWith({ id: "subscription-1" });
      expect(cancelTrialSubscriptions).toHaveBeenCalledWith("organization-1");
      expect(recordPaymentFailure).toHaveBeenCalledWith({
        id: "subscription-1",
        currentStatus: "ACTIVE",
      });
      expect(linkStripeId).toHaveBeenCalledWith({
        id: "subscription-1",
        stripeSubscriptionId: "sub_1",
      });
    });
  });
});
