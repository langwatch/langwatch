/**
 * Prisma bindings for connected billing (ADR-141, section 7), and the one
 * place that builds the service as the app uses it.
 *
 * The commercial terms live on the license, not here: `terms` below reads the
 * agreed commit from the registry, raises it there when an operator buys more,
 * and asks the contract budget to follow. That keeps one source for the cap
 * the customer is stopped at.
 */

import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import {
  CONTRACT_BUDGET_EXTERNAL_ID,
  createContractBudgetService,
} from "../../licensing/connect/connect.prisma";
import { createLicenseRegistryService } from "../../licensing/registry/composition";
import { IssuedLicenseNotFoundError } from "../../licensing/registry/errors";
import { statusOfIssuedLicense } from "../../licensing/registry/issuedLicense";
import { PrismaIssuedLicenseRepository } from "../../licensing/registry/issuedLicense.prisma";
import { createCreditGrants } from "../stripe/creditGrants";
import { createStripeClient } from "../stripe/stripeClient";
import { prices } from "../stripe/stripePriceCatalog";
import type { ConnectedBillingTerms } from "./connectedBilling.service";
import { ConnectedBillingService } from "./connectedBilling.service";
import { StripeConnectedBillingProvider } from "./connectedBilling.stripe";
import { PrismaConnectedBillingStore } from "./connectedBillingStore.prisma";

/** The registry and the contract budget, as the billing service asks for them. */
export function createConnectedBillingTerms(
  prisma: PrismaClient,
): ConnectedBillingTerms {
  const budgets = createContractBudgetService(prisma);
  const licenses = new PrismaIssuedLicenseRepository(prisma);

  return {
    async termsOf(organizationId) {
      const terms = await budgets.termsOf(organizationId);
      return { commitUsdCents: terms.commitUsdCents };
    },
    async raiseCommit({ organizationId, byUsdCents, operatorId }) {
      const rows = await licenses.findAllByOrganization(organizationId);
      const now = new Date();
      const active = rows
        .filter((row) => statusOfIssuedLicense(row, now) === "active")
        .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];
      if (!active) throw new IssuedLicenseNotFoundError();
      await createLicenseRegistryService(prisma).updateTerms({
        id: active.id,
        operatorId,
        commitUsdCents: active.commitUsdCents + byUsdCents,
      });
    },
    async syncBudget({ organizationId, operatorId }) {
      await budgets.sync({ organizationId, operatorId });
    },
    async resetBudget({ organizationId, operatorId }) {
      const budget = await prisma.gatewayBudget.findFirst({
        where: {
          organizationId,
          externalId: CONTRACT_BUDGET_EXTERNAL_ID,
          archivedAt: null,
        },
        select: { id: true },
      });
      // Nothing agreed yet means no budget to restart; the sync that follows
      // a renewal creates one at the new commit.
      if (!budget) return;
      await GatewayBudgetService.create(prisma, getApp().gateway.budgets).reset(
        {
          id: budget.id,
          organizationId,
          actorUserId: operatorId,
          reason: "Contract renewed",
        },
      );
    },
  };
}

export function createConnectedBillingService(
  prisma: PrismaClient,
): ConnectedBillingService {
  const stripe = createStripeClient();
  return new ConnectedBillingService({
    store: new PrismaConnectedBillingStore(prisma),
    provider: new StripeConnectedBillingProvider({
      stripe,
      creditGrants: createCreditGrants(stripe),
      usagePriceId: () => prices.CONNECTED_HOSTED_USAGE_QUARTERLY,
    }),
    terms: createConnectedBillingTerms(prisma),
    isCloud: () => Boolean(env.IS_SAAS),
    bankDetails: () => env.LANGWATCH_BILLING_BANK_DETAILS ?? null,
  });
}
