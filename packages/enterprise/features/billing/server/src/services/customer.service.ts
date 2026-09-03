import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  CustomerCreationRaceError,
  UserEmailRequiredError,
} from "@langwatch/enterprise-billing-contract";

const logger = createLogger("langwatch:billing:customerService");

const maskCustomerId = (id: string) => `${id.slice(0, 7)}...${id.slice(-4)}`;

/**
 * The two organization reads billing does, named. `OrganizationService` has
 * thirty-five members covering teams, groups, personal workspaces and settings;
 * demanding all of them to call two says the coupling is wider than it is, and
 * made every double here a thirty-five-member stub or an `as` cast.
 */
type BillingProfileSource = Pick<
  OrganizationService,
  "getBillingProfile" | "claimBillingCustomerId"
>;

export class CustomerService {
  private constructor(
    private readonly stripe: Stripe,
    private readonly organizations: BillingProfileSource,
  ) {}

  static create(options: { stripe: Stripe; organizations: BillingProfileSource }): CustomerService {
    return new CustomerService(options.stripe, options.organizations);
  }

  async getOrCreateCustomerId(params: {
    user: { email?: string | null };
    organizationId: string;
  }): Promise<string> {
    const { user, organizationId } = params;
    const organization = await this.organizations.getBillingProfile({
      organizationId,
    });

    if (organization.billingCustomerId) {
      return organization.billingCustomerId;
    }

    if (!user.email) {
      throw new UserEmailRequiredError();
    }

    const customer = await this.stripe.customers.create({
      email: user.email,
      name: organization.name,
    });

    const claimed = await this.organizations.claimBillingCustomerId({
      organizationId,
      billingCustomerId: customer.id,
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

      const refreshed = await this.organizations.getBillingProfile({
        organizationId,
      });
      if (!refreshed.billingCustomerId) {
        throw new CustomerCreationRaceError();
      }
      return refreshed.billingCustomerId;
    }

    return customer.id;
  }
}
