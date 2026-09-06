/**
 * An organization's paid subscription over the process's tRPC transport.
 *
 *   addTeamMemberOrEvents: raises the seat and volume lines on a live
 *                          subscription, priced at the instant the customer was
 *                          quoted.
 *   create:                starts a checkout for an organization that has none.
 *   manage:                a Stripe billing-portal session for card, address
 *                          and cancellation.
 *   previewProration:      what a seat change costs before it is confirmed.
 *   getLastSubscription:   the most recent non-cancelled subscription.
 *   upgradeWithInvites:    checkout and the invitations that motivated it, as
 *                          one act.
 *   prospective:           tells sales an organization asked about a plan that
 *                          is not self-serve.
 *   listInvoices:          the organization's invoices, for the billing page.
 *
 * Reading takes `organization:view`; anything that changes what the
 * organization pays takes `organization:manage`.
 *
 * SaaS-only: the services are absent on a self-hosted installation, and this
 * surface says so plainly rather than pretending to bill.
 *
 * No billing-specific error middleware: every error the services raise is a
 * `HandledError`, so the shared handled-error middleware maps it to the right
 * tRPC code and keeps the error as the `cause`. The middleware this replaced
 * re-threw a bare `TRPCError` with no cause, which is what turned every 5xx
 * billing failure into "An unknown error occurred".
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import {
  billingDisplayInvoiceSchema,
  type BillingDisplayInvoice,
  billingPortalSessionSchema,
  billingRedirectSchema,
  Currency,
  SUBSCRIBABLE_PLANS,
  subscriptionItemsUpdatedSchema,
  UserEmailRequiredError,
  type PlanTypes as PlanType,
} from "@langwatch/enterprise-billing-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/**
 * The two billing collaborators, each narrowed to what this surface calls.
 * Both are optional because a self-hosted installation composes neither.
 */
type BillingApplication = Readonly<{
  billingCustomer?: {
    getOrCreateCustomerId(params: {
      user: { email?: string | null };
      organizationId: string;
    }): Promise<string>;
  };
  subscription?: {
    updateSubscriptionItems(params: {
      organizationId: string;
      plan: string;
      upgradeMembers: boolean;
      upgradeTraces: boolean;
      totalMembers: number;
      totalTraces: number;
      quotedAt?: number;
    }): Promise<{ success: boolean }>;
    createOrUpdateSubscription(params: {
      organizationId: string;
      baseUrl: string;
      plan: string;
      membersToAdd?: number;
      tracesToAdd?: number;
      customerId: string;
      currency?: string;
      billingInterval?: string;
    }): Promise<{ url: string | null }>;
    createBillingPortalSession(params: {
      customerId: string;
      baseUrl: string;
      organizationId: string;
    }): Promise<{ url: string }>;
    tryGetLastNonCancelledSubscription(organizationId: string): Promise<unknown>;
    previewProration(params: { organizationId: string; newTotalSeats: number }): Promise<unknown>;
    notifyProspective(params: {
      organizationId: string;
      plan: string;
      customerName?: string;
      customerEmail?: string;
      note?: string;
      actorEmail: string;
    }): Promise<unknown>;
    createSubscriptionWithInvites(params: {
      organizationId: string;
      baseUrl: string;
      membersToAdd: number;
      customerId: string;
      currency?: string;
      billingInterval?: string;
      invites: { email: string; role: string }[];
    }): Promise<{ url: string | null }>;
    listInvoices(params: { organizationId: string }): Promise<BillingDisplayInvoice[]>;
  };
}>;

/** The process supplies authentication; authorization arrives as a policy. */
export type SubscriptionTrpcContext = Readonly<{
  app: BillingApplication;
  actor(): Readonly<{ id: string }>;
  session: Readonly<{ user: Readonly<{ email?: string | null }> }> | null;
}>;

type SubscriptionTrpcProcedures<
  TContext extends SubscriptionTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission, applied AFTER this feature's own
   * input parser so the check reads its organization id from validated input.
   */
  policy(permission: "organization:view" | "organization:manage"): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

const subscriptionPlanEnum = z.enum(SUBSCRIBABLE_PLANS);

/** Installs the complete `subscription.*` tRPC surface on a process root. */
export class SubscriptionTrpcApi {
  static create<
    TContext extends SubscriptionTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SubscriptionTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    /**
     * A plain `Error`, not a handled one: an installation reaching a billing
     * mutation with no Stripe composed is a deployment fault the caller can do
     * nothing about, so it degrades to an unknown error carrying a trace id.
     */
    const requireSaasBilling = (app: TContext["app"]) => {
      const { billingCustomer, subscription } = app;
      if (!billingCustomer || !subscription) {
        throw new Error("SaaS billing is not configured");
      }
      return { customerService: billingCustomer, subscriptionService: subscription };
    };

    /**
     * The signed-in customer, as Stripe knows them. `actor()` is the process's
     * refusal for a request carrying no caller and throws before the fallback
     * can be reached.
     */
    const callerOf = (ctx: SubscriptionTrpcContext): { email?: string | null } => {
      ctx.actor();
      return ctx.session?.user ?? {};
    };

    /**
     * Three of these answer the provider's own object, unchanged. Naming its
     * shape here would be this package describing Stripe's, and it would drift
     * the first time Stripe adds a field.
     */
    const PROVIDER_OWNED = "answers the billing provider's own object, unchanged";

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .mutation("addTeamMemberOrEvents", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              plan: subscriptionPlanEnum,
              upgradeMembers: z.boolean(),
              upgradeTraces: z.boolean(),
              totalMembers: z.number(),
              totalTraces: z.number(),
              // Echoed back from `previewProration` so the charge prices the
              // same instant the customer was quoted. Optional: a caller that
              // never showed a quote is priced at the moment they run.
              quotedAt: z.number().int().positive().optional(),
            }),
          )
          .withOutput(subscriptionItemsUpdatedSchema)
          .withPermission("organization:manage")
          /**
           * Raises the seat and volume lines on a live subscription, priced at
           * the instant the customer was quoted.
           */
          .handle(async ({ input, ctx }) => {
            const { subscriptionService } = requireSaasBilling(ctx.app);
            return subscriptionService.updateSubscriptionItems({
              organizationId: input.organizationId,
              plan: input.plan as PlanType,
              upgradeMembers: input.upgradeMembers,
              upgradeTraces: input.upgradeTraces,
              totalMembers: input.totalMembers,
              totalTraces: input.totalTraces,
              quotedAt: input.quotedAt,
            });
          }),
      )
      .mutation("create", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              baseUrl: z.string(),
              plan: subscriptionPlanEnum,
              membersToAdd: z.number().optional(),
              tracesToAdd: z.number().optional(),
              currency: z.nativeEnum(Currency).optional(),
              billingInterval: z.enum(["monthly", "annual"]).optional(),
            }),
          )
          .withOutput(billingRedirectSchema)
          .withPermission("organization:manage")
          /** Starts a checkout for an organization that has no subscription. */
          .handle(async ({ input, ctx }) => {
            const { customerService, subscriptionService } = requireSaasBilling(ctx.app);
            const customerId = await customerService.getOrCreateCustomerId({
              user: callerOf(ctx),
              organizationId: input.organizationId,
            });

            return subscriptionService.createOrUpdateSubscription({
              organizationId: input.organizationId,
              baseUrl: input.baseUrl,
              plan: input.plan as PlanType,
              membersToAdd: input.membersToAdd,
              tracesToAdd: input.tracesToAdd,
              customerId,
              currency: input.currency,
              billingInterval: input.billingInterval,
            });
          }),
      )
      .mutation("manage", (p) =>
        p
          .withInput(z.object({ organizationId: z.string(), baseUrl: z.string() }))
          .withOutput(billingPortalSessionSchema)
          .withPermission("organization:manage")
          /** A billing-portal session for card, address and cancellation. */
          .handle(async ({ input, ctx }) => {
            const { customerService, subscriptionService } = requireSaasBilling(ctx.app);
            const customerId = await customerService.getOrCreateCustomerId({
              user: callerOf(ctx),
              organizationId: input.organizationId,
            });

            return subscriptionService.createBillingPortalSession({
              customerId,
              baseUrl: input.baseUrl,
              organizationId: input.organizationId,
            });
          }),
      )
      .query("previewProration", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              newTotalSeats: z.number().min(1),
            }),
          )
          .withoutOutput(PROVIDER_OWNED)
          .withPermission("organization:manage")
          /** What a seat change costs, before it is confirmed. */
          .handle(async ({ input, ctx }) => {
            const { subscriptionService } = requireSaasBilling(ctx.app);
            return subscriptionService.previewProration({
              organizationId: input.organizationId,
              newTotalSeats: input.newTotalSeats,
            });
          }),
      )
      .query("getLastSubscription", (p) =>
        p
          .withInput(z.object({ organizationId: z.string() }))
          .withoutOutput(PROVIDER_OWNED)
          .withPermission("organization:view")
          /** The most recent subscription that has not been cancelled. */
          .handle(async ({ input, ctx }) => {
            const { subscriptionService } = requireSaasBilling(ctx.app);
            return subscriptionService.tryGetLastNonCancelledSubscription(input.organizationId);
          }),
      )
      .mutation("upgradeWithInvites", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              baseUrl: z.string(),
              currency: z.nativeEnum(Currency).optional(),
              billingInterval: z.enum(["monthly", "annual"]).optional(),
              totalSeats: z.number().min(1),
              invites: z.array(
                z.object({
                  email: z.string().email(),
                  role: z.enum(["ADMIN", "MEMBER", "EXTERNAL"]),
                }),
              ),
            }),
          )
          .withOutput(billingRedirectSchema)
          .withPermission("organization:manage")
          /** Checkout and the invitations that motivated it, as one act. */
          .handle(async ({ input, ctx }) => {
            const { customerService, subscriptionService } = requireSaasBilling(ctx.app);
            const customerId = await customerService.getOrCreateCustomerId({
              user: callerOf(ctx),
              organizationId: input.organizationId,
            });

            return subscriptionService.createSubscriptionWithInvites({
              organizationId: input.organizationId,
              baseUrl: input.baseUrl,
              membersToAdd: input.totalSeats,
              customerId,
              currency: input.currency,
              billingInterval: input.billingInterval,
              invites: input.invites,
            });
          }),
      )
      .mutation("prospective", (p) =>
        p
          .withInput(
            z.object({
              organizationId: z.string(),
              plan: subscriptionPlanEnum,
              customerName: z.string().optional(),
              customerEmail: z.string().email().optional(),
              note: z.string().optional(),
            }),
          )
          .withoutOutput(
            "the notification channel's own acknowledgement; nothing on this surface reads it",
          )
          .withPermission("organization:manage")
          /** Tells sales an organization asked about a plan that is not self-serve. */
          .handle(async ({ input, ctx }) => {
            const { subscriptionService } = requireSaasBilling(ctx.app);
            const actorEmail = callerOf(ctx).email;
            if (!actorEmail) {
              throw new UserEmailRequiredError();
            }

            return subscriptionService.notifyProspective({
              organizationId: input.organizationId,
              plan: input.plan as PlanType,
              customerName: input.customerName,
              customerEmail: input.customerEmail,
              note: input.note,
              actorEmail,
            });
          }),
      )
      .query("listInvoices", (p) =>
        p
          .withInput(z.object({ organizationId: z.string() }))
          .withOutput(billingDisplayInvoiceSchema.array())
          .withPermission("organization:view")
          /** The organization's invoices, for the billing page. */
          .handle(async ({ input, ctx }) => {
            const { subscriptionService } = requireSaasBilling(ctx.app);
            return subscriptionService.listInvoices({ organizationId: input.organizationId });
          }),
      )
      .build();
  }
}
