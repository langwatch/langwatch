// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingCheckpoint } from "../billing-checkpoint.repository.ts";
import type {
  ConnectedBillingAccountRecord,
  ConnectedCreditGrantRecord,
  ConnectedInvoiceRecord,
  ConnectedSeatChangeRecord,
} from "../connected-billing.repository.ts";
import type { BillingSubscriptionRecord } from "../subscription.repository.ts";

/** An organization as every billing row in the memory tier sees it. */
export type MemoryBillingOrganization = {
  id: string;
  name: string;
  stripeCustomerId: string | null;
  pricingModel: string | null;
  currency: string | null;
  license: string | null;
  /** An operator marked this organization a connected self-hosted customer. */
  selfHostedCustomer: boolean;
  teamIds: string[];
  signupData: Record<string, unknown>;
};

/** A project as project's shared table shows it to billing. */
export type MemoryBillingProject = {
  id: string;
  name: string;
  organizationId: string;
  archived: boolean;
  governance: boolean;
};

/** One request's row in gateway's shared spend ledger, at its latest status. */
export type MemoryBillingSpendRow = {
  tenantId: string;
  requestType: string;
  status: string;
  costNanoUsd: number;
  occurredAtMs: number;
};

/**
 * One store behind the billing memory tier, the way one Postgres schema serves
 * the Prisma tier: a subscription written through `subscriptions` is what the
 * report and the pricing answer from.
 */
export class MemoryBillingStore {
  readonly organizations = new Map<string, MemoryBillingOrganization>();
  /** Connected self-hosted billing accounts, keyed by organization. */
  readonly connectedBillingAccounts = new Map<string, ConnectedBillingAccountRecord>();
  readonly connectedSeatChanges = new Map<string, ConnectedSeatChangeRecord>();
  /** The prepaid credits of one account, oldest first. */
  readonly connectedCreditGrants = new Map<string, ConnectedCreditGrantRecord[]>();
  readonly connectedInvoices = new Map<string, ConnectedInvoiceRecord & { accountId: string }>();
  /** When each account's statement for a month went out, keyed `accountId|month`. */
  readonly connectedStatements = new Map<string, string>();
  readonly subscriptions: BillingSubscriptionRecord[] = [];
  readonly checkpoints = new Map<string, BillingCheckpoint>();
  readonly organizationOfTenant = new Map<string, string>();
  /** Project's rows and gateway's ledger, as their shares show them to billing. */
  readonly projects: MemoryBillingProject[] = [];
  readonly gatewaySpend: MemoryBillingSpendRow[] = [];
  spendSourceAvailable = true;

  static create(): MemoryBillingStore {
    return new MemoryBillingStore();
  }

  /** The key a checkpoint is stored under; one row per organization month meter. */
  static checkpointKey(input: {
    organizationId: string;
    billingMonth: string;
    meter: string;
  }): string {
    return `${input.organizationId}:${input.billingMonth}:${input.meter}`;
  }
}
