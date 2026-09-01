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
import {
  Currency,
  SUBSCRIBABLE_PLANS,
  UserEmailRequiredError,
  type PlanTypes as PlanType,
} from "@langwatch/enterprise-billing-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { BillingDisplayInvoice } from "../../services/subscription.service";

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
    getLastNonCancelledSubscription(organizationId: string): Promise<unknown>;
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
  policy(
    permission: "organization:view" | "organization:manage",
  ): <TProcedure>(procedure: TProcedure) => TProcedure;
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
    const { protected: procedure, policy } = procedures;

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

    return trpc.router({
      addTeamMemberOrEvents: policy("organization:manage")(
        procedure.input(
          z.object({
            organizationId: z.string(),
            plan: subscriptionPlanEnum,
            upgradeMembers: z.boolean(),
            upgradeTraces: z.boolean(),
            totalMembers: z.number(),
            totalTraces: z.number(),
            // Echoed back from `previewProration` so the charge prices the same
            // instant the customer was quoted. Optional: callers that never
            // showed a quote are priced at the moment they run.
            quotedAt: z.number().int().positive().optional(),
          }),
        ),
      ).mutation(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        return await subscriptionService.updateSubscriptionItems({
          organizationId: input.organizationId,
          plan: input.plan as PlanType,
          upgradeMembers: input.upgradeMembers,
          upgradeTraces: input.upgradeTraces,
          totalMembers: input.totalMembers,
          totalTraces: input.totalTraces,
          quotedAt: input.quotedAt,
        });
      }),

      create: policy("organization:manage")(
        procedure.input(
          z.object({
            organizationId: z.string(),
            baseUrl: z.string(),
            plan: subscriptionPlanEnum,
            membersToAdd: z.number().optional(),
            tracesToAdd: z.number().optional(),
            currency: z.nativeEnum(Currency).optional(),
            billingInterval: z.enum(["monthly", "annual"]).optional(),
          }),
        ),
      ).mutation(async ({ input, ctx }) => {
        const { customerService, subscriptionService } = requireSaasBilling(ctx.app);
        const customerId = await customerService.getOrCreateCustomerId({
          user: callerOf(ctx),
          organizationId: input.organizationId,
        });

        return await subscriptionService.createOrUpdateSubscription({
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

      manage: policy("organization:manage")(
        procedure.input(z.object({ organizationId: z.string(), baseUrl: z.string() })),
      ).mutation(async ({ input, ctx }) => {
        const { customerService, subscriptionService } = requireSaasBilling(ctx.app);
        const customerId = await customerService.getOrCreateCustomerId({
          user: callerOf(ctx),
          organizationId: input.organizationId,
        });

        return await subscriptionService.createBillingPortalSession({
          customerId,
          baseUrl: input.baseUrl,
          organizationId: input.organizationId,
        });
      }),

      previewProration: policy("organization:manage")(
        procedure.input(
          z.object({
            organizationId: z.string(),
            newTotalSeats: z.number().min(1),
          }),
        ),
      ).query(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        return await subscriptionService.previewProration({
          organizationId: input.organizationId,
          newTotalSeats: input.newTotalSeats,
        });
      }),

      getLastSubscription: policy("organization:view")(
        procedure.input(z.object({ organizationId: z.string() })),
      ).query(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        return await subscriptionService.getLastNonCancelledSubscription(input.organizationId);
      }),

      upgradeWithInvites: policy("organization:manage")(
        procedure.input(
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
        ),
      ).mutation(async ({ input, ctx }) => {
        const { customerService, subscriptionService } = requireSaasBilling(ctx.app);
        const customerId = await customerService.getOrCreateCustomerId({
          user: callerOf(ctx),
          organizationId: input.organizationId,
        });

        return await subscriptionService.createSubscriptionWithInvites({
          organizationId: input.organizationId,
          baseUrl: input.baseUrl,
          membersToAdd: input.totalSeats,
          customerId,
          currency: input.currency,
          billingInterval: input.billingInterval,
          invites: input.invites,
        });
      }),

      prospective: policy("organization:manage")(
        procedure.input(
          z.object({
            organizationId: z.string(),
            plan: subscriptionPlanEnum,
            customerName: z.string().optional(),
            customerEmail: z.string().email().optional(),
            note: z.string().optional(),
          }),
        ),
      ).mutation(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        const actorEmail = callerOf(ctx).email;
        if (!actorEmail) {
          throw new UserEmailRequiredError();
        }

        return await subscriptionService.notifyProspective({
          organizationId: input.organizationId,
          plan: input.plan as PlanType,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          note: input.note,
          actorEmail,
        });
      }),

      listInvoices: policy("organization:view")(
        procedure.input(z.object({ organizationId: z.string() })),
      ).query(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        return await subscriptionService.listInvoices({
          organizationId: input.organizationId,
        });
      }),
    });
  }
}
