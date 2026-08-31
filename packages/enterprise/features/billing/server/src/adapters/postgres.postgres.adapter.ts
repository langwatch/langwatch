import {
  PrismaOrganizationPricingRepository,
  type BillingOrganizationPricingDatabase,
} from "../repositories/prisma/prisma.organization-pricing.repository";
import {
  PrismaSubscriptionRepository,
  type BillingSubscriptionDatabase,
} from "../repositories/prisma/prisma.subscription.repository";
import {
  PrismaBillingOrganizationRepository,
  type BillingOrganizationDatabase,
} from "../repositories/prisma/prisma.organization.repository";
import {
  PrismaBillingCheckpointRepository,
  type BillingCheckpointDatabase,
} from "../repositories/prisma/prisma.billing-checkpoint.repository";
import type { OrganizationPricingRepository } from "../ports/organization-pricing.port";
import type { BillingSubscriptionRepository } from "../ports/subscription.port";
import type { BillingOrganizationPort } from "../ports/organization.port";
import type { BillingCheckpointPort } from "../ports/billing-checkpoint.port";

export type PostgresBillingPersistence = {
  organizationPricing: OrganizationPricingRepository;
  subscriptions: BillingSubscriptionRepository;
  organization: BillingOrganizationPort;
  /** The two-phase meter checkpoint the monthly roll-up reports against. */
  checkpoints: BillingCheckpointPort;
};

/**
 * Constructs the feature's own Postgres repositories without exposing them.
 *
 * It used to build a `NotificationService` here too, by constructing
 * Notification's `PostgresNotificationAdapter` — one feature composing another
 * feature's persistence, which is what `cross-feature` reports. Exactly one
 * caller ever read that field; composing across features is the process's job,
 * so the process does it.
 */
export class PostgresBillingAdapter {
  private constructor(
    private readonly database: BillingOrganizationPricingDatabase &
      BillingSubscriptionDatabase &
      BillingOrganizationDatabase &
      BillingCheckpointDatabase,
  ) {}

  static create(
    database: BillingOrganizationPricingDatabase &
      BillingSubscriptionDatabase &
      BillingOrganizationDatabase &
      BillingCheckpointDatabase,
  ): PostgresBillingAdapter {
    return new PostgresBillingAdapter(database);
  }

  build(): PostgresBillingPersistence {
    return {
      organizationPricing: PrismaOrganizationPricingRepository.create(this.database),
      subscriptions: PrismaSubscriptionRepository.create(this.database),
      organization: PrismaBillingOrganizationRepository.create(this.database),
      checkpoints: PrismaBillingCheckpointRepository.create(this.database),
    };
  }
}
