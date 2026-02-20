import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { checkOrganizationPermission } from "../../src/server/api/rbac";
import {
  createTRPCRouter,
  protectedProcedure,
} from "../../src/server/api/trpc";
import {
  type PlanTypes as PlanType,
  SUBSCRIBABLE_PLANS,
} from "./planTypes";
import { billingErrorHandler } from "./middleware";
import type { CustomerService } from "./services/customerService";
import type { SubscriptionService } from "./services/subscriptionService";

const subscriptionPlanEnum = z.enum(SUBSCRIBABLE_PLANS);

export const createSubscriptionRouterFactory = ({
  customerService,
  subscriptionService,
}: {
  customerService: CustomerService;
  subscriptionService: SubscriptionService;
}) => {
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
        }),
      )
      .use(checkOrganizationPermission("organization:manage"))
      .use(billingErrorHandler)
      .mutation(async ({ input }) => {
        return await subscriptionService.updateSubscriptionItems({
          organizationId: input.organizationId,
          plan: input.plan as PlanType,
          upgradeMembers: input.upgradeMembers,
          upgradeTraces: input.upgradeTraces,
          totalMembers: input.totalMembers,
          totalTraces: input.totalTraces,
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
          currency: z.enum(["EUR", "USD"]).optional(),
          billingInterval: z.enum(["monthly", "annual"]).optional(),
        }),
      )
      .use(checkOrganizationPermission("organization:manage"))
      .use(billingErrorHandler)
      .mutation(async ({ input, ctx }) => {
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
      .use(checkOrganizationPermission("organization:manage"))
      .use(billingErrorHandler)
      .mutation(async ({ input, ctx }) => {
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
      .use(checkOrganizationPermission("organization:manage"))
      .use(billingErrorHandler)
      .query(async ({ input }) => {
        return await subscriptionService.previewProration({
          organizationId: input.organizationId,
          newTotalSeats: input.newTotalSeats,
        });
      }),

    getLastSubscription: protectedProcedure
      .input(z.object({ organizationId: z.string() }))
      .use(checkOrganizationPermission("organization:view"))
      .use(billingErrorHandler)
      .query(async ({ input }) => {
        return await subscriptionService.getLastNonCancelledSubscription(
          input.organizationId,
        );
      }),

    upgradeWithInvites: protectedProcedure
      .input(
        z.object({
          organizationId: z.string(),
          baseUrl: z.string(),
          currency: z.enum(["EUR", "USD"]).optional(),
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
      .use(checkOrganizationPermission("organization:manage"))
      .use(billingErrorHandler)
      .mutation(async ({ input, ctx }) => {
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
      .use(checkOrganizationPermission("organization:manage"))
      .use(billingErrorHandler)
      .mutation(async ({ input, ctx }) => {
        const actorEmail = ctx.session.user.email;
        if (!actorEmail) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "User email is required to trigger notifications",
          });
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
  });
};
