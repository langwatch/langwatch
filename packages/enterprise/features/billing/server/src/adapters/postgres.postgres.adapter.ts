import { PostgresNotificationAdapter } from "@langwatch/notification-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaOrganizationPricingRepository } from "../repositories/prisma/prisma.organization-pricing.repository";
import { PrismaSubscriptionRepository } from "../repositories/prisma/prisma.subscription.repository";
import { PrismaBillingOrganizationRepository } from "../repositories/prisma/prisma.organization.repository";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationPricingRepository } from "../ports/organization-pricing.port";
import type { BillingSubscriptionRepository } from "../ports/subscription.port";
import type { BillingOrganizationRepository } from "../ports/organization.port";

export type PostgresBillingPersistence = {
  notifications: NotificationService;
  organizationPricing: OrganizationPricingRepository;
  subscriptions: BillingSubscriptionRepository;
  organization: BillingOrganizationRepository;
};

/** Constructs the feature's Postgres repositories without exposing them. */
export class PostgresBillingAdapter {
  private constructor(private readonly database: PrismaClient) {}

  static create(database: PrismaClient): PostgresBillingAdapter {
    return new PostgresBillingAdapter(database);
  }

  build(): PostgresBillingPersistence {
    return {
      notifications: PostgresNotificationAdapter.create({
        database: this.database,
      }).build(),
      organizationPricing: PrismaOrganizationPricingRepository.create(this.database),
      subscriptions: PrismaSubscriptionRepository.create(this.database),
      organization: PrismaBillingOrganizationRepository.create(this.database),
    };
  }
}
