// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import {
  PaymentRecoveryRepository,
  type ClosePaymentRecoveryResult,
  type PaymentRecoveryCase,
} from "../payment-recovery.repository.ts";

type PaymentRecoveryDatabase = Pick<PrismaClient, "subscription" | "$executeRaw">;

const CASE_COLUMNS = {
  id: true,
  organizationId: true,
  plan: true,
  stripeSubscriptionId: true,
  paymentRecoveryInvoiceId: true,
  paymentRecoveryStartedAt: true,
  paymentRecoveryNoticeDay: true,
} as const;

type CaseRow = {
  id: string;
  organizationId: string;
  plan: string;
  stripeSubscriptionId: string | null;
  paymentRecoveryInvoiceId: string | null;
  paymentRecoveryStartedAt: Date | null;
  paymentRecoveryNoticeDay: number | null;
};

/**
 * The recovery columns on Subscription. Each write is one conditional UPDATE: a write parked on
 * the row lock re-checks its condition against the committed row, so only one of two wins.
 */
export class PrismaPaymentRecoveryRepository extends PaymentRecoveryRepository {
  private constructor(private readonly prisma: PaymentRecoveryDatabase) {
    super();
  }

  static create(prisma: PaymentRecoveryDatabase): PrismaPaymentRecoveryRepository {
    return new PrismaPaymentRecoveryRepository(prisma);
  }

  async open({
    subscriptionId,
    invoiceId,
    startedAt,
  }: {
    subscriptionId: string;
    invoiceId: string;
    startedAt: Instant;
  }): Promise<boolean> {
    const opened = await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // A subscription row is addressed by its own primary key.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "Subscription"
         SET "paymentRecoveryInvoiceId" = ${invoiceId},
             "paymentRecoveryStartedAt" = ${toDate(startedAt)},
             "paymentRecoveryNoticeDay" = NULL
       WHERE "id" = ${subscriptionId}
         AND "paymentRecoveryStartedAt" IS NULL
    `;
    return opened === 1;
  }

  async close({
    subscriptionId,
    invoiceId,
  }: {
    subscriptionId: string;
    invoiceId?: string;
  }): Promise<ClosePaymentRecoveryResult> {
    const row = await this.prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        paymentRecoveryStartedAt: { not: null },
        ...(invoiceId === undefined ? {} : { paymentRecoveryInvoiceId: invoiceId }),
      },
      select: CASE_COLUMNS,
    });
    const open = row ? openCases([row])[0] : undefined;
    if (!open) return { outcome: "not_open" };
    // Conditional on the case read: a concurrent close re-checks the committed row and loses.
    const closed = await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // A subscription row is addressed by its own primary key.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "Subscription"
         SET "paymentRecoveryInvoiceId" = NULL,
             "paymentRecoveryStartedAt" = NULL,
             "paymentRecoveryNoticeDay" = NULL
       WHERE "id" = ${subscriptionId}
         AND "paymentRecoveryInvoiceId" = ${open.invoiceId}
         AND "paymentRecoveryStartedAt" IS NOT NULL
    `;
    return closed === 1 ? { outcome: "closed", closed: open } : { outcome: "not_open" };
  }

  async advanceNotice({
    subscriptionId,
    from,
    to,
  }: {
    subscriptionId: string;
    from: number | null;
    to: number;
  }): Promise<boolean> {
    // A raw write: Prisma's updateMany selects ids first and drops the condition under a race.
    const advanced = await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // A subscription row is addressed by its own primary key.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "Subscription"
         SET "paymentRecoveryNoticeDay" = ${to}
       WHERE "id" = ${subscriptionId}
         AND "paymentRecoveryStartedAt" IS NOT NULL
         AND "paymentRecoveryNoticeDay" IS NOT DISTINCT FROM ${from}::integer
    `;
    return advanced === 1;
  }

  async findOpen(): Promise<PaymentRecoveryCase[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { paymentRecoveryStartedAt: { not: null } },
      select: CASE_COLUMNS,
      orderBy: [{ paymentRecoveryStartedAt: "asc" }, { id: "asc" }],
    });
    return openCases(rows);
  }

  async findOpenForOrganization(organizationId: string): Promise<PaymentRecoveryCase[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { organizationId, paymentRecoveryStartedAt: { not: null } },
      select: CASE_COLUMNS,
      orderBy: [{ paymentRecoveryStartedAt: "asc" }, { id: "asc" }],
    });
    return openCases(rows);
  }
}

/** The rows that hold an open case, as cases; a half-written row holds none. */
function openCases(rows: readonly CaseRow[]): PaymentRecoveryCase[] {
  return rows.flatMap((row) => {
    const { paymentRecoveryStartedAt: startedAt, paymentRecoveryInvoiceId: invoiceId } = row;
    if (!startedAt || !invoiceId) return [];
    return [
      {
        subscriptionId: row.id,
        organizationId: row.organizationId,
        plan: row.plan,
        stripeSubscriptionId: row.stripeSubscriptionId,
        invoiceId,
        startedAt: fromDate(startedAt),
        noticeDay: row.paymentRecoveryNoticeDay,
      },
    ];
  });
}
