// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The writes that keep an organization on one active subscription, on a real Postgres.
 * @see ../../../../../specs/billing.feature
 */
import { randomUUID } from "node:crypto";

import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { BillingCheckoutCompletionService } from "../../../services/billing-checkout-completion.service.ts";
import { PrismaBillingWebhookOrganizationRepository } from "../prisma.billing-webhook-organization.repository.ts";
import { PrismaBillingWebhookSubscriptionRepository } from "../prisma.billing-webhook-subscription.repository.ts";
import { PrismaSeatEventSubscriptionRepository } from "../prisma.seat-event-subscription.repository.ts";
import { PrismaBillingSubscriptionRepository } from "../prisma.subscription.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("duplicate active subscriptions on Postgres", () => {
  const run = `dup_sub_${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:billing:test:duplicate-subscriptions"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const subscriptions = PrismaBillingSubscriptionRepository.create(prisma);
  const seats = PrismaSeatEventSubscriptionRepository.create(prisma);
  const organizationIds: string[] = [];

  const organization = async (suffix: string) => {
    const { id } = await prisma.organization.create({
      data: { name: "ACME", slug: `--${run}-${suffix}` },
    });
    organizationIds.push(id);
    return id;
  };
  const row = async (
    organizationId: string,
    suffix: string,
    data: {
      status: "ACTIVE" | "PENDING";
      stripe?: boolean;
      maxMembers?: number;
      maxRetentionDays?: number;
      plan?: "GROWTH_SEAT_EUR_MONTHLY" | "ENTERPRISE" | "LAUNCH";
      maxProjects?: number;
    },
  ) => {
    const id = `${run}_${suffix}`;
    await prisma.subscription.create({
      data: {
        id,
        organizationId,
        plan: data.plan ?? "GROWTH_SEAT_EUR_MONTHLY",
        status: data.status,
        maxProjects: data.maxProjects ?? null,
        stripeSubscriptionId: data.stripe ? `${id}_stripe` : null,
        maxMembers: data.maxMembers ?? 3,
        maxRetentionDays: data.maxRetentionDays ?? null,
      },
    });
    return id;
  };
  const statusOf = async (id: string) =>
    (await prisma.subscription.findUniqueOrThrow({ where: { id } })).status;

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  /** @scenario "A paid checkout lands on the active row an operator made" */
  it("finds the operator's unlinked row beside a checkout and lands the checkout on it", async () => {
    const organizationId = await organization("adopt");
    const live = await row(organizationId, "ops", { status: "ACTIVE", maxMembers: 3 });
    await row(organizationId, "linked", { status: "ACTIVE", stripe: true });
    const pending = await row(organizationId, "checkout", {
      status: "PENDING",
      maxMembers: 7,
      maxRetentionDays: 180,
    });

    const found = await subscriptions.findLiveUnlinkedBeside({ pendingId: pending });
    expect(found.map((each) => each.id)).toEqual([live]);

    await subscriptions.adoptCheckout({ pendingId: pending, liveId: live });

    const adopted = await prisma.subscription.findUniqueOrThrow({ where: { id: live } });
    expect(adopted).toMatchObject({ status: "ACTIVE", maxMembers: 7, maxRetentionDays: 180 });
    expect(await statusOf(pending)).toBe("CANCELLED");
  });

  /** @scenario "A paid checkout is never moved onto an operator's custom-limit plan" */
  it("reads the operator's unlinked row with a limit beyond seats as a custom deal", async () => {
    const organizationId = await organization("custom_live");
    const live = await row(organizationId, "custom_live", { status: "ACTIVE", maxProjects: 50 });
    const plain = await row(organizationId, "plain_live", { status: "ACTIVE" });
    const pending = await row(organizationId, "custom_checkout", { status: "PENDING" });

    const found = await subscriptions.findLiveUnlinkedBeside({ pendingId: pending });

    expect(
      found
        .map(({ id, customLimits }) => ({ id, customLimits }))
        .toSorted((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      [
        { id: live, customLimits: true },
        { id: plain, customLimits: false },
      ].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
  });

  /** @scenario "A paid checkout links the only subscription an operator added" */
  it("links the operator's only row when the checkout a seat change opened is paid", async () => {
    const organizationId = await organization("ops_only");
    const live = await row(organizationId, "ops_only", { status: "ACTIVE", maxMembers: 3 });
    const pending = await row(organizationId, "ops_only_checkout", {
      status: "PENDING",
      maxMembers: 4,
    });
    const stripeId = `${run}_ops_only_stripe`;
    const stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
    stripeSubscriptions.seed({
      subscription: {
        id: stripeId,
        status: "active",
        canceledAt: null,
        billingThreshold: null,
        items: [],
      },
    });
    const audited = vi.fn(async () => undefined);
    const quiet = vi.fn(async () => undefined);
    const completion = BillingCheckoutCompletionService.create({
      subscriptionRepository: PrismaBillingWebhookSubscriptionRepository.create({ subscriptions }),
      organizationRepository: PrismaBillingWebhookOrganizationRepository.create({
        database: prisma,
      }),
      stripeSubscriptions,
      itemCalculator: { calculateQuantityForPrice: () => 0, prices: {} as StripePriceMap },
      licenses: createApiFixture<LicensingApi>({
        getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
      }),
      host: {
        sendSlackSubscriptionEvent: async () => {},
        sendSlackBillingThresholdFailureAlert: async () => {},
        sendSlackAccountPaymentFailed: async () => {},
      },
      announcer: {
        checkoutCompleted: quiet,
        subscriptionActivated: quiet,
        subscriptionCancelled: quiet,
        checkoutCurrencySelected: quiet,
        seatCheckoutPaid: quiet,
        pricingModelChanged: quiet,
        audited,
        seatCheckoutsAbandoned: quiet,
      },
    });

    await completion.dispatchCheckoutCompleted({
      event: createApiFixture<Stripe.CheckoutSessionCompletedEvent>({
        id: `evt_${pending}`,
        type: "checkout.session.completed",
        data: {
          object: createApiFixture<Stripe.Checkout.Session>({
            client_reference_id: `subscription_setup_${pending}`,
            created: Math.floor(Date.now() / 1000),
            metadata: {},
          }),
        },
      }),
      subscriptionId: stripeId,
      organizationId,
    });

    const active = await prisma.subscription.findMany({
      where: { organizationId, status: "ACTIVE" },
    });
    expect(active).toEqual([
      expect.objectContaining({ id: live, stripeSubscriptionId: stripeId, maxMembers: 4 }),
    ]);
    expect(await statusOf(pending)).toBe("CANCELLED");
    expect(audited).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: organizationId,
        action: "subscription.adoptCheckout",
        args: { pendingId: pending, liveId: live },
      }),
    );
  }, 20_000);

  /** @scenario "A seat checkout is refused while a linked plan it would not replace is live" */
  it("lists the organization's active plans with their links", async () => {
    const organizationId = await organization("plans");
    const linked = await row(organizationId, "plan_linked", { status: "ACTIVE", stripe: true });
    await row(organizationId, "plan_pending", { status: "PENDING" });

    expect(await seats.findActivePlans({ organizationId })).toEqual([
      {
        id: linked,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        stripeSubscriptionId: `${linked}_stripe`,
        customLimits: false,
      },
    ]);
  });

  /** @scenario "A seat change on a custom plan goes to support, not checkout" */
  it("reads a row with a limit an operator set as a custom deal", async () => {
    const organizationId = await organization("custom");
    const custom = await row(organizationId, "custom", { status: "ACTIVE", maxProjects: 50 });

    expect(await seats.findActivePlans({ organizationId })).toEqual([
      expect.objectContaining({ id: custom, customLimits: true }),
    ]);
    expect(await seats.findSeatCandidates({ organizationId })).toEqual([
      expect.objectContaining({ id: custom, plan: "GROWTH_SEAT_EUR_MONTHLY", customLimits: true }),
    ]);
  });

  /** @scenario "Two paid seat checkouts keep one plan" */
  it("finds the linked seat plan a second checkout would sit beside, and nothing else", async () => {
    const organizationId = await organization("second");
    const live = await row(organizationId, "second_live", { status: "ACTIVE", stripe: true });
    await row(organizationId, "second_tiered", { status: "ACTIVE", stripe: true, plan: "LAUNCH" });
    await row(organizationId, "second_ops", { status: "ACTIVE" });
    const pending = await row(organizationId, "second_checkout", { status: "PENDING" });

    const found = await subscriptions.findLiveLinkedBeside({ pendingId: pending });

    expect(found.map((each) => each.id)).toEqual([live]);
  });

  /** @scenario "A stray local subscription beside the one live in Stripe is closed and the change goes on" */
  it("closes only the stray active rows it is given", async () => {
    const organizationId = await organization("stray");
    const kept = await row(organizationId, "kept", { status: "ACTIVE", stripe: true });
    const stray = await row(organizationId, "stray", { status: "ACTIVE" });
    const pending = await row(organizationId, "stray_pending", { status: "PENDING" });

    await seats.supersedeStrayRows({ ids: [stray, pending] });

    expect(await statusOf(stray)).toBe("CANCELLED");
    expect(await statusOf(kept)).toBe("ACTIVE");
    expect(await statusOf(pending)).toBe("PENDING");
  });
});
