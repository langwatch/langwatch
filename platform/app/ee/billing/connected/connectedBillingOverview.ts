/**
 * What the backoffice shows about a connected customer's commercial state
 * (ADR-141, section 7).
 *
 * The amount drawn down comes from LangWatch's own budget ledger, never from
 * the payment provider's credit balance, which only settles when an invoice is
 * finalized. When the ledger cannot be read the figure is null and the screen
 * says so, because zero would read as "nothing spent".
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import {
  CONTRACT_BUDGET_EXTERNAL_ID,
  createContractBudgetService,
  PrismaHostedUsageReader,
} from "../../licensing/connect/connect.prisma";
import {
  type IssuedLicenseRecord,
  statusOfIssuedLicense,
} from "../../licensing/registry/issuedLicense";
import { PrismaIssuedLicenseRepository } from "../../licensing/registry/issuedLicense.prisma";
import type {
  ConnectedBillingAccountRecord,
  ConnectedCurrency,
  CreditGrantRecord,
  InvoiceRecord,
} from "./connectedBilling.service";
import { PrismaConnectedBillingStore } from "./connectedBillingStore.prisma";

const CENTS = 100;

export interface ConnectedSpend {
  /** False when the spend ledger could not be read just now. */
  spendAvailable: boolean;
  limitUsdCents: number;
  /** Null when the ledger could not be read. Never zero in that case. */
  spentUsdCents: number | null;
}

export interface ConnectedSeatState {
  licensed: number;
  reported: number | null;
  lastSyncAt: Date | null;
}

/** One mid-term seat change and what it was invoiced. */
export interface ConnectedSeatChangeRow {
  licenseId: string;
  changedAt: Date;
  addedSeats: number;
  amountCents: number;
  currency: ConnectedCurrency;
  state: string;
  stripeInvoiceId: string | null;
}

export interface ConnectedBillingOverview {
  account: ConnectedBillingAccountRecord | null;
  grants: CreditGrantRecord[];
  invoices: InvoiceRecord[];
  spend: ConnectedSpend;
  terms: {
    commitUsdCents: number;
    maximumUsdCents: number;
    overageEnabled: boolean;
  };
  seats: ConnectedSeatState;
  seatChanges: ConnectedSeatChangeRow[];
}

const toCents = (usd: number): number => Math.round(usd * CENTS);

/** The contract budget as the customer's own calls see it. */
async function readContractSpend({
  prisma,
  organizationId,
  virtualKeyId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  virtualKeyId: string | null;
}): Promise<ConnectedSpend> {
  if (virtualKeyId) {
    const usage = await new PrismaHostedUsageReader(prisma).read({
      virtualKeyId,
      organizationId,
      projectId: null,
    });
    const contract = usage.budgets.find((budget) => budget.isContract);
    if (contract) {
      return {
        spendAvailable: usage.spendAvailable,
        limitUsdCents: toCents(contract.limitUsd),
        spentUsdCents:
          contract.spentUsd === null ? null : toCents(contract.spentUsd),
      };
    }
  }

  // No managed key yet, so no call has resolved one: read the budget directly.
  const { budgets, spendAvailable } = await GatewayBudgetService.create(
    prisma,
    getApp().gateway.budgets,
  ).listWithHealth(organizationId);
  const contract = budgets.find(
    (budget) => budget.externalId === CONTRACT_BUDGET_EXTERNAL_ID,
  );
  return {
    spendAvailable,
    limitUsdCents: contract ? toCents(contract.limitUsd.toNumber()) : 0,
    spentUsdCents:
      contract && spendAvailable ? toCents(contract.spentUsd.toNumber()) : null,
  };
}

function readSeatState({
  licenses,
  now,
}: {
  licenses: IssuedLicenseRecord[];
  now: Date;
}): ConnectedSeatState {
  const active = licenses.filter(
    (license) => statusOfIssuedLicense(license, now) === "active",
  );
  const synced = active.filter((license) => license.lastSyncAt);
  // A reissue leaves both rows active until the install presents the new
  // license, so summing them would count the same seats twice. The seats a
  // customer holds are the seats of the license that runs longest, which is
  // what the monthly statement reads too.
  const current = [...active].sort(
    (a, b) => b.expiresAt.getTime() - a.expiresAt.getTime(),
  )[0];

  return {
    licensed: current?.maxMembers ?? 0,
    reported: current?.lastSyncAt ? (current.reportedMembers ?? 0) : null,
    lastSyncAt: latest(synced.map((license) => license.lastSyncAt)),
  };
}

/** The commercial state of one connected customer, for the backoffice. */
export async function readConnectedBillingOverview({
  prisma,
  organizationId,
  now = new Date(),
}: {
  prisma: PrismaClient;
  organizationId: string;
  now?: Date;
}): Promise<ConnectedBillingOverview> {
  const store = new PrismaConnectedBillingStore(prisma);
  const licenses = await new PrismaIssuedLicenseRepository(
    prisma,
  ).findAllByOrganization(organizationId);
  const account = await store.findAccount(organizationId);

  const [terms, spend, seatChangeRows] = await Promise.all([
    createContractBudgetService(prisma).termsOf(organizationId),
    readContractSpend({
      prisma,
      organizationId,
      virtualKeyId:
        licenses.find((license) => license.virtualKeyId)?.virtualKeyId ?? null,
    }),
    prisma.connectedSeatChange.findMany({
      where: {
        licenseId: {
          in: licenses.length > 0 ? licenses.map((row) => row.id) : [""],
        },
      },
      orderBy: { changedAt: "desc" },
    }),
  ]);
  const seats = readSeatState({ licenses, now });

  return {
    account,
    grants: account ? await store.listCreditGrants(account.id) : [],
    invoices: account ? await store.listInvoices(account.id) : [],
    spend,
    terms: {
      commitUsdCents: terms.commitUsdCents,
      maximumUsdCents: terms.maximumUsdCents,
      overageEnabled: terms.overageEnabled,
    },
    seats,
    seatChanges: seatChangeRows.map((row) => ({
      licenseId: row.licenseId,
      changedAt: row.changedAt,
      addedSeats: row.addedSeats,
      amountCents: row.amountCents,
      currency: row.currency as ConnectedCurrency,
      state: row.state,
      stripeInvoiceId: row.stripeInvoiceId,
    })),
  };
}

function latest(dates: (Date | null)[]): Date | null {
  const times = dates.filter((date): date is Date => date !== null);
  return times.length > 0
    ? new Date(Math.max(...times.map((date) => date.getTime())))
    : null;
}
