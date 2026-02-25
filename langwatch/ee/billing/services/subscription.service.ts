import { Currency, type OrganizationUserRole, type PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import type { SubscriptionService } from "../../../src/server/app-layer/subscription/subscription.service";
import type { SubscriptionRepository } from "../../../src/server/app-layer/subscription/subscription.repository";
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
import { isGrowthSeatEventPlan, type BillingInterval } from "../utils/growthSeatEvent";
import type { SeatEventSubscriptionFns } from "./seatEventSubscription";
import { PrismaSubscriptionRepository } from "./subscription.repository";

type ItemCalculator = {
  getItemsToUpdate: typeof getItemsToUpdate;
  createItemsToAdd: typeof createItemsToAdd;
  prices: typeof prices;
};

/**
 * EE (SaaS) implementation of {@link SubscriptionService}.
 * Manages Stripe subscription lifecycle: checkouts, upgrades, cancellations, billing portal.
 *
 * Uses {@link SubscriptionRepository} for subscription-table operations and direct
 * prisma calls for organization/team lookups (following the same pattern as DatasetService).
 */
export class EESubscriptionService implements SubscriptionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: SubscriptionRepository,
    private readonly stripe: Stripe,
    private readonly itemCalculator: ItemCalculator,
    private readonly seatEventFns?: SeatEventSubscriptionFns,
  ) {}

  /**
   * Factory method that wires up the Prisma repository automatically.
   */
  static create({
    stripe,
    db,
    itemCalculator,
    seatEventFns,
  }: {
    stripe: Stripe;
    db: PrismaClient;
    itemCalculator: ItemCalculator;
    seatEventFns?: SeatEventSubscriptionFns;
  }): EESubscriptionService {
    const repository = new PrismaSubscriptionRepository(db);
    return new EESubscriptionService(db, repository, stripe, itemCalculator, seatEventFns);
  }

  async getLastNonCancelledSubscription(organizationId: string) {
    return await this.repository.findLastNonCancelled(organizationId);
  }

  async updateSubscriptionItems({
    organizationId,
    plan,
    upgradeMembers,
    upgradeTraces,
    totalMembers,
    totalTraces,
  }: {
    organizationId: string;
    plan: PlanType;
    upgradeMembers: boolean;
    upgradeTraces: boolean;
    totalMembers: number;
    totalTraces: number;
  }): Promise<{ success: boolean }> {
    const effectiveMembers = upgradeMembers ? totalMembers : 0;
    const effectiveTraces = upgradeTraces ? totalTraces : 0;

    if (this.seatEventFns) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { pricingModel: true },
      });
      if (org?.pricingModel === "SEAT_EVENT") {
        return this.seatEventFns.updateSeatEventItems({
          organizationId,
          totalMembers: effectiveMembers,
        });
      }
    }

    const lastSubscription =
      await this.repository.findLastNonCancelled(organizationId);

    if (
      lastSubscription &&
      lastSubscription.stripeSubscriptionId &&
      lastSubscription.status !== SubscriptionStatus.PENDING
    ) {
      const subscription = await this.stripe.subscriptions.retrieve(
        lastSubscription.stripeSubscriptionId,
      );

      const currentItems = subscription.items.data;

      const itemsToUpdate = this.itemCalculator.getItemsToUpdate({
        currentItems,
        plan,
        tracesToAdd: effectiveTraces,
        membersToAdd: effectiveMembers,
      });

      await this.stripe.subscriptions.update(
        lastSubscription.stripeSubscriptionId,
        { items: itemsToUpdate },
      );

      return { success: true };
    }

    return { success: false };
  }

  async createOrUpdateSubscription({
    organizationId,
    baseUrl,
    plan,
    membersToAdd = 0,
    tracesToAdd = 0,
    customerId,
    currency,
    billingInterval,
  }: {
    organizationId: string;
    baseUrl: string;
    plan: PlanType;
    membersToAdd?: number;
    tracesToAdd?: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: BillingInterval;
  }): Promise<{ url: string | null }> {
    if (isGrowthSeatEventPlan(plan) && this.seatEventFns) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { pricingModel: true },
      });

      return this.seatEventFns.createSeatEventCheckout({
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
      await this.repository.findLastNonCancelled(organizationId);

    if (
      lastSubscription &&
      lastSubscription.stripeSubscriptionId &&
      lastSubscription.status !== SubscriptionStatus.PENDING
    ) {
      if (plan === PlanTypes.FREE) {
        return this.cancelSubscription({
          stripeSubscriptionId: lastSubscription.stripeSubscriptionId,
          subscriptionId: lastSubscription.id,
          baseUrl,
        });
      }

      return this.upgradeSubscription({
        stripeSubscriptionId: lastSubscription.stripeSubscriptionId,
        subscriptionId: lastSubscription.id,
        plan,
        tracesToAdd,
        membersToAdd,
        baseUrl,
      });
    }

    if (plan === PlanTypes.FREE) {
      return { url: `${baseUrl}/settings/subscription` };
    }

    return this.createNewCheckout({
      organizationId,
      plan,
      tracesToAdd,
      membersToAdd,
      customerId,
      baseUrl,
    });
  }

  async createBillingPortalSession({
    customerId,
    baseUrl,
    organizationId,
  }: {
    customerId: string;
    baseUrl: string;
    organizationId: string;
  }): Promise<{ url: string }> {
    if (this.seatEventFns && organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { pricingModel: true },
      });
      if (org?.pricingModel === "SEAT_EVENT") {
        return this.seatEventFns.seatEventBillingPortalUrl({
          customerId,
          baseUrl,
        });
      }
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/settings/subscription`,
    });

    return { url: session.url };
  }

  async previewProration({
    organizationId,
    newTotalSeats,
  }: {
    organizationId: string;
    newTotalSeats: number;
  }): Promise<{
    formattedAmountDue: string;
    formattedRecurringTotal: string;
    billingInterval: string;
  }> {
    if (!this.seatEventFns) {
      throw new SeatBillingUnavailableError();
    }
    return this.seatEventFns.previewProration({ organizationId, newTotalSeats });
  }

  async createSubscriptionWithInvites({
    organizationId,
    baseUrl,
    membersToAdd,
    customerId,
    currency,
    billingInterval,
    invites,
  }: {
    organizationId: string;
    baseUrl: string;
    membersToAdd: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: BillingInterval;
    invites: Array<{ email: string; role: OrganizationUserRole }>;
  }): Promise<{ url: string | null }> {
    if (!this.seatEventFns) {
      throw new SeatBillingUnavailableError();
    }

    const firstTeam = await this.prisma.team.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    const teamIds = firstTeam?.id ?? "";

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });

    return this.seatEventFns.createSeatEventCheckout({
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
  }

  async notifyProspective({
    organizationId,
    plan,
    customerName,
    customerEmail,
    note,
    actorEmail,
  }: {
    organizationId: string;
    plan: PlanType;
    customerName?: string;
    customerEmail?: string;
    note?: string;
    actorEmail: string;
  }): Promise<{ success: boolean }> {
    const organization = await this.prisma.organization.findUnique({
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
  }

  // ---------------------------------------------------------------------------
  // Private helpers extracted from createOrUpdateSubscription
  // ---------------------------------------------------------------------------

  private async cancelSubscription({
    stripeSubscriptionId,
    subscriptionId,
    baseUrl,
  }: {
    stripeSubscriptionId: string;
    subscriptionId: string;
    baseUrl: string;
  }): Promise<{ url: string | null }> {
    const response = await this.stripe.subscriptions.cancel(
      stripeSubscriptionId,
    );

    if (response.status === "canceled") {
      await this.repository.updateStatus({
        id: subscriptionId,
        status: SubscriptionStatus.CANCELLED,
      });
    }

    return { url: `${baseUrl}/settings/subscription` };
  }

  private async upgradeSubscription({
    stripeSubscriptionId,
    subscriptionId,
    plan,
    tracesToAdd,
    membersToAdd,
    baseUrl,
  }: {
    stripeSubscriptionId: string;
    subscriptionId: string;
    plan: PlanType;
    tracesToAdd: number;
    membersToAdd: number;
    baseUrl: string;
  }): Promise<{ url: string | null }> {
    const currentStripeSubscription = await this.stripe.subscriptions.retrieve(
      stripeSubscriptionId,
    );

    const itemsToUpdate = this.itemCalculator.getItemsToUpdate({
      currentItems: currentStripeSubscription.items.data,
      plan,
      tracesToAdd,
      membersToAdd,
    });

    const response = await this.stripe.subscriptions.update(
      stripeSubscriptionId,
      { items: itemsToUpdate },
    );

    if (response.status === "active") {
      await this.repository.updatePlan({
        id: subscriptionId,
        plan,
      });
    }

    return { url: `${baseUrl}/settings/subscription?success` };
  }

  private async createNewCheckout({
    organizationId,
    plan,
    tracesToAdd,
    membersToAdd,
    customerId,
    baseUrl,
  }: {
    organizationId: string;
    plan: PlanType;
    tracesToAdd: number;
    membersToAdd: number;
    customerId: string;
    baseUrl: string;
  }): Promise<{ url: string | null }> {
    if (!isStripePriceName(plan as StripePriceName)) {
      throw new InvalidPlanError(plan);
    }

    const itemsToAdd = this.itemCalculator.createItemsToAdd(
      plan,
      { quantity: tracesToAdd },
      { quantity: membersToAdd },
    );

    itemsToAdd.push({
      price: this.itemCalculator.prices[plan as StripePriceName],
      quantity: 1,
    });

    const subscription = await this.repository.createPending({
      organizationId,
      plan,
    });

    const session = await this.stripe.checkout.sessions.create({
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
  }
}
