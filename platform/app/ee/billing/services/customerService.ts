import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import {
  CustomerCreationRaceError,
  OrganizationNotFoundError,
  UserEmailRequiredError,
} from "../errors";

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
  db: PrismaClient | Prisma.TransactionClient;
}): CustomerService => {
  return {
    async getOrCreateCustomerId({ user, organizationId }) {
      const organization = await db.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new OrganizationNotFoundError();
      }

      if (organization.stripeCustomerId) {
        return organization.stripeCustomerId;
      }

      if (!user.email) {
        throw new UserEmailRequiredError();
      }

      const customer = await stripe.customers.create({
        email: user.email,
        name: organization.name,
      });

      // One conditional write decides which customer the organization keeps.
      // As SQL with the condition against the table: `updateMany` puts it in
      // a subquery, which a statement that waited on the row lock re-runs on
      // its own older snapshot, so two checkouts starting together would both
      // be told they won and the organization would end up with two Stripe
      // customers, one of them orphaned.
      const updated = await db.$executeRaw`
        -- @tenancy: an organization is addressed by its own primary key.
        UPDATE "Organization"
           SET "stripeCustomerId" = ${customer.id},
               "updatedAt" = now()
         WHERE "id" = ${organizationId}
           AND "stripeCustomerId" IS NULL
      `;

      if (updated === 0) {
        // Another request won the race: clean up the orphan and use the
        // customer that was kept.
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
          throw new CustomerCreationRaceError();
        }
        return refreshed.stripeCustomerId;
      }

      return customer.id;
    },
  };
};
