import { TRPCError } from "@trpc/server";
import type Stripe from "stripe";
import { z } from "zod";
import { prisma } from "../../src/server/db";
import { checkOrganizationPermission } from "../../src/server/api/rbac";
import {
  createTRPCRouter,
  protectedProcedure,
} from "../../src/server/api/trpc";
import { createLogger } from "../../src/utils/logger";
import { notifySubscriptionEvent } from "./notificationHandlers";
import {
  createItemsToAdd,
  getItemsToUpdate,
  prices,
} from "./stripeHelpers";
import { createStripeClient } from "./stripeClient";
import {
  type PlanTypes as PlanType,
  PlanTypes,
  SUBSCRIBABLE_PLANS,
  SubscriptionStatus,
} from "./planTypes";

const logger = createLogger("langwatch:billing:subscriptionRouter");

const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

const subscriptionPlanEnum = z.enum(SUBSCRIBABLE_PLANS);

export const createSubscriptionRouter = () => {
  const stripe = createStripeClient();

  return createTRPCRouter({
    addTeamMemberOrTraces: protectedProcedure
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
      .mutation(async ({ input }) => {
        const lastSubscription = await getLastNonCancelledSubscription(
          input.organizationId,
        );

        if (
          lastSubscription &&
          lastSubscription.stripeSubscriptionId &&
          lastSubscription.status !== SubscriptionStatus.PENDING
        ) {
          const subscription = await stripe.subscriptions.retrieve(
            lastSubscription.stripeSubscriptionId,
          );

          const planType: PlanType = lastSubscription.plan as PlanType;
          const currentItems = subscription.items.data;

          const itemsToUpdate = getItemsToUpdate({
            currentItems,
            plan: planType,
            tracesToAdd: input.totalTraces,
            membersToAdd: input.totalMembers,
          });

          await stripe.subscriptions.update(lastSubscription.stripeSubscriptionId, {
            items: itemsToUpdate,
          });

          return {
            success: true,
          };
        }

        return {
          success: false,
        };
      }),

    create: protectedProcedure
      .input(
        z.object({
          organizationId: z.string(),
          baseUrl: z.string(),
          plan: subscriptionPlanEnum,
          membersToAdd: z.number().optional(),
          tracesToAdd: z.number().optional(),
        }),
      )
      .use(checkOrganizationPermission("organization:manage"))
      .mutation(async ({ input, ctx }) => {
        const customerId = await getOrCreateCustomerId({
          stripe,
          user: ctx.session.user,
          organizationId: input.organizationId,
        });

        const lastSubscription = await getLastNonCancelledSubscription(
          input.organizationId,
        );

        if (
          lastSubscription &&
          lastSubscription.stripeSubscriptionId &&
          lastSubscription.status !== SubscriptionStatus.PENDING
        ) {
          if (input.plan === PlanTypes.FREE) {
            const response = await stripe.subscriptions.cancel(
              lastSubscription.stripeSubscriptionId,
            );

            if (response.status === "canceled") {
              await prisma.subscription.update({
                where: { id: lastSubscription.id },
                data: { status: SubscriptionStatus.CANCELLED },
              });
            }

            return { url: `${input.baseUrl}/settings/subscription` };
          }

          const currentStripeSubscription = await stripe.subscriptions.retrieve(
            lastSubscription.stripeSubscriptionId,
          );

          const itemsToUpdate = getItemsToUpdate({
            currentItems: currentStripeSubscription.items.data,
            plan: input.plan,
            tracesToAdd: input.tracesToAdd ?? 0,
            membersToAdd: input.membersToAdd ?? 0,
          });

          const response = await stripe.subscriptions.update(
            lastSubscription.stripeSubscriptionId,
            {
              items: itemsToUpdate,
            },
          );

          if (response.status === "active") {
            await prisma.subscription.update({
              where: { id: lastSubscription.id },
              data: { plan: input.plan },
            });
          }

          return { url: `${input.baseUrl}/settings/subscription?success` };
        }

        if (input.plan === PlanTypes.FREE) {
          return { url: `${input.baseUrl}/settings/subscription` };
        }

        const itemsToAdd = createItemsToAdd(
          input.plan,
          { quantity: input.tracesToAdd ?? 0 },
          { quantity: input.membersToAdd ?? 0 },
        );

        const subscription = await prisma.subscription.create({
          data: {
            organizationId: input.organizationId,
            status: SubscriptionStatus.PENDING,
            plan: input.plan,
          },
        });

        itemsToAdd.push({
          price: prices[input.plan],
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
          success_url: `${input.baseUrl}/settings/subscription?success`,
          cancel_url: `${input.baseUrl}/settings/subscription`,
          client_reference_id: `subscription_setup_${subscription.id}`,
          allow_promotion_codes: true,
        });

        return { url: session.url };
      }),

    manage: protectedProcedure
      .input(z.object({ organizationId: z.string(), baseUrl: z.string() }))
      .use(checkOrganizationPermission("organization:manage"))
      .mutation(async ({ input, ctx }) => {
        const customerId = await getOrCreateCustomerId({
          stripe,
          user: ctx.session.user,
          organizationId: input.organizationId,
        });

        const session = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${input.baseUrl}/settings/subscription`,
        });

        return { url: session.url };
      }),

    getLastSubscription: protectedProcedure
      .input(z.object({ organizationId: z.string() }))
      .use(checkOrganizationPermission("organization:view"))
      .query(async ({ input }) => {
        return await getLastNonCancelledSubscription(input.organizationId);
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
      .mutation(async ({ input, ctx }) => {
        const organization = await prisma.organization.findUnique({
          where: { id: input.organizationId },
        });

        if (!organization) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization not found",
          });
        }

        const actorEmail = ctx.session.user.email;
        if (!actorEmail) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "User email is required to trigger notifications",
          });
        }

        await notifySubscriptionEvent({
          type: "prospective",
          organizationId: organization.id,
          organizationName: organization.name,
          plan: input.plan as PlanType,
          customerName: input.customerName,
          customerEmail: input.customerEmail ?? actorEmail,
          note: input.note,
          actorEmail,
        });

        return { success: true };
      }),
  });
};

const getLastNonCancelledSubscription = async (organizationId: string) => {
  return await prisma.subscription.findFirst({
    where: {
      organizationId,
      status: {
        not: SubscriptionStatus.CANCELLED,
      },
    },
    orderBy: { createdAt: "desc" },
  });
};

const getOrCreateCustomerId = async ({
  stripe,
  user,
  organizationId,
}: {
  stripe: Stripe;
  user: { email?: string | null };
  organizationId: string;
}) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!organization) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  }

  if (organization.stripeCustomerId) {
    return organization.stripeCustomerId;
  }

  if (!user.email) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "User email is required to create Stripe customer" });
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: organization.name,
  });

  const updated = await prisma.organization.updateMany({
    where: { id: organizationId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  });

  if (updated.count === 0) {
    // Another request won the race — clean up orphan and use existing
    logger.warn({ organizationId, orphanedCustomerId: maskCustomerId(customer.id) },
      "[billing] Stripe customer race detected, cleaning up orphan");
    try {
      await stripe.customers.del(customer.id);
    } catch (error) {
      logger.warn({ organizationId, orphanedCustomerId: maskCustomerId(customer.id), error: (error as Error).message },
        "[billing] Failed to clean up orphaned Stripe customer");
    }

    const refreshed = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    if (!refreshed.stripeCustomerId) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR",
        message: "Stripe customer ID missing after concurrent creation" });
    }
    return refreshed.stripeCustomerId;
  }

  return customer.id;
};
