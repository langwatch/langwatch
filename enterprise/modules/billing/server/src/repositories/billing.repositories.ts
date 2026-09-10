// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingCheckpointRepository } from "./billing-checkpoint.repository.ts";
import type { BillingReportOrganizationRepository } from "./organization/billing-report-organization.repository.ts";
import type { BillingOrganization } from "./organization/billing-account-facts.repository.ts";
import type { OrganizationPricing } from "./organization/organization-pricing.repository.ts";
import type { SubscriptionRepository } from "./subscription.repository.ts";
import type { BillingTenantOrganization } from "./organization/tenant-organization.repository.ts";
import type { BillingWebhookOrganization } from "./billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscription } from "./billing-webhook-subscription.repository.ts";
import type { DuplicateSubscriptionsReportRepository } from "./duplicate-subscriptions-report.repository.ts";
import type { NurturingProfileRepository } from "./nurturing-profile.repository.ts";

/**
 * The rows the billing module owns, chosen once at boot.
 *
 * The ClickHouse half (the billable-events reader and the meter's write) is
 * not part of the selection: both resolve a client per organization rather
 * than reading one the process holds, so there is no infrastructure key a tier
 * could require. They are listed as unfinished in the conversion report.
 */
export interface BillingRepositories {
  readonly checkpoints: BillingCheckpointRepository;
  readonly duplicateSubscriptionsReports: DuplicateSubscriptionsReportRepository;
  readonly nurturingProfiles: NurturingProfileRepository;
  readonly organizations: BillingOrganization;
  readonly organizationPricing: OrganizationPricing;
  readonly reportOrganizations: BillingReportOrganizationRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly tenantOrganizations: BillingTenantOrganization;
  readonly webhookOrganizations: BillingWebhookOrganization;
  readonly webhookSubscriptions: BillingWebhookSubscription;
}
