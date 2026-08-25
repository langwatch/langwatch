import { z } from "zod";
import {
  Currency,
  type PlanTypes as PlanType,
  SUBSCRIBABLE_PLANS,
  UserEmailRequiredError,
} from "@langwatch/enterprise-billing-contract";
import type { App } from "~/server/app-layer/app";
import { createTRPCRouter, protectedProcedure } from "../trpc";

// No billing-specific error middleware: every error the services raise is a
// `HandledError`, so the shared handled-error middleware in `trpc.ts` maps it
// to the right tRPC code and keeps the error as the `cause`. The middleware
// this replaced re-threw a bare `TRPCError` with no cause, which is what
// turned every 5xx billing failure into "An unknown error occurred".

const subscriptionPlanEnum = z.enum(SUBSCRIBABLE_PLANS);

const requireSaasBilling = (app: App) => {
  const { billingCustomer, subscription } = app;
  if (!billingCustomer || !subscription) {
    throw new Error("SaaS billing is not configured");
  }
  return { customerService: billingCustomer, subscriptionService: subscription };
};

export const createSubscriptionRouter = () => {
  return createTRPCRouter({
    addTeamMemberOrEvents: protectedProcedure
      .input(
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
      )
      .permission("organization:manage")
      .mutation(async ({ input, ctx }) => {
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

    create: protectedProcedure
      .input(
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
      .permission("organization:manage")
      .mutation(async ({ input, ctx }) => {
        const { customerService, subscriptionService } = requireSaasBilling(
          ctx.app,
        );
        const customerId = await customerService.getOrCreateCustomerId({
          user: ctx.session.user,
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

    manage: protectedProcedure
      .input(z.object({ organizationId: z.string(), baseUrl: z.string() }))
      .permission("organization:manage")
      .mutation(async ({ input, ctx }) => {
        const { customerService, subscriptionService } = requireSaasBilling(
          ctx.app,
        );
        const customerId = await customerService.getOrCreateCustomerId({
          user: ctx.session.user,
          organizationId: input.organizationId,
        });

        return await subscriptionService.createBillingPortalSession({
          customerId,
          baseUrl: input.baseUrl,
          organizationId: input.organizationId,
        });
      }),

    previewProration: protectedProcedure
      .input(
        z.object({
          organizationId: z.string(),
          newTotalSeats: z.number().min(1),
        }),
      )
      .permission("organization:manage")
      .query(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        return await subscriptionService.previewProration({
          organizationId: input.organizationId,
          newTotalSeats: input.newTotalSeats,
        });
      }),

    getLastSubscription: protectedProcedure
      .input(z.object({ organizationId: z.string() }))
      .permission("organization:view")
      .query(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        return await subscriptionService.getLastNonCancelledSubscription(
          input.organizationId,
        );
      }),

    upgradeWithInvites: protectedProcedure
      .input(
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
      .permission("organization:manage")
      .mutation(async ({ input, ctx }) => {
        const { customerService, subscriptionService } = requireSaasBilling(
          ctx.app,
        );
        const customerId = await customerService.getOrCreateCustomerId({
          user: ctx.session.user,
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

    prospective: protectedProcedure
      .input(
        z.object({
          organizationId: z.string(),
          plan: subscriptionPlanEnum,
          customerName: z.string().optional(),
          customerEmail: z.string().email().optional(),
          note: z.string().optional(),
        }),
      )
      .permission("organization:manage")
      .mutation(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        const actorEmail = ctx.session.user.email;
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

    listInvoices: protectedProcedure
      .input(z.object({ organizationId: z.string() }))
      .permission("organization:view")
      .query(async ({ input, ctx }) => {
        const { subscriptionService } = requireSaasBilling(ctx.app);
        return await subscriptionService.listInvoices({
          organizationId: input.organizationId,
        });
      }),
  });
};
