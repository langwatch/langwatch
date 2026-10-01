/**
 * The four organization reads and writes a Stripe webhook makes, in
 * Postgres — via `BillingWebhookOrganizationRepository`'s narrow shape, since the
 * organization aggregate belongs to a core feature, not billing's own repository.
 */
import type { Currency, PrismaClient } from "@langwatch/prisma-client/generated";

import { BillingWebhookOrganizationRepository } from "../billing-webhook-organization.repository.ts";

export type BillingWebhookOrganizationDatabase = Pick<PrismaClient, "organization">;

export class PrismaBillingWebhookOrganizationRepository extends BillingWebhookOrganizationRepository {
  private constructor(private readonly database: BillingWebhookOrganizationDatabase) {
    super();
  }

  static create(options: {
    database: BillingWebhookOrganizationDatabase;
  }): PrismaBillingWebhookOrganizationRepository {
    return new PrismaBillingWebhookOrganizationRepository(options.database);
  }

  async findByStripeCustomerId(stripeCustomerId: string): Promise<{ id: string } | null> {
    return this.database.organization.findFirst({
      where: { stripeCustomerId },
      select: { id: true },
    });
  }

  async findNameById(organizationId: string): Promise<{ id: string; name: string } | null> {
    return this.database.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
  }

  async updateCurrency(input: { organizationId: string; currency: string }): Promise<void> {
    await this.database.organization.update({
      where: { id: input.organizationId },
      data: { currency: input.currency as Currency },
    });
  }

  /**
   * Clears the trial licence AND the two dates derived from it. Leaving the
   * dates behind is what made an expired trial keep answering as validated.
   */
  async clearTrialLicense(organizationId: string): Promise<void> {
    await this.database.organization.update({
      where: { id: organizationId },
      data: { license: null, licenseExpiresAt: null, licenseLastValidatedAt: null },
    });
  }
}
