// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingWebhookOrganizationPort } from "../repositories/billing-webhook-organization.repository.ts";
import {
  type BillingWebhookOrganizationDatabase,
  PrismaBillingWebhookOrganizationRepository,
} from "../repositories/prisma/prisma.billing-webhook-organization.repository.ts";

/**
 * The Postgres seam the billing-webhook composition still names.
 *
 * The row itself is `billingRepositories`' `webhookOrganizations`; this factory
 * stands until that composition reads the row, and is deleted with the line.
 */
export class PostgresBillingWebhookOrganizationAdapter {
  private constructor() {}

  static create(options: {
    database: BillingWebhookOrganizationDatabase;
  }): BillingWebhookOrganizationPort {
    return PrismaBillingWebhookOrganizationRepository.create({ database: options.database });
  }
}
