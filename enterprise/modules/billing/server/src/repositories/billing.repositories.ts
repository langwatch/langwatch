// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingCheckpointPort } from "../ports/billing-checkpoint.port.ts";
import type { BillingReportOrganizationPort } from "../ports/billing-report-organization.port.ts";
import type { BillingOrganizationPort } from "../ports/organization.port.ts";
import type { OrganizationPricingPort } from "../ports/organization-pricing.port.ts";
import type { SubscriptionRepository } from "./subscription.repository.ts";
import type { BillingTenantOrganizationPort } from "../ports/tenant-organization.port.ts";
import type { BillingWebhookOrganizationPort } from "./billing-webhook-organization.repository.ts";
import type { BillingWebhookSubscriptionPort } from "./billing-webhook-subscription.repository.ts";
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
  readonly checkpoints: BillingCheckpointPort;
  readonly duplicateSubscriptionsReports: DuplicateSubscriptionsReportRepository;
  readonly nurturingProfiles: NurturingProfileRepository;
  readonly organizations: BillingOrganizationPort;
  readonly organizationPricing: OrganizationPricingPort;
  readonly reportOrganizations: BillingReportOrganizationPort;
  readonly subscriptions: SubscriptionRepository;
  readonly tenantOrganizations: BillingTenantOrganizationPort;
  readonly webhookOrganizations: BillingWebhookOrganizationPort;
  readonly webhookSubscriptions: BillingWebhookSubscriptionPort;
}
