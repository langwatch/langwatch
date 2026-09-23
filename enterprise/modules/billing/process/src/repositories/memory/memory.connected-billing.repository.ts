// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

import {
  type ConnectedBillingAccountRecord,
  type ConnectedCreditGrantRecord,
  type ConnectedInvoiceRecord,
  type ConnectedSeatChangeRecord,
  ConnectedBillingRepository,
} from "../connected-billing.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/**
 * The in-memory twin of connected billing's stored rows, over the one billing
 * store, so an account written here is the account the monthly roll-up reads.
 *
 * It keeps the two unique indexes the tables carry: one account per
 * organization, and one seat change per reissued license. The seat change's
 * uniqueness is what makes the write idempotent, so a twin that let a second
 * row in would pass a test the database would fail.
 */
export class MemoryConnectedBillingRepository extends ConnectedBillingRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryConnectedBillingRepository {
    return new MemoryConnectedBillingRepository(store);
  }

  async findAccount(organizationId: string): Promise<ConnectedBillingAccountRecord | null> {
    return this.store.connectedBillingAccounts.get(organizationId) ?? null;
  }

  async findAccountByCustomer(
    stripeCustomerId: string,
  ): Promise<ConnectedBillingAccountRecord | null> {
    for (const account of this.store.connectedBillingAccounts.values()) {
      if (account.stripeCustomerId === stripeCustomerId) return account;
    }

    return null;
  }

  async findAccountById(accountId: string): Promise<ConnectedBillingAccountRecord | null> {
    for (const account of this.store.connectedBillingAccounts.values()) {
      if (account.id === accountId) return account;
    }

    return null;
  }

  async createAccount(
    account: Omit<ConnectedBillingAccountRecord, "id">,
  ): Promise<ConnectedBillingAccountRecord> {
    if (this.store.connectedBillingAccounts.has(account.organizationId)) {
      throw new Error(`organization ${account.organizationId} already has a billing account`);
    }

    const created = {
      id: `cba_memory_${this.store.connectedBillingAccounts.size + 1}`,
      ...account,
    };
    this.store.connectedBillingAccounts.set(account.organizationId, created);

    return created;
  }

  async updateAccount(
    accountId: string,
    patch: Partial<Omit<ConnectedBillingAccountRecord, "id" | "organizationId">>,
  ): Promise<ConnectedBillingAccountRecord> {
    const account = await this.findAccountById(accountId);
    if (!account) throw new Error(`no billing account ${accountId}`);

    const updated = { ...account, ...patch };
    this.store.connectedBillingAccounts.set(account.organizationId, updated);

    return updated;
  }

  async findCreditGrants(accountId: string): Promise<ConnectedCreditGrantRecord[]> {
    return (this.store.connectedCreditGrants.get(accountId) ?? []).map((grant) => ({ ...grant }));
  }

  async addCreditGrant(accountId: string, grant: ConnectedCreditGrantRecord): Promise<void> {
    const grants = this.store.connectedCreditGrants.get(accountId) ?? [];
    // The provider's id is unique, so a replayed call leaves one grant.
    if (grants.some((held) => held.stripeCreditGrantId === grant.stripeCreditGrantId)) return;

    this.store.connectedCreditGrants.set(accountId, [...grants, grant]);
  }

  async findInvoices(accountId: string): Promise<ConnectedInvoiceRecord[]> {
    return [...this.store.connectedInvoices.values()]
      .filter((invoice) => invoice.accountId === accountId)
      .map(({ accountId: _accountId, ...invoice }) => invoice);
  }

  async findInvoice(
    stripeInvoiceId: string,
  ): Promise<(ConnectedInvoiceRecord & { accountId: string }) | null> {
    return this.store.connectedInvoices.get(stripeInvoiceId) ?? null;
  }

  async updateInvoice(
    stripeInvoiceId: string,
    patch: Partial<Pick<ConnectedInvoiceRecord, "status" | "paidOutOfBandAt">>,
  ): Promise<void> {
    const stored = this.store.connectedInvoices.get(stripeInvoiceId);
    if (!stored) throw new Error(`no invoice ${stripeInvoiceId}`);

    this.store.connectedInvoices.set(stripeInvoiceId, { ...stored, ...patch });
  }

  async findSeatChange(licenseRowId: string): Promise<ConnectedSeatChangeRecord | null> {
    return this.store.connectedSeatChanges.get(licenseRowId) ?? null;
  }

  async recordSeatChange(record: ConnectedSeatChangeRecord): Promise<void> {
    this.store.connectedSeatChanges.set(record.licenseRowId, record);
  }

  async findPendingSeatChanges(): Promise<ConnectedSeatChangeRecord[]> {
    return [...this.store.connectedSeatChanges.values()]
      .filter((change) => change.state === "intent")
      .toSorted((a, b) => a.changedAt.epochMilliseconds - b.changedAt.epochMilliseconds);
  }

  async findSeatChangesForAccount(accountId: string): Promise<ConnectedSeatChangeRecord[]> {
    return [...this.store.connectedSeatChanges.values()]
      .filter((change) => change.accountId === accountId)
      .toSorted((a, b) => b.changedAt.epochMilliseconds - a.changedAt.epochMilliseconds);
  }

  async addInvoice(accountId: string, invoice: ConnectedInvoiceRecord): Promise<void> {
    this.store.connectedInvoices.set(invoice.stripeInvoiceId, { ...invoice, accountId });
  }

  async findAccountsForOrganizations(
    organizationIds: readonly string[],
  ): Promise<ConnectedBillingAccountRecord[]> {
    return [...organizationIds].toSorted().flatMap((organizationId) => {
      const account = this.store.connectedBillingAccounts.get(organizationId);
      return account ? [account] : [];
    });
  }

  async hasSentStatement({
    accountId,
    month,
  }: {
    accountId: string;
    month: Instant;
  }): Promise<boolean> {
    return this.store.connectedStatements.has(statementKey(accountId, month));
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
    const key = statementKey(accountId, month);
    if (!this.store.connectedStatements.has(key)) {
      this.store.connectedStatements.set(key, sentAt.toString());
    }
  }
}

/** The pair the table's unique index is on. */
function statementKey(accountId: string, month: Instant): string {
  return `${accountId}|${month.toString()}`;
}
