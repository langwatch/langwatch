import {
  PrismaOrganizationPricingRepository,
  type BillingOrganizationPricingDatabase,
} from "./prisma.organization-pricing.repository.ts";
import {
  PrismaSubscriptionRepository,
  type BillingSubscriptionDatabase,
} from "./prisma.subscription.repository.ts";
import {
  PrismaBillingOrganizationRepository,
  type BillingOrganizationDatabase,
} from "./prisma.billing-account-facts.repository.ts";
import {
  PrismaBillingCheckpointRepository,
  type BillingCheckpointDatabase,
} from "./prisma.billing-checkpoint.repository.ts";
import type { OrganizationPricingPort } from "../../ports/organization-pricing.port.ts";
import type { SubscriptionRepository } from "../subscription.repository.ts";
import type { BillingOrganizationPort } from "../../ports/organization.port.ts";
import type { BillingCheckpointPort } from "../../ports/billing-checkpoint.port.ts";

export type PostgresBillingPersistence = {
  organizationPricing: OrganizationPricingPort;
  subscriptions: SubscriptionRepository;
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
export class PrismaPostgresRepository {
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
  ): PrismaPostgresRepository {
    return new PrismaPostgresRepository(database);
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
