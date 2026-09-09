import {
  PrismaOrganizationPricingRepository,
  type BillingOrganizationPricingDatabase,
} from "../repositories/prisma/prisma.organization-pricing.repository.ts";
import {
  PrismaSubscriptionRepository,
  type BillingSubscriptionDatabase,
} from "../repositories/prisma/prisma.subscription.repository.ts";
import {
  PrismaBillingOrganizationRepository,
  type BillingOrganizationDatabase,
} from "../repositories/prisma/prisma.billing-account-facts.repository.ts";
import {
  PrismaBillingCheckpointRepository,
  type BillingCheckpointDatabase,
} from "../repositories/prisma/prisma.billing-checkpoint.repository.ts";
import type { OrganizationPricingPort } from "../ports/organization-pricing.port.ts";
import type { BillingSubscriptionPort } from "../ports/subscription.port.ts";
import type { BillingOrganizationPort } from "../ports/organization.port.ts";
import type { BillingCheckpointPort } from "../ports/billing-checkpoint.port.ts";

export type PostgresBillingPersistence = {
  organizationPricing: OrganizationPricingPort;
  subscriptions: BillingSubscriptionPort;
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
