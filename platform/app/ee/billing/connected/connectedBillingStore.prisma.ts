/**
 * The Prisma store behind connected billing (ADR-141, section 7): the account
 * per customer organization, its credit grants and its invoices. Both the
 * billing service and the seat change invoicing read and write through it.
 */

import { z } from "zod";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type {
  BankTransferType,
  ConnectedBillingAccountRecord,
  ConnectedBillingStore,
  ConnectedCurrency,
  CreditGrantRecord,
  InvoiceRecord,
  PendingRenewal,
} from "./connectedBilling.service";

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

  async findAccountById(
    accountId: string,
  ): Promise<ConnectedBillingAccountRecord | null> {
    const row = await this.prisma.connectedBillingAccount.findUnique({
      where: { id: accountId },
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
    patch: Partial<Pick<InvoiceRecord, "status" | "paidOutOfBandAt">>,
  ): Promise<void> {
    await this.prisma.connectedInvoice.update({
      where: { stripeInvoiceId },
      data: patch,
    });
  }
}

export function createConnectedBillingStore(
  prisma: PrismaClient,
): PrismaConnectedBillingStore {
  return new PrismaConnectedBillingStore(prisma);
}
