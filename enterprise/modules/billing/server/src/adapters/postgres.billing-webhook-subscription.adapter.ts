// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingSubscriptionPort } from "../ports/subscription.port.ts";
import type { BillingWebhookSubscriptionPort } from "../repositories/billing-webhook-subscription.repository.ts";
import {
  type BillingWebhookTrialLicenseDatabase,
  PrismaBillingWebhookSubscriptionRepository,
} from "../repositories/prisma/prisma.billing-webhook-subscription.repository.ts";

/**
 * The Postgres seam the billing-webhook composition still names.
 *
 * The row itself is `billingRepositories`' `webhookSubscriptions`; this factory
 * stands until that composition reads the row, and is deleted with the line.
 */
export class PostgresBillingWebhookSubscriptionAdapter {
  private constructor() {}

  static create(options: {
    subscriptions: BillingSubscriptionPort;
    database: BillingWebhookTrialLicenseDatabase;
  }): BillingWebhookSubscriptionPort {
    return PrismaBillingWebhookSubscriptionRepository.create(options);
  }
}
