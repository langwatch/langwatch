import type { BillingAccountFactsRepository } from "../billing-account-facts.repository.ts";
import type { BillingCheckpointRepository } from "../billing-checkpoint.repository.ts";
import type { OrganizationPricingRepository } from "../organization-pricing.repository.ts";
import type { BillingSubscriptionRepository } from "../subscription.repository.ts";
import {
  PrismaBillingOrganizationRepository,
  type BillingOrganizationDatabase,
} from "./prisma.billing-account-facts.repository.ts";
import {
  PrismaBillingCheckpointRepository,
  type BillingCheckpointDatabase,
} from "./prisma.billing-checkpoint.repository.ts";
import {
  PrismaOrganizationPricingRepository,
  type BillingOrganizationPricingDatabase,
} from "./prisma.organization-pricing.repository.ts";
import {
  PrismaBillingSubscriptionRepository,
  type BillingSubscriptionDatabase,
} from "./prisma.subscription.repository.ts";

export type PostgresBillingPersistence = {
  organizationPricing: OrganizationPricingRepository;
  subscriptions: BillingSubscriptionRepository;
  organization: BillingAccountFactsRepository;
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
      subscriptions: PrismaBillingSubscriptionRepository.create(this.database),
      organization: PrismaBillingOrganizationRepository.create(this.database),
      checkpoints: PrismaBillingCheckpointRepository.create(this.database),
    };
  }
}
