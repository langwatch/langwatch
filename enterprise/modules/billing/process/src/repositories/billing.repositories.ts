// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillableEventsMeterRepository } from "./billable-events-meter.repository.ts";
import type { BillableEventsRepository } from "./billable-events.repository.ts";
import type { BillingAccountFactsRepository } from "./billing-account-facts.repository.ts";
import type { BillingCheckpointRepository } from "./billing-checkpoint.repository.ts";
import type { BillingOrganizationCacheRepository } from "./billing-organization-cache.repository.ts";
import type { BillingReportOrganizationRepository } from "./billing-report-organization.repository.ts";
import type { BillingWebhookOrganizationRepository } from "./billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscriptionRepository } from "./billing-webhook-subscription.repository.ts";
import type { ConnectedBillingRepository } from "./connected-billing.repository.ts";
import type { DuplicateSubscriptionsReportRepository } from "./duplicate-subscriptions-report.repository.ts";
import type { NurturingProfileRepository } from "./nurturing-profile.repository.ts";
import type { OrganizationPricingRepository } from "./organization-pricing.repository.ts";
import type { ProjectActiveDayRepository } from "./project-active-day.repository.ts";
import type { BillingSubscriptionRepository } from "./subscription.repository.ts";
import type { TenantOrganizationRepository } from "./tenant-organization.repository.ts";

/**
 * The rows the billing module owns, chosen once at boot.
 */
export interface BillingRepositories {
  readonly billableEvents: BillableEventsRepository;
  readonly checkpoints: BillingCheckpointRepository;
  readonly connectedBilling: ConnectedBillingRepository;
  readonly duplicateSubscriptionsReports: DuplicateSubscriptionsReportRepository;
  readonly nurturingProfiles: NurturingProfileRepository;
  readonly organizations: BillingAccountFactsRepository;
  readonly organizationCache: BillingOrganizationCacheRepository;
  readonly organizationPricing: OrganizationPricingRepository;
  readonly projectActiveDays: ProjectActiveDayRepository;
  readonly reportOrganizations: BillingReportOrganizationRepository;
  readonly subscriptions: BillingSubscriptionRepository;
  readonly tenantOrganizations: TenantOrganizationRepository;
  readonly webhookOrganizations: BillingWebhookOrganizationRepository;
  readonly webhookSubscriptions: BillingWebhookSubscriptionRepository;
}

/** ClickHouse-backed billing rows, selected through their own registry and store tier. */
export type BillingPostgresRepositories = Omit<
  BillingRepositories,
  "billableEvents" | "organizationCache"
>;

export interface BillingClickHouseRepositories {
  readonly billableEvents: BillableEventsRepository;
  readonly billableEventsMeter: BillableEventsMeterRepository;
}
