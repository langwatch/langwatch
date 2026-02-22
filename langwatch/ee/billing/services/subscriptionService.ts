import { Currency, type OrganizationUserRole, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { notifySubscriptionEvent } from "../notifications/notificationHandlers";
import {
  type PlanTypes as PlanType,
  PlanTypes,
  SubscriptionStatus,
} from "../planTypes";
import type { StripePriceName } from "../stripe/stripePrices.types";
import type {
  createItemsToAdd,
  getItemsToUpdate,
  prices,
} from "./subscriptionItemCalculator";
import { isStripePriceName } from "../stripe/stripePriceCatalog";
import {
  InvalidPlanError,
  OrganizationNotFoundError,
  SeatBillingUnavailableError,
} from "../errors";
import { isGrowthSeatEventPlan } from "../utils/growthSeatEvent";
import type { SeatEventSubscriptionFns } from "./seatEventSubscription";

type ItemCalculator = {
  getItemsToUpdate: typeof getItemsToUpdate;
  createItemsToAdd: typeof createItemsToAdd;
  prices: typeof prices;
};

export type SubscriptionService = {
  updateSubscriptionItems(params: {
    organizationId: string;
    plan: PlanType;
    upgradeMembers: boolean;
    upgradeTraces: boolean;
    totalMembers: number;
    totalTraces: number;
  }): Promise<{ success: boolean }>;

  createOrUpdateSubscription(params: {
    organizationId: string;
    baseUrl: string;
    plan: PlanType;
    membersToAdd?: number;
    tracesToAdd?: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: "monthly" | "annual";
  }): Promise<{ url: string | null }>;

  createBillingPortalSession(params: {
    customerId: string;
    baseUrl: string;
    organizationId: string;
  }): Promise<{ url: string }>;

  getLastNonCancelledSubscription(
    organizationId: string,
  ): Promise<Awaited<ReturnType<PrismaClient["subscription"]["findFirst"]>>>;

  previewProration(params: {
    organizationId: string;
    newTotalSeats: number;
  }): Promise<{
    formattedAmountDue: string;
    formattedRecurringTotal: string;
    billingInterval: string;
  }>;

  notifyProspective(params: {
    organizationId: string;
    plan: PlanType;
    customerName?: string;
    customerEmail?: string;
    note?: string;
    actorEmail: string;
  }): Promise<{ success: boolean }>;

  createSubscriptionWithInvites(params: {
    organizationId: string;
    baseUrl: string;
    membersToAdd: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: "monthly" | "annual";
    invites: Array<{ email: string; role: OrganizationUserRole }>;
  }): Promise<{ url: string | null }>;
};

export const createSubscriptionService = ({
  stripe,
  db,
  itemCalculator,
  seatEventFns,
}: {
  stripe: Stripe;
  db: PrismaClient;
  itemCalculator: ItemCalculator;
  seatEventFns?: SeatEventSubscriptionFns;
}): SubscriptionService => {
  const getLastNonCancelledSubscription = async (organizationId: string) => {
    return await db.subscription.findFirst({
      where: {
        organizationId,
        status: {
          not: SubscriptionStatus.CANCELLED,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  };

  return {
    async updateSubscriptionItems({
      organizationId,
      plan,
      totalMembers,
      totalTraces,
    }) {
      if (seatEventFns) {
        const org = await db.organization.findUnique({
          where: { id: organizationId },
          select: { pricingModel: true },
        });
        if (org?.pricingModel === "SEAT_EVENT") {
          return seatEventFns.updateSeatEventItems({
            organizationId,
            totalMembers,
          });
        }
      }

      const lastSubscription =
        await getLastNonCancelledSubscription(organizationId);

      if (
        lastSubscription &&
        lastSubscription.stripeSubscriptionId &&
        lastSubscription.status !== SubscriptionStatus.PENDING
      ) {
        const subscription = await stripe.subscriptions.retrieve(
          lastSubscription.stripeSubscriptionId,
        );

        const currentItems = subscription.items.data;

        const itemsToUpdate = itemCalculator.getItemsToUpdate({
          currentItems,
          plan,
          tracesToAdd: totalTraces,
          membersToAdd: totalMembers,
        });

        await stripe.subscriptions.update(
          lastSubscription.stripeSubscriptionId,
          { items: itemsToUpdate },
        );

        return { success: true };
      }

      return { success: false };
    },

    async createOrUpdateSubscription({
      organizationId,
      baseUrl,
      plan,
      membersToAdd = 0,
      tracesToAdd = 0,
      customerId,
      currency,
      billingInterval,
    }) {
      if (isGrowthSeatEventPlan(plan) && seatEventFns) {
        const org = await db.organization.findUnique({
          where: { id: organizationId },
          select: { pricingModel: true },
        });

        return seatEventFns.createSeatEventCheckout({
          organizationId,
          customerId,
          baseUrl,
          currency: currency ?? Currency.EUR,
          billingInterval: billingInterval ?? "monthly",
          membersToAdd,
          isUpgradeFromTiered: org?.pricingModel === "TIERED",
        });
      }

      const lastSubscription =
        await getLastNonCancelledSubscription(organizationId);

      if (
        lastSubscription &&
        lastSubscription.stripeSubscriptionId &&
        lastSubscription.status !== SubscriptionStatus.PENDING
      ) {
        if (plan === PlanTypes.FREE) {
          const response = await stripe.subscriptions.cancel(
            lastSubscription.stripeSubscriptionId,
          );

          if (response.status === "canceled") {
            await db.subscription.update({
              where: { id: lastSubscription.id },
              data: { status: SubscriptionStatus.CANCELLED },
            });
          }

          return { url: `${baseUrl}/settings/subscription` };
        }

        const currentStripeSubscription = await stripe.subscriptions.retrieve(
          lastSubscription.stripeSubscriptionId,
        );

        const itemsToUpdate = itemCalculator.getItemsToUpdate({
          currentItems: currentStripeSubscription.items.data,
          plan,
          tracesToAdd,
          membersToAdd,
        });

        const response = await stripe.subscriptions.update(
          lastSubscription.stripeSubscriptionId,
          { items: itemsToUpdate },
        );

        if (response.status === "active") {
          await db.subscription.update({
            where: { id: lastSubscription.id },
            data: { plan },
          });
        }

        return { url: `${baseUrl}/settings/subscription?success` };
      }

      if (plan === PlanTypes.FREE) {
        return { url: `${baseUrl}/settings/subscription` };
      }

      const itemsToAdd = itemCalculator.createItemsToAdd(
        plan,
        { quantity: tracesToAdd },
        { quantity: membersToAdd },
      );

      const subscription = await db.subscription.create({
        data: {
          organizationId,
          status: SubscriptionStatus.PENDING,
          plan,
        },
      });


      if (!isStripePriceName(plan as StripePriceName)) {
        throw new InvalidPlanError(plan);
      }
      
      itemsToAdd.push({
        price: itemCalculator.prices[plan as StripePriceName],
        quantity: 1,
      });

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        customer_update: {
          address: "auto",
          name: "auto",
        },
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        tax_id_collection: {
          enabled: true,
        },
        line_items: itemsToAdd,
        success_url: `${baseUrl}/settings/subscription?success`,
        cancel_url: `${baseUrl}/settings/subscription`,
        client_reference_id: `subscription_setup_${subscription.id}`,
        allow_promotion_codes: true,
      });

      return { url: session.url };
    },

    async createBillingPortalSession({ customerId, baseUrl, organizationId }) {
      if (seatEventFns && organizationId) {
        const org = await db.organization.findUnique({
          where: { id: organizationId },
          select: { pricingModel: true },
        });
        if (org?.pricingModel === "SEAT_EVENT") {
          return seatEventFns.seatEventBillingPortalUrl({
            customerId,
            baseUrl,
          });
        }
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/settings/subscription`,
      });

      return { url: session.url };
    },

    getLastNonCancelledSubscription,

    async previewProration({ organizationId, newTotalSeats }) {
      if (!seatEventFns) {
        throw new SeatBillingUnavailableError();
      }
      return seatEventFns.previewProration({ organizationId, newTotalSeats });
    },

    async createSubscriptionWithInvites({
      organizationId,
      baseUrl,
      membersToAdd,
      customerId,
      currency,
      billingInterval,
      invites,
    }) {
      if (!seatEventFns) {
        throw new SeatBillingUnavailableError();
      }

      // Resolve the first team in the org for deterministic team assignment
      const firstTeam = await db.team.findFirst({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      const teamIds = firstTeam?.id ?? "";

      const org = await db.organization.findUnique({
        where: { id: organizationId },
        select: { pricingModel: true },
      });

      return seatEventFns.createSeatEventCheckout({
        organizationId,
        customerId,
        baseUrl,
        currency: currency ?? Currency.EUR,
        billingInterval: billingInterval ?? "monthly",
        membersToAdd,
        isUpgradeFromTiered: org?.pricingModel === "TIERED",
        invites: invites.map((inv) => ({
          email: inv.email,
          role: inv.role,
          teamIds,
        })),
      });
    },

    async notifyProspective({
      organizationId,
      plan,
      customerName,
      customerEmail,
      note,
      actorEmail,
    }) {
      const organization = await db.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new OrganizationNotFoundError();
      }

      await notifySubscriptionEvent({
        type: "prospective",
        organizationId: organization.id,
        organizationName: organization.name,
        plan,
        customerName,
        customerEmail: customerEmail ?? actorEmail,
        note,
        actorEmail,
      });

      return { success: true };
    },
  };
};
