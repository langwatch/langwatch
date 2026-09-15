// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingRepositories } from "../billing.repositories.ts";
import { MemoryBillingCheckpointRepository } from "./memory.billing-checkpoint.repository.ts";
import { MemoryBillingOrganizationRepository } from "./memory.billing-account-facts.repository.ts";
import { MemoryBillingReportOrganizationRepository } from "./memory.billing-report-organization.repository.ts";
import { MemoryBillingStore } from "./memory-billing.store.ts";
import { MemoryBillingTenantOrganizationRepository } from "./memory.tenant-organization.repository.ts";
import { MemoryBillingWebhookOrganizationRepository } from "./memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "./memory.billing-webhook-subscription.repository.ts";
import { MemoryDuplicateSubscriptionsReportRepository } from "./memory.duplicate-subscriptions-report.repository.ts";
import { MemoryNurturingProfileRepository } from "./memory.nurturing-profile.repository.ts";
import { MemoryOrganizationPricingRepository } from "./memory.organization-pricing.repository.ts";
import { MemorySubscriptionRepository } from "./memory.subscription.repository.ts";

/** The "memory" tier: every billing repository, with no database behind it. */
export class MemoryBillingRepositories {
  static readonly requires = [] as const;

  static create(): BillingRepositories {
    // One store behind every row, the way one Postgres schema serves the
    // Prisma tier: a subscription written here is what the report, the pricing
    // and the nurturing rows answer from.
    const store = MemoryBillingStore.create();
    const subscriptions = MemorySubscriptionRepository.create(store);

    return {
      checkpoints: MemoryBillingCheckpointRepository.create(store),
      duplicateSubscriptionsReports: MemoryDuplicateSubscriptionsReportRepository.create(store),
      nurturingProfiles: MemoryNurturingProfileRepository.create(store),
      organizations: MemoryBillingOrganizationRepository.create(store),
      organizationPricing: MemoryOrganizationPricingRepository.create(store),
      reportOrganizations: MemoryBillingReportOrganizationRepository.create(store),
      subscriptions,
      tenantOrganizations: MemoryBillingTenantOrganizationRepository.create(store),
      webhookOrganizations: MemoryBillingWebhookOrganizationRepository.create(store),
      webhookSubscriptions: MemoryBillingWebhookSubscriptionRepository.create({
        subscriptions,
        store,
      }),
    };
  }
}
