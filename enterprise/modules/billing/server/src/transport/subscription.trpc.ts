/**
 * The server half of `subscription.*`. Reading takes `organization:view`;
 * anything that changes what the organization pays takes `organization:manage`.
 * Nothing catches: every refusal below is a handled error the shared path maps.
 */
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import {
  subscriptionTrpc,
  UserEmailRequiredError,
  type BillingDisplayInvoice,
  type Currency,
  type SubscribablePlan,
  type SubscriptionBillingInterval,
  type SubscriptionInvite,
} from "@langwatch/enterprise-billing-contract";
import { featureApi } from "@langwatch/runtime-composition";
import { z } from "zod";

/** The customer this checkout is opened for, as the provider knows them. */
export type BillingSubscriber = Readonly<{ email?: string | null }>;

/**
 * What this surface asks of the application. Nothing is optional: a deployment
 * that composed no payment provider mounts no subscription router at all.
 */
export interface BillingSubscriptionApi {
  /** This organization's provider customer, created on first need. */
  getOrCreateCustomerId(input: {
    user: BillingSubscriber;
    organizationId: string;
  }): Promise<string>;
  updateSubscriptionItems(input: {
    organizationId: string;
    plan: SubscribablePlan;
    upgradeMembers: boolean;
    upgradeTraces: boolean;
    totalMembers: number;
    totalTraces: number;
    quotedAt?: number;
  }): Promise<{ success: boolean }>;
  createOrUpdateSubscription(input: {
    organizationId: string;
    baseUrl: string;
    plan: SubscribablePlan;
    membersToAdd?: number;
    tracesToAdd?: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: SubscriptionBillingInterval;
  }): Promise<{ url: string | null }>;
  createBillingPortalSession(input: {
    customerId: string;
    baseUrl: string;
    organizationId: string;
  }): Promise<{ url: string }>;
  /** The most recent subscription that has not been cancelled, or none. */
  findLastNonCancelledSubscription(input: { organizationId: string }): Promise<unknown>;
  previewProration(input: { organizationId: string; newTotalSeats: number }): Promise<unknown>;
  notifyProspective(input: {
    organizationId: string;
    plan: SubscribablePlan;
    customerName?: string;
    customerEmail?: string;
    note?: string;
    actorEmail: string;
  }): Promise<unknown>;
  createSubscriptionWithInvites(input: {
    organizationId: string;
    baseUrl: string;
    membersToAdd: number;
    customerId: string;
    currency?: Currency;
    billingInterval?: SubscriptionBillingInterval;
    invites: readonly SubscriptionInvite[];
  }): Promise<{ url: string | null }>;
  listInvoices(input: { organizationId: string }): Promise<BillingDisplayInvoice[]>;
}

export const BillingSubscriptionApi = featureApi<BillingSubscriptionApi>("billing");

/**
 * The signed-in customer's address, as the PROCESS resolved it. A fact rather
 * than part of the actor: the provider records the address on the customer it
 * creates, and an actor id alone cannot open an account.
 */
export const billingCallerEmailFact = defineTrpcFact("callerEmail", z.string().nullable());

export const subscriptionTrpcTransport = defineTrpcRouter(BillingSubscriptionApi, subscriptionTrpc)
  .procedure("addTeamMemberOrEvents")
  .withPermission("organization:manage")
  // Raises the seat and volume lines on a live subscription, priced at the
  // instant the customer was quoted.
  .handle(({ app, input }) =>
    app.updateSubscriptionItems({
      organizationId: input.organizationId,
      plan: input.plan,
      upgradeMembers: input.upgradeMembers,
      upgradeTraces: input.upgradeTraces,
      totalMembers: input.totalMembers,
      totalTraces: input.totalTraces,
      ...(input.quotedAt === undefined ? {} : { quotedAt: input.quotedAt }),
    }),
  )

  .procedure("create")
  .withFacts(billingCallerEmailFact)
  .withPermission("organization:manage")
  // Starts a checkout for an organization that has no subscription.
  .handle(async ({ app, input }, email) => {
    const customerId = await app.getOrCreateCustomerId({
      user: { email },
      organizationId: input.organizationId,
    });

    return app.createOrUpdateSubscription({
      organizationId: input.organizationId,
      baseUrl: input.baseUrl,
      plan: input.plan,
      customerId,
      ...(input.membersToAdd === undefined ? {} : { membersToAdd: input.membersToAdd }),
      ...(input.tracesToAdd === undefined ? {} : { tracesToAdd: input.tracesToAdd }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.billingInterval === undefined ? {} : { billingInterval: input.billingInterval }),
    });
  })

  .procedure("manage")
  .withFacts(billingCallerEmailFact)
  .withPermission("organization:manage")
  // A billing-portal session for card, address and cancellation.
  .handle(async ({ app, input }, email) => {
    const customerId = await app.getOrCreateCustomerId({
      user: { email },
      organizationId: input.organizationId,
    });

    return app.createBillingPortalSession({
      customerId,
      baseUrl: input.baseUrl,
      organizationId: input.organizationId,
    });
  })

  .procedure("previewProration")
  .withPermission("organization:manage")
  // What a seat change costs, before it is confirmed.
  .handle(({ app, input }) =>
    app.previewProration({
      organizationId: input.organizationId,
      newTotalSeats: input.newTotalSeats,
    }),
  )

  .procedure("getLastSubscription")
  .withPermission("organization:view")
  // The most recent subscription that has not been cancelled.
  .handle(({ app, input }) =>
    app.findLastNonCancelledSubscription({ organizationId: input.organizationId }),
  )

  .procedure("upgradeWithInvites")
  .withFacts(billingCallerEmailFact)
  .withPermission("organization:manage")
  // Checkout and the invitations that motivated it, as one act.
  .handle(async ({ app, input }, email) => {
    const customerId = await app.getOrCreateCustomerId({
      user: { email },
      organizationId: input.organizationId,
    });

    return app.createSubscriptionWithInvites({
      organizationId: input.organizationId,
      baseUrl: input.baseUrl,
      membersToAdd: input.totalSeats,
      customerId,
      invites: input.invites,
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.billingInterval === undefined ? {} : { billingInterval: input.billingInterval }),
    });
  })

  .procedure("prospective")
  .withFacts(billingCallerEmailFact)
  .withPermission("organization:manage")
  // Tells sales an organization asked about a plan that is not self-serve.
  .handle(({ app, input }, email) => {
    if (!email) throw new UserEmailRequiredError();

    return app.notifyProspective({
      organizationId: input.organizationId,
      plan: input.plan,
      actorEmail: email,
      ...(input.customerName === undefined ? {} : { customerName: input.customerName }),
      ...(input.customerEmail === undefined ? {} : { customerEmail: input.customerEmail }),
      ...(input.note === undefined ? {} : { note: input.note }),
    });
  })

  .procedure("listInvoices")
  .withPermission("organization:view")
  // The organization's invoices, for the billing page.
  .handle(({ app, input }) => app.listInvoices({ organizationId: input.organizationId }))
  .build();
