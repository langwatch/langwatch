// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The stored side of invoice billing for a connected self-hosted customer
 * (ADR-156 section 7): the account, the invoices raised against it, and what
 * each mid-term seat change owed.
 */

import type {
  ConnectedCurrency,
  BankTransferType,
  CreditGrantKind,
  InvoiceKind,
  SeatChangeState,
} from "@langwatch/enterprise-billing-contract";
import type { Instant } from "@langwatch/time";

/**
 * A renewal whose credit waits for the last usage invoice of the old term to
 * be finalized. Stored as ISO strings, which is how the JSON column carries it.
 */
export type PendingRenewal = {
  commitUsdCents: number;
  termStartsAt: string;
  termEndsAt: string;
  /** The old term's end: the usage invoice covering it must close first. */
  awaitingInvoicePeriodEnd: string;
};

export type ConnectedBillingAccountRecord = {
  id: string;
  organizationId: string;
  stripeCustomerId: string;
  usageSubscriptionId: string | null;
  usageSubscriptionItemId: string | null;
  termStartsAt: Instant;
  termEndsAt: Instant;
  commitUsdCents: number;
  seatCurrency: ConnectedCurrency;
  seatRateCents: number;
  seats: number;
  bankTransferType: BankTransferType | null;
  bankTransferCountry: string | null;
  billingEmail: string;
  pendingRenewal: PendingRenewal | null;
};

export type ConnectedInvoiceRecord = {
  stripeInvoiceId: string;
  kind: InvoiceKind;
  currency: ConnectedCurrency;
  amountCents: number;
  /** The provider's own status: draft, open, paid, void or uncollectible. */
  status: string;
  paidOutOfBandAt: Instant | null;
  termStartsAt: Instant | null;
};

/** One prepaid credit at the payment provider, as stored on this side. */
export type ConnectedCreditGrantRecord = {
  stripeCreditGrantId: string;
  amountUsdCents: number;
  kind: CreditGrantKind;
  /** The term the credit was granted for. */
  termEndsAt: Instant;
  /** When the provider lets it lapse: the grace after the term, never the term's end. */
  expiresAt: Instant;
};

/** What one seat change owes, as stored. */
export type ConnectedSeatChangeRecord = {
  /** The reissued `IssuedLicense` row the new seat count is signed into. */
  licenseRowId: string;
  accountId: string;
  changedAt: Instant;
  addedSeats: number;
  unitAmountCents: number;
  amountCents: number;
  currency: ConnectedCurrency;
  state: SeatChangeState;
  stripeInvoiceId: string | null;
};

export abstract class ConnectedBillingRepository {
  abstract findAccount(organizationId: string): Promise<ConnectedBillingAccountRecord | null>;
  abstract findAccountById(accountId: string): Promise<ConnectedBillingAccountRecord | null>;
  /** The account billed through this payment-provider customer, if any. */
  abstract findAccountByCustomer(
    stripeCustomerId: string,
  ): Promise<ConnectedBillingAccountRecord | null>;
  abstract createAccount(
    account: Omit<ConnectedBillingAccountRecord, "id">,
  ): Promise<ConnectedBillingAccountRecord>;
  /**
   * Writes the fields named and answers the row as it now stands. A key left
   * out is left alone, which is what lets one half-finished onboarding step
   * store its id without touching the rest.
   */
  abstract updateAccount(
    accountId: string,
    patch: Partial<Omit<ConnectedBillingAccountRecord, "id" | "organizationId">>,
  ): Promise<ConnectedBillingAccountRecord>;
  abstract findCreditGrants(accountId: string): Promise<ConnectedCreditGrantRecord[]>;
  /** The provider minted the id, so the same grant arriving twice writes one row. */
  abstract addCreditGrant(accountId: string, grant: ConnectedCreditGrantRecord): Promise<void>;
  abstract findInvoices(accountId: string): Promise<ConnectedInvoiceRecord[]>;
  abstract findInvoice(
    stripeInvoiceId: string,
  ): Promise<(ConnectedInvoiceRecord & { accountId: string }) | null>;
  abstract updateInvoice(
    stripeInvoiceId: string,
    patch: Partial<Pick<ConnectedInvoiceRecord, "status" | "paidOutOfBandAt">>,
  ): Promise<void>;
  abstract findSeatChange(licenseRowId: string): Promise<ConnectedSeatChangeRecord | null>;
  /** Writes the decision for one change, replacing an earlier state of it. */
  abstract recordSeatChange(record: ConnectedSeatChangeRecord): Promise<void>;
  /** Every change whose invoice was intended and never confirmed. */
  abstract findPendingSeatChanges(): Promise<ConnectedSeatChangeRecord[]>;
  /** Every seat change invoiced against this account, newest first. */
  abstract findSeatChangesForAccount(accountId: string): Promise<ConnectedSeatChangeRecord[]>;
  abstract addInvoice(accountId: string, invoice: ConnectedInvoiceRecord): Promise<void>;
  /** The accounts of these organizations; one without an account is left out. */
  abstract findAccountsForOrganizations(
    organizationIds: readonly string[],
  ): Promise<ConnectedBillingAccountRecord[]>;
  /** Whether the statement for the month starting at `month` went out. */
  abstract hasSentStatement(input: { accountId: string; month: Instant }): Promise<boolean>;
  /** Settles the month; a second record of the same month changes nothing. */
  abstract recordStatementSent(input: {
    accountId: string;
    month: Instant;
    sentAt: Instant;
  }): Promise<void>;
}
