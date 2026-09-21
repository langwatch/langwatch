/**
 * Prisma bindings for connected billing (ADR-141, section 7), and the one
 * place that builds the service as the app uses it.
 *
 * The commercial terms live on the license, not here: `terms` below reads the
 * agreed commit from the registry, raises it there when an operator buys more,
 * and asks the contract budget to follow. That keeps one source for the cap
 * the customer is stopped at.
 */

import { z } from "zod";
import { env } from "~/env.mjs";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
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
import type {
  BankTransferType,
  ConnectedBillingAccountRecord,
  ConnectedBillingStore,
  ConnectedBillingTerms,
  ConnectedCurrency,
  CreditGrantRecord,
  InvoiceRecord,
  PendingRenewal,
} from "./connectedBilling.service";
import { ConnectedBillingService } from "./connectedBilling.service";
import { StripeConnectedBillingProvider } from "./connectedBilling.stripe";

type AccountRow = Prisma.ConnectedBillingAccountGetPayload<
  Record<string, never>
>;
type GrantRow = Prisma.ConnectedCreditGrantGetPayload<Record<string, never>>;
type InvoiceRow = Prisma.ConnectedInvoiceGetPayload<Record<string, never>>;

const pendingRenewalSchema = z.object({
  commitUsdCents: z.number().int(),
  termStartsAt: z.string(),
  termEndsAt: z.string(),
  awaitingInvoicePeriodEnd: z.string(),
});

const BANK_TRANSFER_TYPES = ["us_bank_transfer", "eu_bank_transfer"] as const;

function bankTransferTypeOf(value: string | null): BankTransferType | null {
  return BANK_TRANSFER_TYPES.includes(value as BankTransferType)
    ? (value as BankTransferType)
    : null;
}

/** A renewal recorded by an older shape is read as none rather than trusted. */
function pendingRenewalOf(
  value: Prisma.JsonValue | null,
): PendingRenewal | null {
  if (!value) return null;
  const parsed = pendingRenewalSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The stored shape of a pending renewal, or the sentinel that clears it. */
function pendingRenewalColumn(
  value: PendingRenewal | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ? { ...value } : Prisma.DbNull;
}

function toAccount(row: AccountRow): ConnectedBillingAccountRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stripeCustomerId: row.stripeCustomerId,
    usageSubscriptionId: row.usageSubscriptionId,
    usageSubscriptionItemId: row.usageSubscriptionItemId,
    termStartsAt: row.termStartsAt,
    termEndsAt: row.termEndsAt,
    commitUsdCents: row.commitUsdCents,
    seatCurrency: row.seatCurrency as ConnectedCurrency,
    seatRateCents: row.seatRateCents,
    seats: row.seats,
    bankTransferType: bankTransferTypeOf(row.bankTransferType),
    bankTransferCountry: row.bankTransferCountry,
    billingEmail: row.billingEmail,
    pendingRenewal: pendingRenewalOf(row.pendingRenewal),
  };
}

function toGrant(row: GrantRow): CreditGrantRecord {
  return {
    stripeCreditGrantId: row.stripeCreditGrantId,
    amountUsdCents: row.amountUsdCents,
    kind: row.kind,
    termEndsAt: row.termEndsAt,
    expiresAt: row.expiresAt,
  };
}

function toInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    stripeInvoiceId: row.stripeInvoiceId,
    kind: row.kind,
    currency: row.currency as ConnectedCurrency,
    amountCents: row.amountCents,
    status: row.status,
    rolledForwardTo: row.rolledForwardTo,
    paidOutOfBandAt: row.paidOutOfBandAt,
    termStartsAt: row.termStartsAt,
  };
}

export class PrismaConnectedBillingStore implements ConnectedBillingStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findAccount(
    organizationId: string,
  ): Promise<ConnectedBillingAccountRecord | null> {
    const row = await this.prisma.connectedBillingAccount.findUnique({
      where: { organizationId },
    });
    return row ? toAccount(row) : null;
  }

  async findAccountBySubscription(
    usageSubscriptionId: string,
  ): Promise<ConnectedBillingAccountRecord | null> {
    const row = await this.prisma.connectedBillingAccount.findFirst({
      where: { usageSubscriptionId },
    });
    return row ? toAccount(row) : null;
  }

  async findAccountByCustomer(
    stripeCustomerId: string,
  ): Promise<ConnectedBillingAccountRecord | null> {
    const row = await this.prisma.connectedBillingAccount.findUnique({
      where: { stripeCustomerId },
    });
    return row ? toAccount(row) : null;
  }

  async createAccount(
    account: Omit<ConnectedBillingAccountRecord, "id">,
  ): Promise<ConnectedBillingAccountRecord> {
    const { pendingRenewal, ...rest } = account;
    const row = await this.prisma.connectedBillingAccount.create({
      data: {
        ...rest,
        pendingRenewal: pendingRenewalColumn(pendingRenewal),
      },
    });
    return toAccount(row);
  }

  async updateAccount(
    id: string,
    patch: Partial<
      Omit<ConnectedBillingAccountRecord, "id" | "organizationId">
    >,
  ): Promise<ConnectedBillingAccountRecord> {
    const { pendingRenewal, ...rest } = patch;
    const row = await this.prisma.connectedBillingAccount.update({
      where: { id },
      data: {
        ...rest,
        ...(pendingRenewal === undefined
          ? {}
          : { pendingRenewal: pendingRenewalColumn(pendingRenewal) }),
      },
    });
    return toAccount(row);
  }

  async listCreditGrants(accountId: string): Promise<CreditGrantRecord[]> {
    const rows = await this.prisma.connectedCreditGrant.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toGrant);
  }

  async addCreditGrant(
    accountId: string,
    grant: CreditGrantRecord,
  ): Promise<void> {
    await this.prisma.connectedCreditGrant.upsert({
      where: { stripeCreditGrantId: grant.stripeCreditGrantId },
      create: { accountId, ...grant },
      update: {},
    });
  }

  async listInvoices(accountId: string): Promise<InvoiceRecord[]> {
    const rows = await this.prisma.connectedInvoice.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toInvoice);
  }

  async findInvoice(
    stripeInvoiceId: string,
  ): Promise<(InvoiceRecord & { accountId: string }) | null> {
    const row = await this.prisma.connectedInvoice.findUnique({
      where: { stripeInvoiceId },
    });
    return row ? { ...toInvoice(row), accountId: row.accountId } : null;
  }

  async addInvoice(accountId: string, invoice: InvoiceRecord): Promise<void> {
    await this.prisma.connectedInvoice.upsert({
      where: { stripeInvoiceId: invoice.stripeInvoiceId },
      create: { accountId, ...invoice },
      update: { status: invoice.status, amountCents: invoice.amountCents },
    });
  }

  async updateInvoice(
    stripeInvoiceId: string,
    patch: Partial<
      Pick<InvoiceRecord, "status" | "rolledForwardTo" | "paidOutOfBandAt">
    >,
  ): Promise<void> {
    await this.prisma.connectedInvoice.update({
      where: { stripeInvoiceId },
      data: patch,
    });
  }
}

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

export function createConnectedBillingStore(
  prisma: PrismaClient,
): PrismaConnectedBillingStore {
  return new PrismaConnectedBillingStore(prisma);
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
