import { z } from "zod";
import {
  OrganizationRoleGroup,
  checkUserPermissionForOrganization,
} from "../../../../langwatch/langwatch/src/server/api/permission";
import {
  createTRPCRouter,
  protectedProcedure,
} from "../../../../langwatch/langwatch/src/server/api/trpc";
import { env } from "../../../../langwatch/langwatch/src/env.mjs";
import { prisma } from "../../../../langwatch/langwatch/src/server/db";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

const prices: Record<"PRO" | "GROWTH", string> =
  env.NODE_ENV === "production"
    ? {
        PRO: "price_1P6fvzIMsTw08cudWCwqfEjq",
        GROWTH: "price_1P6fw2IMsTw08cudFUkOX7jV",
      }
    : {
        PRO: "price_1P6bSyIMsTw08cudmzoqwBVN",
        GROWTH: "price_1P6fbyIMsTw08cudKh5L8w8x",
      };

export const subscriptionRouter = () =>
  createTRPCRouter({
    create: protectedProcedure
      .input(
        z.object({
          organizationId: z.string(),
          baseUrl: z.string(),
          plan: z.enum(["FREE", "PRO", "GROWTH"]),
        })
      )
      .use(
        checkUserPermissionForOrganization(
          OrganizationRoleGroup.ORGANIZATION_MANAGE
        )
      )
      .mutation(async ({ input, ctx }) => {
        const customerId = await getOrCreateCustomerId(
          ctx.session.user,
          input.organizationId
        );

        const lastSubscription = await getLastNonCancelledSubscription(
          input.organizationId
        );
        if (
          lastSubscription &&
          lastSubscription.stripeSubscriptionId &&
          lastSubscription.status !== "PENDING"
        ) {
          if (input.plan === "FREE") {
            const response = await stripe.subscriptions.cancel(
              lastSubscription.stripeSubscriptionId
            );

            if (response.status === "canceled") {
              await prisma.subscription.update({
                where: { id: lastSubscription.id },
                data: { status: "CANCELLED" },
              });
            }

            return { url: `${input.baseUrl}/settings/subscription` };
          } else {
            const currentStripeSubscription =
              await stripe.subscriptions.retrieve(
                lastSubscription.stripeSubscriptionId
              );
            const lineItems = currentStripeSubscription.items.data;
            const itemId = (
              lineItems.find(
                (item) =>
                  item.price.id ===
                  prices[lastSubscription.plan as "PRO" | "GROWTH"]
              ) || lineItems[0]
            )?.id;
            const response = await stripe.subscriptions.update(
              lastSubscription.stripeSubscriptionId,
              {
                items: [
                  {
                    id: itemId,
                    price: prices[input.plan],
                    quantity: 1,
                  },
                ],
              }
            );

            if (response.status === "active") {
              await prisma.subscription.update({
                where: { id: lastSubscription.id },
                data: { plan: input.plan },
              });
            }

            return { url: `${input.baseUrl}/settings/subscription?success` };
          }
        } else {
          if (input.plan === "FREE") {
            return { url: `${input.baseUrl}/settings/subscription` };
          }

          const subscription = await prisma.subscription.create({
            data: {
              organizationId: input.organizationId,
              status: "PENDING",
              plan: input.plan,
            },
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
            line_items: [
              {
                price: prices[input.plan],
                quantity: 1,
              },
            ],
            success_url: `${input.baseUrl}/settings/subscription?success`,
            cancel_url: `${input.baseUrl}/settings/subscription`,
            client_reference_id: `subscription_setup_${subscription.id}`,
            allow_promotion_codes: true,
          });

          return { url: session.url };
        }
      }),

    manage: protectedProcedure
      .input(z.object({ organizationId: z.string(), baseUrl: z.string() }))
      .use(
        checkUserPermissionForOrganization(
          OrganizationRoleGroup.ORGANIZATION_MANAGE
        )
      )
      .mutation(async ({ input, ctx }) => {
        const customerId = await getOrCreateCustomerId(
          ctx.session.user,
          input.organizationId
        );

        const session = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: `${input.baseUrl}/settings/subscription`,
        });

        return { url: session.url };
      }),

    getLastSubscription: protectedProcedure
      .input(z.object({ organizationId: z.string() }))
      .use(
        checkUserPermissionForOrganization(
          OrganizationRoleGroup.ORGANIZATION_VIEW
        )
      )
      .query(async ({ input }) => {
        const subscription = await getLastNonCancelledSubscription(
          input.organizationId
        );

        return subscription;
      }),
  });

const getLastNonCancelledSubscription = async (organizationId: string) => {
  const subscription = await prisma.subscription.findFirst({
    where: {
      organizationId,
      status: {
        not: "CANCELLED",
      },
    },
    orderBy: { createdAt: "desc" },
    take: 1,
  });

  return subscription;
};

const getOrCreateCustomerId = async (
  user: { email?: string | null },
  organizationId: string
) => {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  if (!organization?.stripeCustomerId) {
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
