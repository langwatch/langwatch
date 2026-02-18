import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { SubscriptionStatus } from "../planTypes";
import {
  createCheckoutLineItems,
  isGrowthSeatPrice,
  resolveGrowthSeatPriceId,
} from "../utils/growthSeatEvent";

type Currency = "EUR" | "USD";
type BillingInterval = "monthly" | "annual";

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
  }: {
    organizationId: string;
    customerId: string;
    baseUrl: string;
    currency: Currency;
    billingInterval: BillingInterval;
    membersToAdd: number;
    isUpgradeFromTiered?: boolean;
  }) {
    // Clean up stale PENDING subs from abandoned checkouts
    await db.subscription.updateMany({
      where: {
        organizationId,
        plan: "GROWTH_SEAT_EVENT",
        status: SubscriptionStatus.PENDING,
      },
      data: {
        status: SubscriptionStatus.CANCELLED,
        endDate: new Date(),
      },
    });

    const subscription = await db.subscription.create({
      data: {
        organizationId,
        status: SubscriptionStatus.PENDING,
        plan: "GROWTH_SEAT_EVENT",
        maxMembers: membersToAdd,
      },
    });

    const lineItems = createCheckoutLineItems({
      coreMembers: membersToAdd,
      currency,
      interval: billingInterval,
    });

    // Annual: charge full year immediately, no anchor needed.
    // Monthly: anchor billing cycle to 1st of next month with prorations.
    const subscriptionData: Stripe.Checkout.SessionCreateParams["subscription_data"] =
      billingInterval === "annual"
        ? {}
        : (() => {
            const now = new Date();
            const billingCycleAnchor = new Date(
              Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
            );
            return {
              billing_cycle_anchor: Math.floor(
                billingCycleAnchor.getTime() / 1000,
              ),
              proration_behavior:
                "create_prorations" as Stripe.Checkout.SessionCreateParams.SubscriptionData.ProrationBehavior,
            };
          })();

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
    const lastSubscription = await db.subscription.findFirst({
      where: {
        organizationId,
        status: { not: SubscriptionStatus.CANCELLED },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!lastSubscription?.stripeSubscriptionId) {
      return { success: false };
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(
      lastSubscription.stripeSubscriptionId,
    );

    const seatItem = stripeSubscription.items.data.find((item) =>
      isGrowthSeatPrice(item.price.id),
    );

    if (!seatItem) {
      return { success: false };
    }

    await stripe.subscriptions.update(lastSubscription.stripeSubscriptionId, {
      items: [{ id: seatItem.id, quantity: totalMembers }],
    });

    await db.subscription.update({
      where: { id: lastSubscription.id },
      data: { maxMembers: totalMembers },
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
    const lastSubscription = await db.subscription.findFirst({
      where: {
        organizationId,
        status: { not: SubscriptionStatus.CANCELLED },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!lastSubscription?.stripeSubscriptionId) {
      throw new Error("No active subscription found");
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(
      lastSubscription.stripeSubscriptionId,
    );

    const seatItem = stripeSubscription.items.data.find((item) =>
      isGrowthSeatPrice(item.price.id),
    );

    if (!seatItem) {
      throw new Error("No seat item found on subscription");
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

    const currency = (upcomingWithChange.currency?.toUpperCase() ?? "USD") as "EUR" | "USD";
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
      return new Intl.NumberFormat(currency === "EUR" ? "en-IE" : "en-US", {
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
