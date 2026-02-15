import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { z } from "zod";
import { prisma } from "../../src/server/db";
import { checkOrganizationPermission } from "../../src/server/api/rbac";
import {
  createTRPCRouter,
  protectedProcedure,
} from "../../src/server/api/trpc";
import {
  createItemsToAdd,
  getItemsToUpdate,
  prices,
} from "./stripeHelpers";
import {
  sendSubscriptionSlackNotification,
} from "./subscriptionSlackService";
import { PlanTypes, type PlanTypes as PlanType } from "./planTypes";

const subscriptionPlanEnum = z.enum([
  "FREE",
  "PRO",
  "GROWTH",
  "LAUNCH",
  "ACCELERATE",
  "LAUNCH_ANNUAL",
  "ACCELERATE_ANNUAL",
]);

const createStripeClient = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required for SaaS billing runtime");
  }

  return new Stripe(secretKey, {
    apiVersion: "2024-04-10",
  });
};

export const createSubscriptionRouter = () => {
  const stripe = createStripeClient();

  return createTRPCRouter({
    addTeamMemberOrTraces: protectedProcedure
      .input(
        z.object({
          organizationId: z.string(),
          plan: z.string(),
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
          lastSubscription.status !== "PENDING"
        ) {
          const subscription = await stripe.subscriptions.retrieve(
            lastSubscription.stripeSubscriptionId,
          );

          const planType: PlanType = lastSubscription.plan as PlanType;
          const currentItems = subscription.items.data;

          const itemsToUpdate = getItemsToUpdate(
            currentItems,
            planType,
            input.totalTraces,
            input.totalMembers,
          );

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
        const customerId = await getOrCreateCustomerId(
          stripe,
          ctx.session.user,
          input.organizationId,
        );

        const lastSubscription = await getLastNonCancelledSubscription(
          input.organizationId,
        );

        if (
          lastSubscription &&
          lastSubscription.stripeSubscriptionId &&
          lastSubscription.status !== "PENDING"
        ) {
          if (input.plan === "FREE") {
            const response = await stripe.subscriptions.cancel(
              lastSubscription.stripeSubscriptionId,
            );

            if (response.status === "canceled") {
              await prisma.subscription.update({
                where: { id: lastSubscription.id },
                data: { status: "CANCELLED" },
              });
            }

            return { url: `${input.baseUrl}/settings/subscription` };
          }

          const currentStripeSubscription = await stripe.subscriptions.retrieve(
            lastSubscription.stripeSubscriptionId,
          );

          const itemsToUpdate = getItemsToUpdate(
            currentStripeSubscription.items.data,
            input.plan,
            input.tracesToAdd ?? 0,
            input.membersToAdd ?? 0,
          );

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

        if (input.plan === "FREE") {
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
            status: "PENDING",
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
        const customerId = await getOrCreateCustomerId(
          stripe,
          ctx.session.user,
          input.organizationId,
        );

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

        await sendSubscriptionSlackNotification({
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
        not: "CANCELLED",
      },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
};

const getOrCreateCustomerId = async (
  stripe: Stripe,
  user: { email?: string | null },
  organizationId: string,
) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  if (!organization.stripeCustomerId) {
    if (!user.email) {
      throw new Error("User email not found, can't create stripe customer");
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: organization.name,
    });

    await prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  return organization.stripeCustomerId;
};
