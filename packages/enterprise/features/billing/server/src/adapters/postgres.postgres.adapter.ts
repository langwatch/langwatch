import { PrismaBillingOrganizationRepository } from "../repositories/prisma/prisma.billing-organization.repository";
import { PrismaNotificationRepository } from "../repositories/prisma/prisma.notification.repository";
import { PrismaOrganizationPricingRepository } from "../repositories/prisma/prisma.organization-pricing.repository";
import { PrismaSubscriptionRepository } from "../repositories/prisma/prisma.subscription.repository";
import type { BillingOrganizationRepository } from "../ports/billing-organization.port";
import type { NotificationRepository } from "../ports/notification.port";
import type { OrganizationPricingRepository } from "../ports/organization-pricing.port";
import type { BillingSubscriptionRepository } from "../ports/subscription.port";

export type PostgresBillingPersistence = {
  organizations: BillingOrganizationRepository;
  notifications: NotificationRepository;
  organizationPricing: OrganizationPricingRepository;
  subscriptions: BillingSubscriptionRepository;
};

/** Constructs the feature's Postgres repositories without exposing them. */
export class PostgresBillingAdapter {
  private constructor(private readonly database: object) {}

  static create(database: object): PostgresBillingAdapter {
    return new PostgresBillingAdapter(database);
  }

  build(): PostgresBillingPersistence {
    return {
      organizations: PrismaBillingOrganizationRepository.create(this.database),
      notifications: PrismaNotificationRepository.create(this.database),
      organizationPricing:
        PrismaOrganizationPricingRepository.create(this.database),
      subscriptions: PrismaSubscriptionRepository.create(this.database),
    };
  }
}
