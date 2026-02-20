import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { createLogger } from "../../../src/utils/logger";

const logger = createLogger("langwatch:billing:customerService");

const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

export type CustomerService = {
  getOrCreateCustomerId(params: {
    user: { email?: string | null };
    organizationId: string;
  }): Promise<string>;
};

export const createCustomerService = ({
  stripe,
  db,
}: {
  stripe: Stripe;
  db: PrismaClient;
}): CustomerService => {
  return {
    async getOrCreateCustomerId({ user, organizationId }) {
      const organization = await db.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new Error("Organization not found");
      }

      if (organization.stripeCustomerId) {
        return organization.stripeCustomerId;
      }

      if (!user.email) {
        throw new Error("User email is required to create Stripe customer");
      }

      const customer = await stripe.customers.create({
        email: user.email,
        name: organization.name,
      });

      const updated = await db.organization.updateMany({
        where: { id: organizationId, stripeCustomerId: null },
        data: { stripeCustomerId: customer.id },
      });

      if (updated.count === 0) {
        // Another request won the race — clean up orphan and use existing
        logger.warn(
          {
            organizationId,
            orphanedCustomerId: maskCustomerId(customer.id),
          },
          "[billing] Stripe customer race detected, cleaning up orphan",
        );
        try {
          await stripe.customers.del(customer.id);
        } catch (error) {
          logger.warn(
            {
              organizationId,
              orphanedCustomerId: maskCustomerId(customer.id),
              error: (error as Error).message,
            },
            "[billing] Failed to clean up orphaned Stripe customer",
          );
        }

        const refreshed = await db.organization.findUniqueOrThrow({
          where: { id: organizationId },
        });
        if (!refreshed.stripeCustomerId) {
          throw new Error(
            "Stripe customer ID missing after concurrent creation",
          );
        }
        return refreshed.stripeCustomerId;
      }

      return customer.id;
    },
  };
};
