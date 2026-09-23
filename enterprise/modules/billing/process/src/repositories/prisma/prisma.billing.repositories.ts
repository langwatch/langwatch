// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { BillingRepositories } from "../billing.repositories.ts";
import { PrismaBillingOrganizationRepository } from "./prisma.billing-account-facts.repository.ts";
import { PrismaBillingCheckpointRepository } from "./prisma.billing-checkpoint.repository.ts";
import { PrismaBillingReportOrganizationRepository } from "./prisma.billing-report-organization.repository.ts";
import { PrismaBillingWebhookOrganizationRepository } from "./prisma.billing-webhook-organization.repository.ts";
import { PrismaBillingWebhookBillingSubscription } from "./prisma.billing-webhook-subscription.repository.ts";
import { PrismaConnectedBillingRepository } from "./prisma.connected-billing.repository.ts";
import { PrismaDuplicateSubscriptionsReportRepository } from "./prisma.duplicate-subscriptions-report.repository.ts";
import { PrismaNurturingProfileRepository } from "./prisma.nurturing-profile.repository.ts";
import { PrismaOrganizationPricingRepository } from "./prisma.organization-pricing.repository.ts";
import { PrismaProjectActiveDayRepository } from "./prisma.project-active-day.repository.ts";
import { PrismaBillingSubscription } from "./prisma.subscription.repository.ts";
import { PrismaBillingTenantOrganizationRepository } from "./prisma.tenant-organization.repository.ts";

/**
 * The live tier: every billing row this module owns, read and written
 * through the one tenant-keyed Prisma client the process holds.
 */
export class PostgresBillingRepositories {
  static readonly requires = ["prisma"] as const;

  static create(members: Readonly<{ prisma: PrismaClient }>): BillingRepositories {
    const { prisma } = members;

    const subscriptions = PrismaBillingSubscription.create(prisma);

    return {
      checkpoints: PrismaBillingCheckpointRepository.create(prisma),
      connectedBilling: PrismaConnectedBillingRepository.create(prisma),
      duplicateSubscriptionsReports: PrismaDuplicateSubscriptionsReportRepository.create({
        database: prisma,
      }),
      nurturingProfiles: PrismaNurturingProfileRepository.create(prisma),
      organizations: PrismaBillingOrganizationRepository.create(prisma),
      organizationPricing: PrismaOrganizationPricingRepository.create(prisma),
      projectActiveDays: PrismaProjectActiveDayRepository.create(prisma),
      reportOrganizations: PrismaBillingReportOrganizationRepository.create(prisma),
      subscriptions,
      tenantOrganizations: PrismaBillingTenantOrganizationRepository.create(prisma),
      webhookOrganizations: PrismaBillingWebhookOrganizationRepository.create({ database: prisma }),
      webhookSubscriptions: PrismaBillingWebhookBillingSubscription.create({
        subscriptions,
        database: prisma,
      }),
    };
  }
}
