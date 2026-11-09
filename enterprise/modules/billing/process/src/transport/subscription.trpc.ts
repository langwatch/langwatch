/**
 * The server half of `subscription.*`. Reading takes `organization:view`, starting a
 * subscription `subscription:upgrade` (every member); changing a live one, its portal and its
 * invoices take `subscription:manage`, which administrators and the Billing role hold.
 */
import {
  defineMiddlewareContext,
  defineTrpcRouter,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import {
  subscriptionTrpc,
  billingCallerEmailSchema,
  type BillingDisplayInvoice,
  type Currency,
  type DeveloperSeatQuote,
  type DeveloperSeats,
  type SubscribablePlan,
  type SubscriptionBillingInterval,
} from "@langwatch/enterprise-billing-contract";
import { moduleApi } from "@langwatch/module";

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
    /** Who opened the checkout; given the Billing role when it completes. */
    startedByUserId?: string;
    retentionDays?: number;
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
    /** The caller's own address; an account without one is refused by name. */
    actorEmail: string | null;
  }): Promise<unknown>;
  listInvoices(input: { organizationId: string }): Promise<BillingDisplayInvoice[]>;
  /** Developer seats the subscription bills, and whether a price is configured to sell more. */
  developerSeats(input: { organizationId: string }): Promise<DeveloperSeats>;
  previewDeveloperSeats(input: {
    organizationId: string;
    quantity: number;
  }): Promise<DeveloperSeatQuote>;
  setDeveloperSeats(input: {
    organizationId: string;
    quantity: number;
    quotedAt?: number;
  }): Promise<{ success: boolean }>;
}

export const BillingSubscriptionApi = moduleApi<BillingSubscriptionApi>()("billing");

/**
 * The signed-in customer's address, as the PROCESS resolved it. Middleware
 * context rather than part of the actor: the provider records the address on the customer it
 * creates, and an actor id alone cannot open an account.
 */
export const billingCallerEmailContext = defineMiddlewareContext(
  "callerEmail",
  billingCallerEmailSchema,
);

export const subscriptionTrpcTransport: TrpcRouterDeclaration<
  BillingSubscriptionApi,
  typeof subscriptionTrpc
> = defineTrpcRouter(BillingSubscriptionApi, subscriptionTrpc)
  .procedure("addTeamMemberOrEvents")
  .withPermission("subscription:manage")
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
  .withMiddlewareContext(billingCallerEmailContext)
  .withPermission("subscription:upgrade")
  // Starts a checkout; a live subscription is refused, the portal changes that one.
  .handle(async ({ app, input, actor }, email) => {
    const customerId = await app.getOrCreateCustomerId({
      user: { email },
      organizationId: input.organizationId,
    });

    return app.createOrUpdateSubscription({
      ...(actor.type === "user" ? { startedByUserId: actor.id } : {}),
      organizationId: input.organizationId,
      baseUrl: input.baseUrl,
      plan: input.plan,
      customerId,
      ...(input.membersToAdd === undefined ? {} : { membersToAdd: input.membersToAdd }),
      ...(input.tracesToAdd === undefined ? {} : { tracesToAdd: input.tracesToAdd }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.billingInterval === undefined ? {} : { billingInterval: input.billingInterval }),
      ...(input.retentionDays === undefined ? {} : { retentionDays: input.retentionDays }),
    });
  })

  .procedure("manage")
  .withMiddlewareContext(billingCallerEmailContext)
  .withPermission("subscription:manage")
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
  .withPermission("subscription:manage")
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

  .procedure("prospective")
  .withMiddlewareContext(billingCallerEmailContext)
  .withPermission("subscription:manage")
  // Tells sales an organization asked about a plan that is not self-serve.
  .handle(({ app, input }, email) =>
    app.notifyProspective({
      organizationId: input.organizationId,
      plan: input.plan,
      actorEmail: email,
      ...(input.customerName === undefined ? {} : { customerName: input.customerName }),
      ...(input.customerEmail === undefined ? {} : { customerEmail: input.customerEmail }),
      ...(input.note === undefined ? {} : { note: input.note }),
    }),
  )

  .procedure("developerSeats")
  .withPermission("organization:view")
  // Developer seats billed, and whether a configured price sells more.
  .handle(({ app, input }) => app.developerSeats({ organizationId: input.organizationId }))

  .procedure("previewDeveloperSeats")
  .withPermission("organization:manage")
  // What a Developer seat change costs, before it is confirmed.
  .handle(({ app, input }) =>
    app.previewDeveloperSeats({ organizationId: input.organizationId, quantity: input.quantity }),
  )

  .procedure("setDeveloperSeats")
  .withPermission("organization:manage")
  // Sets the Developer seat line, priced at the instant the customer was quoted.
  .handle(({ app, input }) =>
    app.setDeveloperSeats({
      organizationId: input.organizationId,
      quantity: input.quantity,
      ...(input.quotedAt === undefined ? {} : { quotedAt: input.quotedAt }),
    }),
  )

  .procedure("listInvoices")
  .withPermission("subscription:manage")
  // The organization's invoices, for the billing page.
  .handle(({ app, input }) => app.listInvoices({ organizationId: input.organizationId }))
  .build();
