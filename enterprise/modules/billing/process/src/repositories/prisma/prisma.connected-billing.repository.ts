// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import {
  type ConnectedBillingAccountRecord,
  type ConnectedCreditGrantRecord,
  type ConnectedInvoiceRecord,
  type ConnectedSeatChangeRecord,
  ConnectedBillingRepository,
  type PendingRenewal,
} from "../connected-billing.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type ConnectedBillingDatabase = Pick<
  PrismaClient,
  | "connectedBillingAccount"
  | "connectedCreditGrant"
  | "connectedInvoice"
  | "connectedSeatChange"
  | "connectedStatement"
>;

type AccountRow = Awaited<
  ReturnType<ConnectedBillingDatabase["connectedBillingAccount"]["findUnique"]>
>;
type CreditGrantRow = Awaited<
  ReturnType<ConnectedBillingDatabase["connectedCreditGrant"]["findUnique"]>
>;
type InvoiceRow = Awaited<ReturnType<ConnectedBillingDatabase["connectedInvoice"]["findUnique"]>>;
type SeatChangeRow = Awaited<
  ReturnType<ConnectedBillingDatabase["connectedSeatChange"]["findUnique"]>
>;

const pendingRenewalSchema = z.object({
  commitUsdCents: z.number().int(),
  termStartsAt: z.string(),
  termEndsAt: z.string(),
  awaitingInvoicePeriodEnd: z.string(),
});

/**
 * The stored rows of connected billing, on Prisma. Timestamps cross into the
 * process half as `Instant`; the columns themselves stay `DateTime`.
 */
export class PrismaConnectedBillingRepository extends ConnectedBillingRepository {
  private constructor(private readonly prisma: ConnectedBillingDatabase) {
    super();
  }

  static create(prisma: ConnectedBillingDatabase): PrismaConnectedBillingRepository {
    return new PrismaConnectedBillingRepository(prisma);
  }

  async findAccount(organizationId: string): Promise<ConnectedBillingAccountRecord | null> {
    return mapAccount(
      await this.prisma.connectedBillingAccount.findUnique({ where: { organizationId } }),
    );
  }

  async findAccountByCustomer(
    stripeCustomerId: string,
  ): Promise<ConnectedBillingAccountRecord | null> {
    return mapAccount(
      await this.prisma.connectedBillingAccount.findUnique({ where: { stripeCustomerId } }),
    );
  }

  async findAccountById(accountId: string): Promise<ConnectedBillingAccountRecord | null> {
    return mapAccount(
      await this.prisma.connectedBillingAccount.findUnique({ where: { id: accountId } }),
    );
  }

  async createAccount(
    account: Omit<ConnectedBillingAccountRecord, "id">,
  ): Promise<ConnectedBillingAccountRecord> {
    return toAccount(
      await this.prisma.connectedBillingAccount.create({
        data: {
          organizationId: account.organizationId,
          stripeCustomerId: account.stripeCustomerId,
          usageSubscriptionId: account.usageSubscriptionId,
          usageSubscriptionItemId: account.usageSubscriptionItemId,
          termStartsAt: toDate(account.termStartsAt),
          termEndsAt: toDate(account.termEndsAt),
          commitUsdCents: account.commitUsdCents,
          seatCurrency: account.seatCurrency,
          seatRateCents: account.seatRateCents,
          seats: account.seats,
          bankTransferType: account.bankTransferType,
          bankTransferCountry: account.bankTransferCountry,
          billingEmail: account.billingEmail,
          pendingRenewal: pendingRenewalColumn(account.pendingRenewal),
        },
      }),
    );
  }

  async updateAccount(
    accountId: string,
    patch: Partial<Omit<ConnectedBillingAccountRecord, "id" | "organizationId">>,
  ): Promise<ConnectedBillingAccountRecord> {
    const { termStartsAt, termEndsAt, pendingRenewal, ...columns } = patch;

    return toAccount(
      await this.prisma.connectedBillingAccount.update({
        where: { id: accountId },
        data: {
          ...columns,
          ...(termStartsAt === undefined ? {} : { termStartsAt: toDate(termStartsAt) }),
          ...(termEndsAt === undefined ? {} : { termEndsAt: toDate(termEndsAt) }),
          ...(pendingRenewal === undefined
            ? {}
            : { pendingRenewal: pendingRenewalColumn(pendingRenewal) }),
        },
      }),
    );
  }

  async findCreditGrants(accountId: string): Promise<ConnectedCreditGrantRecord[]> {
    const rows = await this.prisma.connectedCreditGrant.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
    });

    return rows.flatMap((row) => {
      const mapped = mapCreditGrant(row);
      return mapped ? [mapped] : [];
    });
  }

  async addCreditGrant(accountId: string, grant: ConnectedCreditGrantRecord): Promise<void> {
    // The provider minted the id under an idempotency key, so a replayed call
    // reaches the same grant and must leave the row it already wrote alone.
    await this.prisma.connectedCreditGrant.upsert({
      where: { stripeCreditGrantId: grant.stripeCreditGrantId },
      create: {
        accountId,
        stripeCreditGrantId: grant.stripeCreditGrantId,
        amountUsdCents: grant.amountUsdCents,
        kind: grant.kind,
        termEndsAt: toDate(grant.termEndsAt),
        expiresAt: toDate(grant.expiresAt),
      },
      update: {},
    });
  }

  async findInvoices(accountId: string): Promise<ConnectedInvoiceRecord[]> {
    const rows = await this.prisma.connectedInvoice.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });

    return rows.flatMap((row) => {
      const mapped = mapInvoice(row);
      return mapped ? [mapped] : [];
    });
  }

  async findInvoice(
    stripeInvoiceId: string,
  ): Promise<(ConnectedInvoiceRecord & { accountId: string }) | null> {
    const row = await this.prisma.connectedInvoice.findUnique({ where: { stripeInvoiceId } });
    const mapped = mapInvoice(row);

    return row && mapped ? { ...mapped, accountId: row.accountId } : null;
  }

  async updateInvoice(
    stripeInvoiceId: string,
    patch: Partial<Pick<ConnectedInvoiceRecord, "status" | "paidOutOfBandAt">>,
  ): Promise<void> {
    await this.prisma.connectedInvoice.update({
      where: { stripeInvoiceId },
      data: {
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.paidOutOfBandAt === undefined
          ? {}
          : { paidOutOfBandAt: patch.paidOutOfBandAt && toDate(patch.paidOutOfBandAt) }),
      },
    });
  }

  async findSeatChange(licenseRowId: string): Promise<ConnectedSeatChangeRecord | null> {
    return mapSeatChange(
      await this.prisma.connectedSeatChange.findUnique({ where: { licenseId: licenseRowId } }),
    );
  }

  async recordSeatChange(record: ConnectedSeatChangeRecord): Promise<void> {
    const columns = {
      accountId: record.accountId,
      changedAt: toDate(record.changedAt),
      addedSeats: record.addedSeats,
      unitAmountCents: record.unitAmountCents,
      amountCents: record.amountCents,
      currency: record.currency,
      state: record.state,
      stripeInvoiceId: record.stripeInvoiceId,
    };
    await this.prisma.connectedSeatChange.upsert({
      where: { licenseId: record.licenseRowId },
      create: { licenseId: record.licenseRowId, ...columns },
      update: columns,
    });
  }

  async findPendingSeatChanges(): Promise<ConnectedSeatChangeRecord[]> {
    const rows = await this.prisma.connectedSeatChange.findMany({
      where: { state: "intent" },
      orderBy: { changedAt: "asc" },
    });

    return rows.flatMap((row) => {
      const mapped = mapSeatChange(row);
      return mapped ? [mapped] : [];
    });
  }

  async findSeatChangesForAccount(accountId: string): Promise<ConnectedSeatChangeRecord[]> {
    const rows = await this.prisma.connectedSeatChange.findMany({
      where: { accountId },
      orderBy: { changedAt: "desc" },
    });

    return rows.flatMap((row) => {
      const mapped = mapSeatChange(row);
      return mapped ? [mapped] : [];
    });
  }

  async findAccountsForOrganizations(
    organizationIds: readonly string[],
  ): Promise<ConnectedBillingAccountRecord[]> {
    if (organizationIds.length === 0) return [];
    const rows = await this.prisma.connectedBillingAccount.findMany({
      where: { organizationId: { in: [...organizationIds] } },
      orderBy: { organizationId: "asc" },
    });

    return rows.map(toAccount);
  }

  async hasSentStatement({
    accountId,
    month,
  }: {
    accountId: string;
    month: Instant;
  }): Promise<boolean> {
    const row = await this.prisma.connectedStatement.findUnique({
      where: { accountId_month: { accountId, month: toDate(month) } },
      select: { id: true },
    });

    return row !== null;
  }

  async recordStatementSent({
    accountId,
    month,
    sentAt,
  }: {
    accountId: string;
    month: Instant;
    sentAt: Instant;
  }): Promise<void> {
    await this.prisma.connectedStatement.upsert({
      where: { accountId_month: { accountId, month: toDate(month) } },
      create: { accountId, month: toDate(month), sentAt: toDate(sentAt) },
      update: {},
    });
  }

  async addInvoice(accountId: string, invoice: ConnectedInvoiceRecord): Promise<void> {
    const columns = {
      accountId,
      kind: invoice.kind,
      currency: invoice.currency,
      amountCents: invoice.amountCents,
      status: invoice.status,
      paidOutOfBandAt: invoice.paidOutOfBandAt ? toDate(invoice.paidOutOfBandAt) : null,
      termStartsAt: invoice.termStartsAt ? toDate(invoice.termStartsAt) : null,
    };
    // The provider is the source of the id, and the daily tick can replay a
    // call whose answer never reached us, so the same invoice arriving twice
    // updates the row rather than colliding on its unique column.
    await this.prisma.connectedInvoice.upsert({
      where: { stripeInvoiceId: invoice.stripeInvoiceId },
      create: { stripeInvoiceId: invoice.stripeInvoiceId, ...columns },
      update: columns,
    });
  }
}

function mapAccount(row: AccountRow): ConnectedBillingAccountRecord | null {
  return row ? toAccount(row) : null;
}

function toAccount(row: NonNullable<AccountRow>): ConnectedBillingAccountRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stripeCustomerId: row.stripeCustomerId,
    usageSubscriptionId: row.usageSubscriptionId,
    usageSubscriptionItemId: row.usageSubscriptionItemId,
    termStartsAt: fromDate(row.termStartsAt),
    termEndsAt: fromDate(row.termEndsAt),
    commitUsdCents: row.commitUsdCents,
    seatCurrency: row.seatCurrency,
    seatRateCents: row.seatRateCents,
    seats: row.seats,
    bankTransferType: bankTransferTypeOf(row.bankTransferType),
    bankTransferCountry: row.bankTransferCountry,
    billingEmail: row.billingEmail,
    // A renewal recorded under an older shape reads as none rather than trusted.
    pendingRenewal: pendingRenewalSchema.safeParse(row.pendingRenewal).data ?? null,
  };
}

/**
 * The column is a plain string, so a value that is neither spelling reads as
 * no bank transfer: the invoice then carries LangWatch's own bank details,
 * which is the safe end of the two.
 */
function bankTransferTypeOf(
  stored: string | null,
): ConnectedBillingAccountRecord["bankTransferType"] {
  return stored === "us_bank_transfer" || stored === "eu_bank_transfer" ? stored : null;
}

/** The stored shape of a pending renewal, or the sentinel that clears the column. */
function pendingRenewalColumn(
  value: PendingRenewal | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ? { ...value } : Prisma.DbNull;
}

function mapCreditGrant(row: CreditGrantRow): ConnectedCreditGrantRecord | null {
  if (!row) return null;

  return {
    stripeCreditGrantId: row.stripeCreditGrantId,
    amountUsdCents: row.amountUsdCents,
    kind: row.kind,
    termEndsAt: fromDate(row.termEndsAt),
    expiresAt: fromDate(row.expiresAt),
  };
}

function mapInvoice(row: InvoiceRow): ConnectedInvoiceRecord | null {
  if (!row) return null;

  return {
    stripeInvoiceId: row.stripeInvoiceId,
    kind: row.kind,
    currency: row.currency,
    amountCents: row.amountCents,
    status: row.status,
    paidOutOfBandAt: row.paidOutOfBandAt && fromDate(row.paidOutOfBandAt),
    termStartsAt: row.termStartsAt && fromDate(row.termStartsAt),
  };
}

function mapSeatChange(row: SeatChangeRow): ConnectedSeatChangeRecord | null {
  if (!row) return null;

  return {
    licenseRowId: row.licenseId,
    accountId: row.accountId,
    changedAt: fromDate(row.changedAt),
    addedSeats: row.addedSeats,
    unitAmountCents: row.unitAmountCents,
    amountCents: row.amountCents,
    currency: row.currency,
    state: row.state,
    stripeInvoiceId: row.stripeInvoiceId,
  };
}
