import { Currency, type OrganizationUserRole, type PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import { SubscriptionStatus } from "../planTypes";
import {
  createCheckoutLineItems,
  GROWTH_SEAT_PLAN_TYPES,
  isGrowthSeatPrice,
  resolveGrowthSeatPlanType,
} from "../utils/growthSeatEvent";
import {
  NoActiveSubscriptionError,
  SubscriptionItemNotFoundError,
} from "../errors";
import type { BillingInterval } from "../utils/growthSeatEvent";

type InviteInput = {
  email: string;
  role: OrganizationUserRole;
  teamIds: string;
};

export type SeatEventSubscriptionFns = ReturnType<
  typeof createSeatEventSubscriptionFns
>;

export const createSeatEventSubscriptionFns = ({
  stripe,
  db,
}: {
  stripe: Stripe;
  db: PrismaClient;
}) => ({
  async createSeatEventCheckout({
    organizationId,
    customerId,
    baseUrl,
    currency,
    billingInterval,
    membersToAdd,
    isUpgradeFromTiered = false,
    invites,
  }: {
    organizationId: string;
    customerId: string;
    baseUrl: string;
    currency: Currency;
    billingInterval: BillingInterval;
    membersToAdd: number;
    isUpgradeFromTiered?: boolean;
    invites?: InviteInput[];
  }) {
    // Find stale PENDING subs so we can clean up their PAYMENT_PENDING invites too
    const staleSubs = await db.subscription.findMany({
      where: {
        organizationId,
        plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
        status: SubscriptionStatus.PENDING,
      },
      select: { id: true },
    });

    const staleSubIds = staleSubs.map((s) => s.id);

    // Cancel stale PENDING subs from abandoned checkouts
    await db.subscription.updateMany({
      where: {
        organizationId,
        plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
        status: SubscriptionStatus.PENDING,
      },
      data: {
        status: SubscriptionStatus.CANCELLED,
        endDate: new Date(),
      },
    });

    // Clean up orphaned PAYMENT_PENDING invites from stale subs
    if (staleSubIds.length > 0) {
      await db.organizationInvite.deleteMany({
        where: {
          organizationId,
          status: "PAYMENT_PENDING",
          subscriptionId: { in: staleSubIds },
        },
      });
    }

    // Build line items BEFORE persisting anything so a validation failure
    // doesn't leave orphaned pending records in the database.
    const lineItems = createCheckoutLineItems({
      coreMembers: membersToAdd,
      currency,
      interval: billingInterval,
    });

    // Create subscription + invites in a transaction
    const subscription = await db.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          organizationId,
          status: SubscriptionStatus.PENDING,
          plan: resolveGrowthSeatPlanType({ currency, interval: billingInterval }),
          maxMembers: membersToAdd,
        },
      });

      if (invites && invites.length > 0) {
        for (const invite of invites) {
          // Skip duplicates (existing PENDING or PAYMENT_PENDING invites)
          const existing = await tx.organizationInvite.findFirst({
            where: {
              email: invite.email,
              organizationId,
              status: { in: ["PENDING", "PAYMENT_PENDING"] },
              OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
            },
          });

          if (existing) continue;

          await tx.organizationInvite.create({
            data: {
              email: invite.email,
              inviteCode: nanoid(),
              expiration: null,
              organizationId,
              teamIds: invite.teamIds,
              role: invite.role,
              status: "PAYMENT_PENDING",
              subscriptionId: sub.id,
            },
          });
        }
      }

      return sub;
    });

    const selectedOptionsMetadata = {
      selectedCurrency: currency,
      selectedBillingInterval: billingInterval,
    };

    // Anchor billing cycle to the 1st of next month for all plans.
    // Customer pays prorated amount for the partial period (checkout → anchor),
    // then full price (monthly or annual) starting on the 1st.
    const now = new Date();
    const billingCycleAnchor = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const subscriptionData: Stripe.Checkout.SessionCreateParams["subscription_data"] =
      {
        metadata: selectedOptionsMetadata,
        billing_cycle_anchor: Math.floor(
          billingCycleAnchor.getTime() / 1000,
        ),
        proration_behavior:
          "create_prorations" as Stripe.Checkout.SessionCreateParams.SubscriptionData.ProrationBehavior,
      };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      customer_update: {
        address: "auto",
        name: "auto",
      },
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      line_items: lineItems,
      metadata: selectedOptionsMetadata,
      subscription_data: subscriptionData,
      success_url: `${baseUrl}/settings/subscription?success${isUpgradeFromTiered ? "&upgraded_from=tiered" : ""}`,
      cancel_url: `${baseUrl}/settings/subscription`,
      client_reference_id: `subscription_setup_${subscription.id}`,
      allow_promotion_codes: true,
    });

    return { url: session.url };
  },

  async updateSeatEventItems({
    organizationId,
    totalMembers,
  }: {
    organizationId: string;
    totalMembers: number;
  }) {
    // Find the most recent subscription with a Stripe ID (ACTIVE or CANCELLED-but-still-active-in-Stripe)
    const lastSubscription = await db.subscription.findFirst({
      where: {
        organizationId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED] },
        stripeSubscriptionId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!lastSubscription?.stripeSubscriptionId) {
      return { success: false };
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(
      lastSubscription.stripeSubscriptionId,
    );

    // Stripe sub must still be active (even if scheduled for cancellation)
    if (stripeSubscription.status !== "active") {
      return { success: false };
    }

    const seatItem = stripeSubscription.items.data.find((item) =>
      isGrowthSeatPrice(item.price.id),
    );

    if (!seatItem) {
      return { success: false };
    }

    // Update seats (and reactivate if scheduled for cancellation — the user
    // is choosing to keep their subscription by updating seats).
    await stripe.subscriptions.update(lastSubscription.stripeSubscriptionId, {
      ...(stripeSubscription.canceled_at
        ? { cancel_at_period_end: false }
        : {}),
      items: [{ id: seatItem.id, quantity: totalMembers }],
    });

    // Restore DB record to ACTIVE with updated seat count
    await db.subscription.update({
      where: { id: lastSubscription.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        maxMembers: totalMembers,
        endDate: null,
      },
    });

    return { success: true };
  },

  async previewProration({
    organizationId,
    newTotalSeats,
  }: {
    organizationId: string;
    newTotalSeats: number;
  }) {
    // Find the most recent subscription with a Stripe ID (ACTIVE or CANCELLED-but-still-active-in-Stripe)
    const lastSubscription = await db.subscription.findFirst({
      where: {
        organizationId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED] },
        stripeSubscriptionId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!lastSubscription?.stripeSubscriptionId) {
      throw new NoActiveSubscriptionError();
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(
      lastSubscription.stripeSubscriptionId,
    );

    // Guard: Stripe sub must still be active (even if scheduled for cancellation)
    if (stripeSubscription.status !== "active") {
      throw new NoActiveSubscriptionError();
    }

    const seatItem = stripeSubscription.items.data.find((item) =>
      isGrowthSeatPrice(item.price.id),
    );

    if (!seatItem) {
      throw new SubscriptionItemNotFoundError("seat");
    }

    // Fetch upcoming invoice WITH the proposed seat change
    const upcomingWithChange = await stripe.invoices.retrieveUpcoming({
      subscription: lastSubscription.stripeSubscriptionId,
      subscription_items: [
        { id: seatItem.id, quantity: newTotalSeats },
      ],
      subscription_proration_behavior: "create_prorations",
    });

    // Fetch current upcoming invoice WITHOUT changes to isolate pre-existing
    // prorations (e.g. from mid-month signup with billing_cycle_anchor)
    const upcomingCurrent = await stripe.invoices.retrieveUpcoming({
      subscription: lastSubscription.stripeSubscriptionId,
    });

    const currency = (upcomingWithChange.currency?.toUpperCase() ?? Currency.USD) as Currency;
    const billingInterval = seatItem.price.recurring?.interval ?? "month";

    // Subtract existing prorations from changed prorations to get ONLY
    // the incremental cost of adding/removing seats.
    const sumProrations = (lines: { proration: boolean; amount: number }[]) => {
      let total = 0;
      for (const line of lines) {
        if (line.proration) total += line.amount;
      }
      return total;
    };
    const prorationCents =
      sumProrations(upcomingWithChange.lines.data) -
      sumProrations(upcomingCurrent.lines.data);

    // Recurring total: new seat count × per-seat price
    const unitAmountCents = seatItem.price.unit_amount ?? 0;
    const recurringTotalCents = newTotalSeats * unitAmountCents;

    const format = (cents: number) => {
      const amount = cents / 100;
      return new Intl.NumberFormat(currency === Currency.EUR ? "en-IE" : "en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(amount);
    };

    return {
      formattedAmountDue: format(prorationCents),
      formattedRecurringTotal: format(recurringTotalCents),
      billingInterval,
    };
  },

  async seatEventBillingPortalUrl({
    customerId,
    baseUrl,
  }: {
    customerId: string;
    baseUrl: string;
  }) {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/settings/subscription`,
    });

    return { url: session.url };
  },
});
