import {
  CustomerCreationRaceError,
  OrganizationNotFoundError,
  UserEmailRequiredError,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";

import type { StripeCustomersChannel } from "../channels/stripe-customers.channel.ts";
import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";

const logger = createLogger("langwatch:billing:customerService");

const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

/** The checkout's read of organization's shared table, and the one claim billing writes there. */
type BillingProfileSource = Pick<
  BillingAccountFactsRepository,
  "findBillingProfile" | "claimStripeCustomerId"
>;

export class CustomerService {
  private constructor(
    private readonly customers: StripeCustomersChannel,
    private readonly organizations: BillingProfileSource,
  ) {}

  static create(options: {
    customers: StripeCustomersChannel;
    organizations: BillingProfileSource;
  }): CustomerService {
    return new CustomerService(options.customers, options.organizations);
  }

  async getOrCreateCustomerId(params: {
    user: { email?: string | null };
    organizationId: string;
  }): Promise<string> {
    const { user, organizationId } = params;
    const organization = await this.organizations.findBillingProfile(organizationId);
    if (!organization) throw new OrganizationNotFoundError();

    if (organization.stripeCustomerId) {
      return organization.stripeCustomerId;
    }

    if (!user.email) {
      throw new UserEmailRequiredError();
    }

    const customer = await this.customers.createCustomer({
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
        await this.customers.deleteCustomer({ customerId: customer.id });
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

      const refreshed = await this.organizations.findBillingProfile(organizationId);
      if (!refreshed?.stripeCustomerId) {
        throw new CustomerCreationRaceError();
      }

      return refreshed.stripeCustomerId;
    }

    return customer.id;
  }
}
