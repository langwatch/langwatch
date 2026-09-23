// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Invoice billing for a connected self-hosted customer (ADR-156 section 7).
 *
 * The customer pays by invoice. Hosted usage draws down a prepaid commit at
 * list rates through the payment provider's meter; the commit itself is a paid
 * credit that applies to metered usage only, so a seat invoice can never draw
 * it down. Seats and the commit are lines on a one-off annual invoice in the
 * currency of the seat contract; usage rides one quarterly USD subscription
 * kept across terms.
 *
 * Every step stores the id it created before the next one runs, and every entry
 * point reads those ids first, so a run that failed halfway resumes and a run
 * repeated with the same terms creates nothing twice.
 */

import {
  ConnectedBillingCommitMismatchError,
  ConnectedBillingNotOnboardedError,
  ConnectedBillingUnavailableError,
  type ConnectedCurrency,
  type ConnectedOnboardInput,
  type ConnectedRenewInput,
  type CreditGrantKind,
  type RenewalCompletion,
} from "@langwatch/enterprise-billing-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { ConnectedInvoicingChannel } from "../channels/connected-invoicing.channel.ts";
import type {
  ConnectedBillingAccountRecord,
  ConnectedBillingRepository,
  ConnectedCreditGrantRecord,
} from "../repositories/connected-billing.repository.ts";

/** Days after the term ends in which the last usage invoice can still draw the credit. */
export const CREDIT_GRANT_GRACE_DAYS = 14;

const HOURS_PER_DAY = 24;

/**
 * How the account pays, as the provider wants it stated. No stored type is no
 * transfer, which puts LangWatch's own bank details in the invoice footer.
 */
const bankTransferOf = (account: ConnectedBillingAccountRecord) =>
  account.bankTransferType
    ? {
        type: account.bankTransferType,
        ...(account.bankTransferCountry ? { country: account.bankTransferCountry } : {}),
      }
    : null;

/**
 * The license registry's view of a customer's terms. The commit is agreed on
 * the license, and the cap a customer sees is the organization budget the
 * registry keeps equal to it, so this service asks the registry to move both
 * rather than setting a number of its own.
 */
export interface ConnectedBillingTerms {
  termsOf(organizationId: string): Promise<{ commitUsdCents: number }>;
  raiseCommit(input: {
    organizationId: string;
    byUsdCents: number;
    operatorId: string;
  }): Promise<void>;
  /** Re-derives the organization budget's cap from the license terms. */
  syncBudget(input: { organizationId: string; operatorId: string }): Promise<void>;
  /** Starts a new budget window: spend so far no longer counts. */
  resetBudget(input: { organizationId: string; operatorId: string }): Promise<void>;
}

export class ConnectedBillingService {
  private constructor(
    private readonly repository: ConnectedBillingRepository,
    private readonly invoicing: ConnectedInvoicingChannel,
    private readonly terms: ConnectedBillingTerms,
    private readonly isSaas: boolean,
    private readonly bankDetails: () => string | null,
    private readonly now: () => Instant,
  ) {}

  static create(input: {
    repository: ConnectedBillingRepository;
    invoicing: ConnectedInvoicingChannel;
    terms: ConnectedBillingTerms;
    /** Invoicing a connected customer happens on LangWatch Cloud alone. */
    isSaas: boolean;
    /** Bank details printed on invoices paid outside the provider. */
    bankDetails: () => string | null;
    now?: () => Instant;
  }): ConnectedBillingService {
    return new ConnectedBillingService(
      input.repository,
      input.invoicing,
      input.terms,
      input.isSaas,
      input.bankDetails,
      input.now ?? nowInstant,
    );
  }

  /**
   * Onboards a customer, or completes an onboarding that stopped halfway. Each
   * step is skipped when its id is already stored.
   */
  async onboard(input: ConnectedOnboardInput): Promise<ConnectedBillingAccountRecord> {
    this.refuseOffCloud();
    await this.refuseCommitTheLicenseDoesNotAgree(input.organizationId, input.commitUsdCents);

    const account =
      (await this.repository.findAccount(input.organizationId)) ?? (await this.openAccount(input));
    const withSubscription = await this.ensureUsageSubscription(account);
    await this.ensureCreditGrant({
      account: withSubscription,
      kind: "commit",
      amountUsdCents: input.commitUsdCents,
      termEndsAt: input.termEndsAt,
    });
    await this.ensureAnnualInvoice({ account: withSubscription, ...input });
    await this.terms.syncBudget({
      organizationId: input.organizationId,
      operatorId: input.operatorId,
    });

    return (await this.repository.findAccount(input.organizationId)) ?? withSubscription;
  }

  /** Raises the commit mid-term: a second paid credit, and the budget with it. */
  async addCommit(input: {
    organizationId: string;
    amountUsdCents: number;
    operatorId: string;
  }): Promise<ConnectedCreditGrantRecord> {
    this.refuseOffCloud();
    const account = await this.accountOf(input.organizationId);
    await this.terms.raiseCommit({
      organizationId: input.organizationId,
      byUsdCents: input.amountUsdCents,
      operatorId: input.operatorId,
    });
    const grant = await this.grant({
      account,
      kind: "added",
      amountUsdCents: input.amountUsdCents,
      termEndsAt: account.termEndsAt,
    });
    await this.repository.updateAccount(account.id, {
      commitUsdCents: account.commitUsdCents + input.amountUsdCents,
    });

    return grant;
  }

  /**
   * Renews for a new term. The usage subscription stays. The renewal credit
   * waits until the usage invoice for the old term's last quarter is finalized,
   * or it would absorb that quarter's overage; until then the renewal is
   * pending and `completeRenewalIfDue` finishes it.
   */
  async renew(input: ConnectedRenewInput): Promise<ConnectedBillingAccountRecord> {
    this.refuseOffCloud();
    await this.refuseCommitTheLicenseDoesNotAgree(input.organizationId, input.commitUsdCents);
    const before = await this.accountOf(input.organizationId);

    const account = await this.repository.updateAccount(before.id, {
      termStartsAt: input.termStartsAt,
      termEndsAt: input.termEndsAt,
      seats: input.seats,
      seatRateCents: input.seatRateCents,
      seatCurrency: input.seatCurrency,
      commitUsdCents: input.commitUsdCents,
      pendingRenewal: {
        commitUsdCents: input.commitUsdCents,
        termStartsAt: input.termStartsAt.toString(),
        termEndsAt: input.termEndsAt.toString(),
        awaitingInvoicePeriodEnd: before.termEndsAt.toString(),
      },
    });
    await this.ensureAnnualInvoice({ account, ...input });
    await this.terms.resetBudget({
      organizationId: input.organizationId,
      operatorId: input.operatorId,
    });
    await this.terms.syncBudget({
      organizationId: input.organizationId,
      operatorId: input.operatorId,
    });
    await this.completeRenewalIfDue({ organizationId: input.organizationId });

    return (await this.repository.findAccount(input.organizationId)) ?? account;
  }

  /** The connected account billed through this customer; null for a Cloud customer. */
  async accountFor(stripeCustomerId: string): Promise<{ organizationId: string } | null> {
    const account = await this.repository.findAccountByCustomer(stripeCustomerId);

    return account ? { organizationId: account.organizationId } : null;
  }

  /** Creates the renewal credit once the old term's last usage invoice is finalized. */
  async completeRenewalIfDue(input: { organizationId: string }): Promise<RenewalCompletion> {
    const account = await this.accountOf(input.organizationId);
    const pending = account.pendingRenewal;
    if (!pending) return "none";
    if (!account.usageSubscriptionId) return "waiting";

    const settled = await this.invoicing.hasFinalizedUsageInvoice({
      subscriptionId: account.usageSubscriptionId,
      periodEnd: Temporal.Instant.from(pending.awaitingInvoicePeriodEnd),
    });
    if (!settled) return "waiting";

    await this.ensureCreditGrant({
      account,
      kind: "renewal",
      amountUsdCents: pending.commitUsdCents,
      termEndsAt: Temporal.Instant.from(pending.termEndsAt),
    });
    await this.repository.updateAccount(account.id, { pendingRenewal: null });

    return "completed";
  }

  /** Finance received the money outside the provider. */
  async markPaidOutOfBand(input: { stripeInvoiceId: string }): Promise<void> {
    this.refuseOffCloud();
    await this.invoicing.payOutOfBand(input.stripeInvoiceId);
    const stored = await this.repository.findInvoice(input.stripeInvoiceId);
    if (!stored) return;

    await this.repository.updateInvoice(input.stripeInvoiceId, {
      status: "paid",
      paidOutOfBandAt: this.now(),
    });
  }

  private refuseOffCloud(): void {
    if (!this.isSaas) throw new ConnectedBillingUnavailableError();
  }

  private async accountOf(organizationId: string): Promise<ConnectedBillingAccountRecord> {
    const account = await this.repository.findAccount(organizationId);
    if (!account) throw new ConnectedBillingNotOnboardedError();

    return account;
  }

  /** The commit is agreed on the license; billing follows it, never the other way. */
  private async refuseCommitTheLicenseDoesNotAgree(
    organizationId: string,
    commitUsdCents: number,
  ): Promise<void> {
    const agreed = await this.terms.termsOf(organizationId);
    if (agreed.commitUsdCents === commitUsdCents) return;

    throw new ConnectedBillingCommitMismatchError(agreed.commitUsdCents / 100);
  }

  private async openAccount(input: ConnectedOnboardInput): Promise<ConnectedBillingAccountRecord> {
    const customer = await this.invoicing.createCustomer({
      organizationId: input.organizationId,
      name: input.organizationName,
      email: input.billingEmail,
      bankTransfer: input.bankTransfer,
      invoiceFooter: input.bankTransfer ? null : this.bankDetails(),
    });

    return this.repository.createAccount({
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
  ): Promise<ConnectedBillingAccountRecord> {
    if (account.usageSubscriptionId) return account;

    const subscription = await this.invoicing.createUsageSubscription({
      customerId: account.stripeCustomerId,
      termStartsAt: account.termStartsAt,
      bankTransfer: bankTransferOf(account),
    });

    return this.repository.updateAccount(account.id, {
      usageSubscriptionId: subscription.id,
      usageSubscriptionItemId: subscription.itemId,
    });
  }

  /** One grant per kind and term end; a repeat with the same terms adds nothing. */
  private async ensureCreditGrant(input: {
    account: ConnectedBillingAccountRecord;
    kind: CreditGrantKind;
    amountUsdCents: number;
    termEndsAt: Instant;
  }): Promise<ConnectedCreditGrantRecord | null> {
    if (input.amountUsdCents <= 0) return null;

    const held = await this.repository.findCreditGrants(input.account.id);
    const already = held.find(
      (grant) =>
        grant.kind === input.kind &&
        grant.termEndsAt.epochMilliseconds === input.termEndsAt.epochMilliseconds,
    );

    return already ?? (await this.grant(input));
  }

  private async grant(input: {
    account: ConnectedBillingAccountRecord;
    kind: CreditGrantKind;
    amountUsdCents: number;
    termEndsAt: Instant;
  }): Promise<ConnectedCreditGrantRecord> {
    const expiresAt = input.termEndsAt.add({ hours: CREDIT_GRANT_GRACE_DAYS * HOURS_PER_DAY });
    const created = await this.invoicing.createCreditGrant({
      customerId: input.account.stripeCustomerId,
      name: `Hosted usage commit (${input.kind})`,
      amountUsdCents: input.amountUsdCents,
      expiresAt,
      metadata: {
        organization_id: input.account.organizationId,
        kind: input.kind,
        term_ends_at: input.termEndsAt.toString(),
      },
    });
    const grant: ConnectedCreditGrantRecord = {
      stripeCreditGrantId: created.id,
      amountUsdCents: input.amountUsdCents,
      kind: input.kind,
      termEndsAt: input.termEndsAt,
      expiresAt,
    };
    await this.repository.addCreditGrant(input.account.id, grant);

    return grant;
  }

  /** The seats and the commit for a term, once. */
  private async ensureAnnualInvoice(input: {
    account: ConnectedBillingAccountRecord;
    termStartsAt: Instant;
    seats: number;
    seatRateCents: number;
    seatCurrency: ConnectedCurrency;
    commitUsdCents: number;
  }): Promise<void> {
    const invoices = await this.repository.findInvoices(input.account.id);
    const already = invoices.some(
      (invoice) =>
        invoice.kind === "annual" &&
        invoice.termStartsAt?.epochMilliseconds === input.termStartsAt.epochMilliseconds,
    );
    if (already) return;

    const lines = [
      {
        description: `${input.seats} seats for the term starting ${input.termStartsAt.toString().slice(0, 10)}`,
        amountCents: input.seats * input.seatRateCents,
      },
      ...(input.commitUsdCents > 0
        ? [{ description: "Prepaid hosted usage commit (USD)", amountCents: input.commitUsdCents }]
        : []),
    ];
    const invoice = await this.invoicing.createOneOffInvoice({
      customerId: input.account.stripeCustomerId,
      currency: input.seatCurrency,
      lines,
      bankTransfer: bankTransferOf(input.account),
      metadata: {
        organization_id: input.account.organizationId,
        kind: "annual",
        term_starts_at: input.termStartsAt.toString(),
      },
    });
    await this.repository.addInvoice(input.account.id, {
      stripeInvoiceId: invoice.id,
      kind: "annual",
      currency: input.seatCurrency,
      amountCents: lines.reduce((total, line) => total + line.amountCents, 0),
      status: invoice.status,
      paidOutOfBandAt: null,
      termStartsAt: input.termStartsAt,
    });
  }
}
