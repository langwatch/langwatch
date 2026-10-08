// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingAccountFactsRepository } from "./billing-account-facts.repository.ts";
import type { BillingCheckpointRepository } from "./billing-checkpoint.repository.ts";
import type { BillingGatewaySpendRepository } from "./billing-gateway-spend.repository.ts";
import type { BillingOrganizationCacheRepository } from "./billing-organization-cache.repository.ts";
import type { BillingProjectDirectoryRepository } from "./billing-project-directory.repository.ts";
import type { BillingReportOrganizationRepository } from "./billing-report-organization.repository.ts";
import type { BillingWebhookOrganizationRepository } from "./billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscriptionRepository } from "./billing-webhook-subscription.repository.ts";
import type { ConnectedBillingRepository } from "./connected-billing.repository.ts";
import type { DuplicateSubscriptionsReportRepository } from "./duplicate-subscriptions-report.repository.ts";
import type { OrganizationPricingRepository } from "./organization-pricing.repository.ts";
import type { SeatEventSubscriptionRepository } from "./seat-event-subscription.repository.ts";
import type { BillingSubscriptionRepository } from "./subscription.repository.ts";

/**
 * The rows the billing module owns, chosen once at boot.
 */
export interface BillingRepositories {
  readonly checkpoints: BillingCheckpointRepository;
  readonly connectedBilling: ConnectedBillingRepository;
  readonly duplicateSubscriptionsReports: DuplicateSubscriptionsReportRepository;
  /** Gateway's spend ledger, through gateway's share (round 37 D5). */
  readonly gatewaySpend: BillingGatewaySpendRepository;
  readonly organizations: BillingAccountFactsRepository;
  readonly organizationCache: BillingOrganizationCacheRepository;
  readonly organizationPricing: OrganizationPricingRepository;
  /** Project's projects, through project's share (round 37 D5, R40). */
  readonly projects: BillingProjectDirectoryRepository;
  readonly reportOrganizations: BillingReportOrganizationRepository;
  readonly seatEventSubscriptions: SeatEventSubscriptionRepository;
  readonly subscriptions: BillingSubscriptionRepository;
  readonly webhookOrganizations: BillingWebhookOrganizationRepository;
  readonly webhookSubscriptions: BillingWebhookSubscriptionRepository;
}

/** The Postgres-backed billing rows: every row but the Redis cache and the ClickHouse ledger. */
export type BillingPostgresRepositories = Omit<
  BillingRepositories,
  "organizationCache" | "gatewaySpend"
>;
