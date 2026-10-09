/**
 * Invoice billing for a connected self-hosted customer (ADR-141, section 7).
 *
 * The customer pays by invoice. Hosted usage draws down a prepaid commit at
 * list rates through the payment provider's meter; the commit itself is a
 * paid credit that applies to metered usage only, so a seat invoice can never
 * draw it down. Seats and the commit are lines on a one-off annual invoice in
 * the currency of the seat contract; usage rides one quarterly USD
 * subscription that is kept across terms.
 *
 * Every step stores the id it created before the next one runs, and every
 * entry point reads those ids first, so a run that failed halfway resumes and
 * a run repeated with the same terms creates nothing twice.
 *
 * The cap the customer sees and the hard stop are the organization budget the
 * registry keeps equal to the license's commit. This service never sets a cap
 * of its own: it asks the registry to raise the commit and to sync or reset
 * that budget, so there is one source for the number.
 */

import { HandledError } from "@langwatch/handled-error";

export type ConnectedCurrency = "USD" | "EUR";
export type BankTransferType = "us_bank_transfer" | "eu_bank_transfer";

/** Days after the term ends in which the last usage invoice can still draw the credit. */
export const CREDIT_GRANT_GRACE_DAYS = 14;
/** How long an invoice may stay unpaid. */
export const INVOICE_DAYS_UNTIL_DUE = 30;

export interface BankTransfer {
  type: BankTransferType;
  /** Two-letter country, required for an EU transfer. */
  country?: string;
}

export interface ConnectedBillingAccountRecord {
  id: string;
  organizationId: string;
  stripeCustomerId: string;
  usageSubscriptionId: string | null;
  usageSubscriptionItemId: string | null;
  termStartsAt: Date;
  termEndsAt: Date;
  commitUsdCents: number;
  seatCurrency: ConnectedCurrency;
  seatRateCents: number;
  seats: number;
  bankTransferType: BankTransferType | null;
  bankTransferCountry: string | null;
  billingEmail: string;
  pendingRenewal: PendingRenewal | null;
}

export interface PendingRenewal {
  commitUsdCents: number;
  termStartsAt: string;
  termEndsAt: string;
  /** The old term's end: the usage invoice covering it must be finalized first. */
  awaitingInvoicePeriodEnd: string;
}

export type CreditGrantKind = "commit" | "added" | "renewal";
export type InvoiceKind = "annual" | "seat_change" | "usage";

export interface CreditGrantRecord {
  stripeCreditGrantId: string;
  amountUsdCents: number;
  kind: CreditGrantKind;
  termEndsAt: Date;
  expiresAt: Date;
}

export interface InvoiceRecord {
  stripeInvoiceId: string;
  kind: InvoiceKind;
  currency: ConnectedCurrency;
  amountCents: number;
  status: string;
  paidOutOfBandAt: Date | null;
  termStartsAt: Date | null;
}

/** What is stored on this side. */
export interface ConnectedBillingStore {
  findAccount(
    organizationId: string,
  ): Promise<ConnectedBillingAccountRecord | null>;
  findAccountBySubscription(
    usageSubscriptionId: string,
  ): Promise<ConnectedBillingAccountRecord | null>;
  createAccount(
    account: Omit<ConnectedBillingAccountRecord, "id">,
  ): Promise<ConnectedBillingAccountRecord>;
  updateAccount(
    id: string,
    patch: Partial<
      Omit<ConnectedBillingAccountRecord, "id" | "organizationId">
    >,
  ): Promise<ConnectedBillingAccountRecord>;
  listCreditGrants(accountId: string): Promise<CreditGrantRecord[]>;
  addCreditGrant(accountId: string, grant: CreditGrantRecord): Promise<void>;
  listInvoices(accountId: string): Promise<InvoiceRecord[]>;
  findInvoice(
    stripeInvoiceId: string,
  ): Promise<(InvoiceRecord & { accountId: string }) | null>;
  addInvoice(accountId: string, invoice: InvoiceRecord): Promise<void>;
  updateInvoice(
    stripeInvoiceId: string,
    patch: Partial<Pick<InvoiceRecord, "status" | "paidOutOfBandAt">>,
  ): Promise<void>;
}

export interface InvoiceLine {
  description: string;
  /** The whole line. With a quantity, `unitAmountCents` times `quantity`. */
  amountCents: number;
  /** Set when the customer should read a unit and a count rather than one total. */
  quantity?: number;
  unitAmountCents?: number;
}

export interface ProviderInvoice {
  id: string;
  status: string;
  currency: string;
  amountDueCents: number;
  subscriptionId: string | null;
  /** End of the period the invoice covers, for a subscription invoice. */
  periodEnd: Date | null;
}

/** The payment provider, narrowed to what this service does with it. */
export interface ConnectedBillingProvider {
  createCustomer(input: {
    organizationId: string;
    name: string;
    email: string;
    bankTransfer: BankTransfer | null;
    invoiceFooter: string | null;
  }): Promise<{ id: string }>;
  createUsageSubscription(input: {
    customerId: string;
    termStartsAt: Date;
    bankTransfer: BankTransfer | null;
  }): Promise<{ id: string; itemId: string }>;
  createCreditGrant(input: {
    customerId: string;
    name: string;
    amountUsdCents: number;
    expiresAt: Date;
    metadata: Record<string, string>;
  }): Promise<{ id: string }>;
  createOneOffInvoice(input: {
    customerId: string;
    currency: ConnectedCurrency;
    lines: InvoiceLine[];
    bankTransfer: BankTransfer | null;
    metadata: Record<string, string>;
  }): Promise<ProviderInvoice>;
  retrieveInvoice(id: string): Promise<ProviderInvoice>;
  /** Whether a finalized usage invoice covers the period ending at `periodEnd`. */
  hasFinalizedUsageInvoice(input: {
    subscriptionId: string;
    periodEnd: Date;
  }): Promise<boolean>;
  payOutOfBand(invoiceId: string): Promise<void>;
}

/** The registry's view of the license: the commit is agreed there, not here. */
export interface ConnectedBillingTerms {
  termsOf(organizationId: string): Promise<{ commitUsdCents: number }>;
  raiseCommit(input: {
    organizationId: string;
    byUsdCents: number;
    operatorId: string;
  }): Promise<void>;
  /** Re-derives the organization budget's cap from the license terms. */
  syncBudget(input: {
    organizationId: string;
    operatorId: string;
  }): Promise<void>;
  /** Starts a new budget window: spend so far no longer counts. */
  resetBudget(input: {
    organizationId: string;
    operatorId: string;
  }): Promise<void>;
}

export interface ConnectedBillingDeps {
  store: ConnectedBillingStore;
  provider: ConnectedBillingProvider;
  terms: ConnectedBillingTerms;
  /** Billing runs on LangWatch Cloud only. */
  isCloud: () => boolean;
  /** Bank details printed on invoices paid outside the provider. */
  bankDetails: () => string | null;
  now?: () => Date;
}

export interface OnboardInput {
  organizationId: string;
  organizationName: string;
  billingEmail: string;
  termStartsAt: Date;
  termEndsAt: Date;
  seats: number;
  seatRateCents: number;
  seatCurrency: ConnectedCurrency;
  commitUsdCents: number;
  bankTransfer: BankTransfer | null;
  operatorId: string;
}

export interface RenewInput {
  organizationId: string;
  termStartsAt: Date;
  termEndsAt: Date;
  seats: number;
  seatRateCents: number;
  seatCurrency: ConnectedCurrency;
  commitUsdCents: number;
  operatorId: string;
}

export class ConnectedBillingUnavailableError extends HandledError {
  declare readonly code: "connected_billing_unavailable";
  constructor() {
    super(
      "connected_billing_unavailable",
      "Billing for connected customers is only available on LangWatch Cloud",
      { httpStatus: 403, fault: "customer" },
    );
    this.name = "ConnectedBillingUnavailableError";
  }
}

export class ConnectedBillingCommitMismatchError extends HandledError {
  declare readonly code: "connected_billing_commit_mismatch";
  constructor(licenseCommitUsd: number) {
    super(
      "connected_billing_commit_mismatch",
      "The commit does not match what the license terms say",
      { httpStatus: 400, fault: "customer", meta: { licenseCommitUsd } },
    );
    this.name = "ConnectedBillingCommitMismatchError";
  }
}

export class ConnectedBillingNotOnboardedError extends HandledError {
  declare readonly code: "connected_billing_not_onboarded";
  constructor() {
    super(
      "connected_billing_not_onboarded",
      "This customer has no billing account yet",
      { httpStatus: 404, fault: "customer" },
    );
    this.name = "ConnectedBillingNotOnboardedError";
  }
}

export class ConnectedBillingService {
  private readonly now: () => Date;

  constructor(private readonly deps: ConnectedBillingDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Onboards a customer, or completes an onboarding that stopped halfway.
   * Each step is skipped when its id is already stored.
   */
  async onboard(input: OnboardInput): Promise<ConnectedBillingAccountRecord> {
    this.requireCloud();
    await this.requireCommitAgreed(input.organizationId, input.commitUsdCents);

    const account =
      (await this.deps.store.findAccount(input.organizationId)) ??
      (await this.createAccount(input));
    await this.ensureUsageSubscription(account);
    await this.ensureCreditGrant({
      account,
      kind: "commit",
      amountUsdCents: input.commitUsdCents,
      termEndsAt: input.termEndsAt,
    });
    await this.ensureAnnualInvoice({
      account,
      termStartsAt: input.termStartsAt,
      seats: input.seats,
      seatRateCents: input.seatRateCents,
      seatCurrency: input.seatCurrency,
      commitUsdCents: input.commitUsdCents,
    });
    await this.deps.terms.syncBudget({
      organizationId: input.organizationId,
      operatorId: input.operatorId,
    });
    return (await this.deps.store.findAccount(input.organizationId)) ?? account;
  }

  /** Raises the commit mid-term: a second paid credit, and the budget with it. */
  async addCommit(input: {
    organizationId: string;
    amountUsdCents: number;
    operatorId: string;
  }): Promise<CreditGrantRecord> {
    this.requireCloud();
    const account = await this.requireAccount(input.organizationId);
    await this.deps.terms.raiseCommit({
      organizationId: input.organizationId,
      byUsdCents: input.amountUsdCents,
      operatorId: input.operatorId,
    });
    const grant = await this.createGrant({
      account,
      kind: "added",
      amountUsdCents: input.amountUsdCents,
      termEndsAt: account.termEndsAt,
    });
    await this.deps.store.updateAccount(account.id, {
      commitUsdCents: account.commitUsdCents + input.amountUsdCents,
    });
    return grant;
  }

  /**
   * Renews for a new term. The usage subscription stays. The renewal credit
   * waits until the usage invoice for the old term's last quarter is
   * finalized, or it would absorb that quarter's overage; until then the
   * renewal is pending and `completeRenewalIfDue` finishes it.
   */
  async renew(input: RenewInput): Promise<ConnectedBillingAccountRecord> {
    this.requireCloud();
    await this.requireCommitAgreed(input.organizationId, input.commitUsdCents);
    const before = await this.requireAccount(input.organizationId);

    const account = await this.deps.store.updateAccount(before.id, {
      termStartsAt: input.termStartsAt,
      termEndsAt: input.termEndsAt,
      seats: input.seats,
      seatRateCents: input.seatRateCents,
      seatCurrency: input.seatCurrency,
      commitUsdCents: input.commitUsdCents,
      pendingRenewal: {
        commitUsdCents: input.commitUsdCents,
        termStartsAt: input.termStartsAt.toISOString(),
        termEndsAt: input.termEndsAt.toISOString(),
        awaitingInvoicePeriodEnd: before.termEndsAt.toISOString(),
      },
    });
    await this.ensureAnnualInvoice({
      account,
      termStartsAt: input.termStartsAt,
      seats: input.seats,
      seatRateCents: input.seatRateCents,
      seatCurrency: input.seatCurrency,
      commitUsdCents: input.commitUsdCents,
    });
    await this.deps.terms.resetBudget({
      organizationId: input.organizationId,
      operatorId: input.operatorId,
    });
    await this.deps.terms.syncBudget({
      organizationId: input.organizationId,
      operatorId: input.operatorId,
    });
    await this.completeRenewalIfDue({ organizationId: input.organizationId });
    return (await this.deps.store.findAccount(input.organizationId)) ?? account;
  }

  /** Creates the renewal credit once the old term's last usage invoice is finalized. */
  async completeRenewalIfDue(input: {
    organizationId: string;
  }): Promise<"completed" | "waiting" | "none"> {
    const account = await this.requireAccount(input.organizationId);
    const pending = account.pendingRenewal;
    if (!pending) return "none";
    if (!account.usageSubscriptionId) return "waiting";

    const settled = await this.deps.provider.hasFinalizedUsageInvoice({
      subscriptionId: account.usageSubscriptionId,
      periodEnd: new Date(pending.awaitingInvoicePeriodEnd),
    });
    if (!settled) return "waiting";

    await this.ensureCreditGrant({
      account,
      kind: "renewal",
      amountUsdCents: pending.commitUsdCents,
      termEndsAt: new Date(pending.termEndsAt),
    });
    await this.deps.store.updateAccount(account.id, { pendingRenewal: null });
    return "completed";
  }

  /** Finance received the money outside the provider. */
  async markPaidOutOfBand(input: { stripeInvoiceId: string }): Promise<void> {
    this.requireCloud();
    await this.deps.provider.payOutOfBand(input.stripeInvoiceId);
    const stored = await this.deps.store.findInvoice(input.stripeInvoiceId);
    if (stored) {
      await this.deps.store.updateInvoice(input.stripeInvoiceId, {
        status: "paid",
        paidOutOfBandAt: this.now(),
      });
    }
  }

  private requireCloud(): void {
    if (!this.deps.isCloud()) throw new ConnectedBillingUnavailableError();
  }

  private async requireAccount(
    organizationId: string,
  ): Promise<ConnectedBillingAccountRecord> {
    const account = await this.deps.store.findAccount(organizationId);
    if (!account) throw new ConnectedBillingNotOnboardedError();
    return account;
  }

  /** The commit is agreed on the license; billing follows it, never the other way. */
  private async requireCommitAgreed(
    organizationId: string,
    commitUsdCents: number,
  ): Promise<void> {
    const terms = await this.deps.terms.termsOf(organizationId);
    if (terms.commitUsdCents !== commitUsdCents) {
      throw new ConnectedBillingCommitMismatchError(terms.commitUsdCents / 100);
    }
  }

  private async createAccount(
    input: OnboardInput,
  ): Promise<ConnectedBillingAccountRecord> {
    const customer = await this.deps.provider.createCustomer({
      organizationId: input.organizationId,
      name: input.organizationName,
      email: input.billingEmail,
      bankTransfer: input.bankTransfer,
      invoiceFooter: input.bankTransfer ? null : this.deps.bankDetails(),
    });
    return await this.deps.store.createAccount({
      organizationId: input.organizationId,
      stripeCustomerId: customer.id,
      usageSubscriptionId: null,
      usageSubscriptionItemId: null,
      termStartsAt: input.termStartsAt,
      termEndsAt: input.termEndsAt,
      commitUsdCents: input.commitUsdCents,
      seatCurrency: input.seatCurrency,
      seatRateCents: input.seatRateCents,
      seats: input.seats,
      bankTransferType: input.bankTransfer?.type ?? null,
      bankTransferCountry: input.bankTransfer?.country ?? null,
      billingEmail: input.billingEmail,
      pendingRenewal: null,
    });
  }

  private async ensureUsageSubscription(
    account: ConnectedBillingAccountRecord,
  ): Promise<void> {
    if (account.usageSubscriptionId) return;
    const subscription = await this.deps.provider.createUsageSubscription({
      customerId: account.stripeCustomerId,
      termStartsAt: account.termStartsAt,
      bankTransfer: bankTransferOf(account),
    });
    await this.deps.store.updateAccount(account.id, {
      usageSubscriptionId: subscription.id,
      usageSubscriptionItemId: subscription.itemId,
    });
    account.usageSubscriptionId = subscription.id;
    account.usageSubscriptionItemId = subscription.itemId;
  }

  /** One grant per kind and term end; a repeat with the same terms adds nothing. */
  private async ensureCreditGrant(input: {
    account: ConnectedBillingAccountRecord;
    kind: CreditGrantKind;
    amountUsdCents: number;
    termEndsAt: Date;
  }): Promise<CreditGrantRecord | null> {
    if (input.amountUsdCents <= 0) return null;
    const existing = (
      await this.deps.store.listCreditGrants(input.account.id)
    ).find(
      (grant) =>
        grant.kind === input.kind &&
        grant.termEndsAt.getTime() === input.termEndsAt.getTime(),
    );
    if (existing) return existing;
    return await this.createGrant(input);
  }

  private async createGrant(input: {
    account: ConnectedBillingAccountRecord;
    kind: CreditGrantKind;
    amountUsdCents: number;
    termEndsAt: Date;
  }): Promise<CreditGrantRecord> {
    const expiresAt = daysAfter(input.termEndsAt, CREDIT_GRANT_GRACE_DAYS);
    const created = await this.deps.provider.createCreditGrant({
      customerId: input.account.stripeCustomerId,
      name: `Hosted usage commit (${input.kind})`,
      amountUsdCents: input.amountUsdCents,
      expiresAt,
      metadata: {
        organization_id: input.account.organizationId,
        kind: input.kind,
        term_ends_at: input.termEndsAt.toISOString(),
      },
    });
    const grant: CreditGrantRecord = {
      stripeCreditGrantId: created.id,
      amountUsdCents: input.amountUsdCents,
      kind: input.kind,
      termEndsAt: input.termEndsAt,
      expiresAt,
    };
    await this.deps.store.addCreditGrant(input.account.id, grant);
    return grant;
  }

  /** The seats and the commit for a term, once. */
  private async ensureAnnualInvoice(input: {
    account: ConnectedBillingAccountRecord;
    termStartsAt: Date;
    seats: number;
    seatRateCents: number;
    seatCurrency: ConnectedCurrency;
    commitUsdCents: number;
  }): Promise<void> {
    const invoices = await this.deps.store.listInvoices(input.account.id);
    const already = invoices.some(
      (invoice) =>
        invoice.kind === "annual" &&
        invoice.termStartsAt?.getTime() === input.termStartsAt.getTime(),
    );
    if (already) return;

    const lines: InvoiceLine[] = [
      {
        description: `${input.seats} seats for the term starting ${isoDate(input.termStartsAt)}`,
        amountCents: input.seats * input.seatRateCents,
      },
    ];
    if (input.commitUsdCents > 0) {
      lines.push({
        description: "Prepaid hosted usage commit (USD)",
        amountCents: input.commitUsdCents,
      });
    }
    const invoice = await this.deps.provider.createOneOffInvoice({
      customerId: input.account.stripeCustomerId,
      currency: input.seatCurrency,
      lines,
      bankTransfer: bankTransferOf(input.account),
      metadata: {
        organization_id: input.account.organizationId,
        kind: "annual",
        term_starts_at: input.termStartsAt.toISOString(),
      },
    });
    await this.deps.store.addInvoice(input.account.id, {
      stripeInvoiceId: invoice.id,
      kind: "annual",
      currency: input.seatCurrency,
      amountCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
      status: invoice.status,
      paidOutOfBandAt: null,
      termStartsAt: input.termStartsAt,
    });
  }
}

function bankTransferOf(
  account: ConnectedBillingAccountRecord,
): BankTransfer | null {
  if (!account.bankTransferType) return null;
  return {
    type: account.bankTransferType,
    ...(account.bankTransferCountry
      ? { country: account.bankTransferCountry }
      : {}),
  };
}

function daysAfter(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
