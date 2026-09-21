/**
 * Prisma, ledger and budget bindings for the monthly statement of a connected
 * self-hosted customer (ADR-141, section 7), and the one place that builds the
 * service.
 *
 * The walk starts at the organizations an operator marked as self-hosted
 * customers, because a billing account is addressed one organization at a time
 * and a bare read of every account is refused by the tenancy guard.
 *
 * Spend is summed across every project of the organization, the hidden
 * governance project included, which is the same set the usage meter reports:
 * a statement that named a different set would not add up to the invoice.
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { INSTANT_EVAL_REQUEST_TYPE } from "~/server/app-layer/instant-evals/spend/request-type";
import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { EmailMonthlyStatementMailer } from "~/server/mailer/connectedStatementMailer";
import { CONTRACT_BUDGET_EXTERNAL_ID } from "../../licensing/connect/connect.prisma";
import { statusOfIssuedLicense } from "../../licensing/registry/issuedLicense";
import type {
  MonthlyStatementStore,
  StatementAccount,
  StatementSeats,
  StatementSpendLine,
} from "./monthlyStatement.service";
import { ConnectedMonthlyStatementService } from "./monthlyStatement.service";

const CENTS_PER_USD = 100;
const NANO_USD_PER_CENT = NANO_USD_PER_USD / CENTS_PER_USD;

/**
 * The request type each hosted service records its spend under. A service with
 * no request type yet contributes nothing rather than a zero line.
 */
const SERVICE_REQUEST_TYPES: Record<string, string> = {
  instant_evals: INSTANT_EVAL_REQUEST_TYPE,
};

/** The first instant of the month after `month`. */
function nextMonthStart(month: Date): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
}

export class PrismaMonthlyStatementStore implements MonthlyStatementStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listAccounts(): Promise<StatementAccount[]> {
    const organizations = await this.prisma.organization.findMany({
      where: { selfHostedCustomer: true },
      select: { id: true, name: true },
    });

    const accounts: StatementAccount[] = [];
    for (const organization of organizations) {
      const account = await this.prisma.connectedBillingAccount.findUnique({
        where: { organizationId: organization.id },
        select: { id: true, billingEmail: true, commitUsdCents: true },
      });
      if (!account) continue;
      accounts.push({
        id: account.id,
        organizationId: organization.id,
        organizationName: organization.name,
        billingEmail: account.billingEmail,
        commitUsdCents: account.commitUsdCents,
      });
    }
    return accounts;
  }

  async spendByService({
    organizationId,
    month,
  }: {
    organizationId: string;
    month: Date;
  }): Promise<StatementSpendLine[]> {
    const spendEvents = getApp().gateway.spendEvents;
    // No ledger means the month cannot be read, and a statement that reported
    // it as zero would be wrong rather than empty.
    if (!spendEvents) return [];

    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    if (projects.length === 0) return [];
    const tenantIds = projects.map((project) => project.id);

    const lines: StatementSpendLine[] = [];
    for (const [service, requestType] of Object.entries(
      SERVICE_REQUEST_TYPES,
    )) {
      const nanoUsd = await spendEvents.sumCostNanoUsdByRequestType({
        tenantIds,
        requestType,
        fromMs: month.getTime(),
        toMs: nextMonthStart(month).getTime(),
      });
      lines.push({
        service,
        usdCents: Math.round(nanoUsd / NANO_USD_PER_CENT),
      });
    }
    return lines;
  }

  async readDrawnDownUsdCents(organizationId: string): Promise<number | null> {
    const { budgets, spendAvailable } = await GatewayBudgetService.create(
      this.prisma,
      getApp().gateway.budgets,
    ).listWithHealth(organizationId);
    if (!spendAvailable) return null;

    const contract = budgets.find(
      (budget) => budget.externalId === CONTRACT_BUDGET_EXTERNAL_ID,
    );
    if (!contract) return null;
    return Math.round(contract.spentUsd.toNumber() * CENTS_PER_USD);
  }

  async readSeats(organizationId: string): Promise<StatementSeats> {
    const rows = await this.prisma.issuedLicense.findMany({
      where: { organizationId },
      select: {
        maxMembers: true,
        reportedMembers: true,
        expiresAt: true,
        revokedAt: true,
        supersededAt: true,
      },
    });
    const now = new Date();
    const active = rows
      .filter((row) => statusOfIssuedLicense(row, now) === "active")
      .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];

    return {
      licensed: active?.maxMembers ?? 0,
      reported: active?.reportedMembers ?? null,
    };
  }

  async hasSent({
    accountId,
    month,
  }: {
    accountId: string;
    month: Date;
  }): Promise<boolean> {
    const row = await this.prisma.connectedStatement.findUnique({
      where: { accountId_month: { accountId, month } },
      select: { id: true },
    });
    return row !== null;
  }

  async recordSent({
    accountId,
    month,
    sentAt,
  }: {
    accountId: string;
    month: Date;
    sentAt: Date;
  }): Promise<void> {
    await this.prisma.connectedStatement.upsert({
      where: { accountId_month: { accountId, month } },
      create: { accountId, month, sentAt },
      update: {},
    });
  }
}

export function createConnectedMonthlyStatementService(
  prisma: PrismaClient,
): ConnectedMonthlyStatementService {
  return new ConnectedMonthlyStatementService({
    store: new PrismaMonthlyStatementStore(prisma),
    mailer: new EmailMonthlyStatementMailer(),
    now: () => new Date(),
  });
}
