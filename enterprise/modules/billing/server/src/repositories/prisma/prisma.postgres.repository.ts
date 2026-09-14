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
import type { OrganizationPricing } from "../organization/organization-pricing.repository.ts";
import type { SubscriptionRepository } from "../subscription.repository.ts";
import type { BillingOrganization } from "../organization/billing-account-facts.repository.ts";
import type { BillingCheckpointRepository } from "../billing-checkpoint.repository.ts";

export type PostgresBillingPersistence = {
  organizationPricing: OrganizationPricing;
  subscriptions: SubscriptionRepository;
  organization: BillingOrganization;
  /** The two-phase meter checkpoint the monthly roll-up reports against. */
  checkpoints: BillingCheckpointRepository;
};

/** Constructs feature Postgres repositories. Composing across features is the process's job. */
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
