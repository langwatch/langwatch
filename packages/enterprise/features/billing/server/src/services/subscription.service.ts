import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";
import {
  Currency,
  InvalidPlanError,
  isGrowthSeatEventPlan,
  isStripePriceName,
  OrganizationNotFoundError,
  type PlanTypes as PlanType,
  PlanTypes,
  SeatBillingUnavailableError,
  stripePricesFile,
  type StripePriceName,
  SubscriptionCreationFailedError,
  SubscriptionStatus,
  type BillingInterval,
} from "@langwatch/enterprise-billing-contract";
import { StripeErrorAdapter } from "../adapters/stripe-error.stripe-error.adapter";
import type { BillingOrganizationPort } from "../ports/organization.port";
import type { BillingSubscriptionNotifierPort } from "../ports/subscription-notifier.port";
import type {
  BillingSubscriptionRecord,
  BillingSubscriptionRepository,
} from "../ports/subscription.port";
import { SeatEventSubscriptionService } from "./seat-event-subscription.service";
import {
  SubscriptionItemCalculatorService,
  type SubscriptionItemUpdate,
} from "./subscription-item-calculator.service";

const logger = createLogger("langwatch:billing:subscriptionService");

export const RECENT_INVOICES_LIMIT = 4;

export type BillingDisplayInvoice = {
  id: string;
  number: string | null;
  date: number;
  amountDue: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
};

/**
 * Enterprise Stripe subscription lifecycle. Provider, persistence, and
 * application notification delivery are all injected; importing this module
 * never creates clients, reads configuration, or touches application globals.
 */
export class BillingSubscriptionService {
  private readonly stripeErrors = StripeErrorAdapter.create();

  private constructor(
    private readonly repository: BillingSubscriptionRepository,
    private readonly organizationRepository: BillingOrganizationPort,
    private readonly stripe: Stripe,
    private readonly itemCalculator: SubscriptionItemCalculatorService,
    private readonly seatEventService: SeatEventSubscriptionService | undefined,
    private readonly notifier: BillingSubscriptionNotifierPort,
  ) {}

  static create(options: {
    repository: BillingSubscriptionRepository;
    organizationRepository: BillingOrganizationPort;
    stripe: Stripe;
    itemCalculator: SubscriptionItemCalculatorService;
    seatEventService?: SeatEventSubscriptionService;
    notifier: BillingSubscriptionNotifierPort;
  }): BillingSubscriptionService {
    return new BillingSubscriptionService(
      options.repository,
      options.organizationRepository,
      options.stripe,
      options.itemCalculator,
      options.seatEventService,
      options.notifier,
    );
  }

  async getLastNonCancelledSubscription(
    organizationId: string,
  ): Promise<BillingSubscriptionRecord | null> {
    return this.repository.tryFindLastNonCancelled(organizationId);
  }

  async updateSubscriptionItems({
    organizationId,
    plan,
    upgradeMembers,
    upgradeTraces,
    totalMembers,
    totalTraces,
    quotedAt,
  }: {
    organizationId: string;
    plan: PlanType;
    upgradeMembers: boolean;
    upgradeTraces: boolean;
    totalMembers: number;
    totalTraces: number;
    quotedAt?: number;
  }): Promise<{ success: boolean }> {
    const effectiveMembers = upgradeMembers ? totalMembers : 0;
    const effectiveTraces = upgradeTraces ? totalTraces : 0;

    if (this.seatEventService) {
      const pricingModel =
        await this.organizationRepository.tryGetPricingModel(organizationId);
      if (pricingModel === "SEAT_EVENT") {
        return this.seatEventService.updateSeatEventItems({
          organizationId,
          totalMembers: effectiveMembers,
          quotedAt,
        });
      }
    }

    const lastSubscription =
      await this.repository.tryFindLastNonCancelled(organizationId);

    if (
      lastSubscription?.stripeSubscriptionId &&
      lastSubscription.status !== SubscriptionStatus.PENDING
    ) {
      const subscription = await this.stripe.subscriptions.retrieve(
        lastSubscription.stripeSubscriptionId,
      );
      const itemsToUpdate = this.itemCalculator.getItemsToUpdate({
        currentItems: subscription.items.data,
        plan,
        tracesToAdd: effectiveTraces,
        membersToAdd: effectiveMembers,
      });
      await this.stripe.subscriptions.update(lastSubscription.stripeSubscriptionId, {
        items: itemsToUpdate,
      });
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
    if (isGrowthSeatEventPlan(plan) && this.seatEventService) {
      const pricingModel =
        await this.organizationRepository.tryGetPricingModel(organizationId);
      return this.seatEventService.createSeatEventCheckout({
        organizationId,
        customerId,
        baseUrl,
        currency: currency ?? Currency.EUR,
        billingInterval: billingInterval ?? "monthly",
        membersToAdd,
        isUpgradeFromTiered: pricingModel === "TIERED",
      });
    }

    const lastSubscription =
      await this.repository.tryFindLastNonCancelled(organizationId);
    if (
      lastSubscription?.stripeSubscriptionId &&
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
    if (this.seatEventService) {
      const pricingModel =
        await this.organizationRepository.tryGetPricingModel(organizationId);
      if (pricingModel === "SEAT_EVENT") {
        return this.seatEventService.seatEventBillingPortalUrl({
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
    amountDueCents: number;
    formattedAmountDue: string;
    formattedCreditApplied: string | null;
    formattedRecurringTotal: string;
    billingInterval: string;
    quotedAt: number;
  }> {
    if (!this.seatEventService) throw new SeatBillingUnavailableError();
    return this.seatEventService.previewProration({
      organizationId,
      newTotalSeats,
    });
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
    invites: Array<{ email: string; role: string }>;
  }): Promise<{ url: string | null }> {
    if (!this.seatEventService) throw new SeatBillingUnavailableError();
    const teamId = (await this.organizationRepository.tryFindFirstTeamId(organizationId)) ?? "";
    const pricingModel =
      await this.organizationRepository.tryGetPricingModel(organizationId);
    return this.seatEventService.createSeatEventCheckout({
      organizationId,
      customerId,
      baseUrl,
      currency: currency ?? Currency.EUR,
      billingInterval: billingInterval ?? "monthly",
      membersToAdd,
      isUpgradeFromTiered: pricingModel === "TIERED",
      invites: invites.map((invite) => ({
        email: invite.email,
        role: invite.role,
        teamIds: teamId,
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
    const organization = await this.organizationRepository.tryFindName(organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    await this.notifier.send({
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

  async listInvoices({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BillingDisplayInvoice[]> {
    const stripeCustomerId =
      await this.organizationRepository.tryGetStripeCustomerId(organizationId);
    if (!stripeCustomerId) return [];

    let invoices: Stripe.ApiList<Stripe.Invoice>;
    try {
      invoices = await this.stripe.invoices.list({
        customer: stripeCustomerId,
        limit: RECENT_INVOICES_LIMIT,
      });
    } catch (error) {
      throw this.stripeErrors.translate(error);
    }

    return invoices.data
      .filter((invoice) => invoice.status !== "draft")
      .map((invoice) => ({
        id: invoice.id,
        number: invoice.number ?? null,
        date: invoice.created,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        status: invoice.status ?? "unknown",
        pdfUrl: invoice.invoice_pdf ?? null,
        hostedUrl: invoice.hosted_invoice_url ?? null,
      }));
  }

  private async cancelSubscription({
    stripeSubscriptionId,
    subscriptionId,
    baseUrl,
  }: {
    stripeSubscriptionId: string;
    subscriptionId: string;
    baseUrl: string;
  }): Promise<{ url: string | null }> {
    const response = await this.stripe.subscriptions.cancel(stripeSubscriptionId);
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
    const current = await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
    const itemsToUpdate = this.itemCalculator.getItemsToUpdate({
      currentItems: current.items.data,
      plan,
      tracesToAdd,
      membersToAdd,
    });
    const response = await this.stripe.subscriptions.update(stripeSubscriptionId, {
      items: itemsToUpdate,
    });
    if (response.status === "active") {
      await this.repository.updatePlan({ id: subscriptionId, plan });
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
      logger.error(
        { organizationId, plan },
        "[billing] Plan has no price in the Stripe price catalog",
      );
      throw new InvalidPlanError(plan);
    }
    const itemsToAdd: SubscriptionItemUpdate[] = this.itemCalculator.createItemsToAdd(
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
    if (!subscription) throw new SubscriptionCreationFailedError();

    const basePriceId = this.itemCalculator.prices[plan as StripePriceName];
    const rawCurrency = stripePricesFile.prices[basePriceId]?.currency?.toLowerCase();
    const checkoutCurrency =
      rawCurrency === "usd" || rawCurrency === "eur" ? rawCurrency : "usd";
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      currency: checkoutCurrency,
      ...({ adaptive_pricing: { enabled: false } } as Record<string, unknown>),
      customer: customerId,
      customer_update: { address: "auto", name: "auto" },
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      line_items: itemsToAdd,
      success_url: `${baseUrl}/settings/subscription?success`,
      cancel_url: `${baseUrl}/settings/subscription`,
      client_reference_id: `subscription_setup_${subscription.id}`,
      allow_promotion_codes: true,
    });
    return { url: session.url };
  }
}
