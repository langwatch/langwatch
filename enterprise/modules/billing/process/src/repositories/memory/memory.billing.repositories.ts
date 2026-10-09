// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingOrganizationCacheRepository } from "../billing-organization-cache.repository.ts";
import type { BillingReportOrganizationLookup } from "../billing-report-organization.repository.ts";
import type { BillingRepositories } from "../billing.repositories.ts";
import { OrganizationPricingRepository } from "../organization-pricing.repository.ts";
import { MemoryBillingOrganizationRepository } from "./memory.billing-account-facts.repository.ts";
import { MemoryBillingCheckpointRepository } from "./memory.billing-checkpoint.repository.ts";
import { MemoryBillingGatewaySpendRepository } from "./memory.billing-gateway-spend.repository.ts";
import { MemoryBillingProjectDirectoryRepository } from "./memory.billing-project-directory.repository.ts";
import { MemoryBillingReportOrganizationRepository } from "./memory.billing-report-organization.repository.ts";
import { MemoryBillingWebhookOrganizationRepository } from "./memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "./memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "./memory.billing.store.ts";
import { MemoryConnectedBillingRepository } from "./memory.connected-billing.repository.ts";
import { MemoryDuplicateSubscriptionsReportRepository } from "./memory.duplicate-subscriptions-report.repository.ts";
import { MemorySeatEventSubscriptionRepository } from "./memory.seat-event-subscription.repository.ts";
import { MemoryBillingSubscriptionRepository } from "./memory.subscription.repository.ts";

/** The Redis read-through cache's twin: one map per install, no expiry. */
class MemoryBillingOrganizationCacheRepository implements BillingOrganizationCacheRepository {
  static create(): MemoryBillingOrganizationCacheRepository {
    return new MemoryBillingOrganizationCacheRepository();
  }

  readonly #entries = new Map<string, BillingReportOrganizationLookup>();

  private constructor() {}

  async find(key: string): Promise<BillingReportOrganizationLookup | undefined> {
    return this.#entries.get(key);
  }

  async set(key: string, value: BillingReportOrganizationLookup): Promise<void> {
    this.#entries.set(key, value);
  }
}

/**
 * The pricing-model read on its own, over the same store the account facts
 * answer from: a model written once is what both rows report.
 */
class MemoryOrganizationPricingRepository extends OrganizationPricingRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryOrganizationPricingRepository {
    return new MemoryOrganizationPricingRepository(store);
  }

  async findPricingModel(organizationId: string): Promise<string | null> {
    return this.store.organizations.get(organizationId)?.pricingModel ?? null;
  }
}

/** The "memory" tier: every billing repository, with no database behind it. */
export class MemoryBillingRepositories {
  static readonly requires = [] as const;

  static create(): BillingRepositories {
    // One store behind every row, the way one Postgres schema serves the
    // Prisma tier: a subscription written here is what the report, and the pricing
    // answer from.
    const store = MemoryBillingStore.create();
    const subscriptions = MemoryBillingSubscriptionRepository.create(store);

    return {
      checkpoints: MemoryBillingCheckpointRepository.create(store),
      connectedBilling: MemoryConnectedBillingRepository.create(store),
      duplicateSubscriptionsReports: MemoryDuplicateSubscriptionsReportRepository.create(store),
      gatewaySpend: MemoryBillingGatewaySpendRepository.create(store),
      organizations: MemoryBillingOrganizationRepository.create(store),
      organizationCache: MemoryBillingOrganizationCacheRepository.create(),
      organizationPricing: MemoryOrganizationPricingRepository.create(store),
      projects: MemoryBillingProjectDirectoryRepository.create(store),
      reportOrganizations: MemoryBillingReportOrganizationRepository.create(store),
      seatEventSubscriptions: MemorySeatEventSubscriptionRepository.create(store),
      subscriptions,
      webhookOrganizations: MemoryBillingWebhookOrganizationRepository.create(store),
      webhookSubscriptions: MemoryBillingWebhookSubscriptionRepository.create({
        subscriptions,
        store,
      }),
    };
  }
}
