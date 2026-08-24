import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";
import {
  CustomerCreationRaceError,
  OrganizationNotFoundError,
  UserEmailRequiredError,
} from "@langwatch/enterprise-billing-contract";
import type { BillingOrganizationRepository } from "../ports/billing-organization.port";

const logger = createLogger("langwatch:billing:customerService");

const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

export class CustomerService {
  private constructor(
    private readonly stripe: Stripe,
    private readonly organizations: BillingOrganizationRepository,
  ) {}

  static create(options: {
    stripe: Stripe;
    organizations: BillingOrganizationRepository;
  }): CustomerService {
    return new CustomerService(options.stripe, options.organizations);
  }

  async getOrCreateCustomerId(params: {
    user: { email?: string | null };
    organizationId: string;
  }): Promise<string> {
      const { user, organizationId } = params;
      const organization = await this.organizations.findById(organizationId);

      if (!organization) {
        throw new OrganizationNotFoundError();
      }

      if (organization.stripeCustomerId) {
        return organization.stripeCustomerId;
      }

      if (!user.email) {
        throw new UserEmailRequiredError();
      }

      const customer = await this.stripe.customers.create({
        email: user.email,
        name: organization.name,
      });

      const claimed = await this.organizations.claimStripeCustomerId({
        organizationId,
        stripeCustomerId: customer.id,
      });

      if (!claimed) {
        // Another request won the race — clean up orphan and use existing
        logger.warn(
          {
            organizationId,
            orphanedCustomerId: maskCustomerId(customer.id),
          },
          "[billing] Stripe customer race detected, cleaning up orphan",
        );
        try {
          await this.stripe.customers.del(customer.id);
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

        const refreshed = await this.organizations.requireById(organizationId);
        if (!refreshed.stripeCustomerId) {
          throw new CustomerCreationRaceError();
        }
        return refreshed.stripeCustomerId;
      }

      return customer.id;
  }
}
