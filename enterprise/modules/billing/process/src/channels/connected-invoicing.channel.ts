// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The payment provider behind connected billing (ADR-156 section 7), as the
 * one-off invoices reach it. A channel rather than a repository: nothing here
 * is LangWatch's own state, the provider owns the invoice and answers with the
 * id and status it minted.
 */

import type { BankTransfer, ConnectedCurrency } from "@langwatch/enterprise-billing-contract";
import type { Instant } from "@langwatch/time";

export type ConnectedInvoiceLine = {
  description: string;
  /** The whole line. With a quantity, `unitAmountCents` times `quantity`. */
  amountCents: number;
  /** Set when the customer should read a unit and a count rather than a total. */
  quantity?: number;
  unitAmountCents?: number;
};

export type ProviderInvoice = {
  id: string;
  status: string;
  currency: string;
  amountDueCents: number;
  subscriptionId: string | null;
  /** End of the period the invoice covers, for a subscription invoice. */
  periodEndMs: number | null;
};

export abstract class ConnectedInvoicingChannel {
  /** The customer the invoices are raised against, invoiced and never charged. */
  abstract createCustomer(input: {
    organizationId: string;
    name: string;
    email: string;
    bankTransfer: BankTransfer | null;
    /** LangWatch's own bank details, for a customer that wires to them. */
    invoiceFooter: string | null;
  }): Promise<{ id: string }>;

  /**
   * The one metered subscription hosted usage is reported on. USD only, and
   * kept across terms, so its id is stored the moment it exists.
   */
  abstract createUsageSubscription(input: {
    customerId: string;
    termStartsAt: Instant;
    bankTransfer: BankTransfer | null;
  }): Promise<{ id: string; itemId: string }>;

  /**
   * A paid credit that only metered usage draws down, so a seat invoice can
   * never spend the hosted usage commit.
   */
  abstract createCreditGrant(input: {
    customerId: string;
    name: string;
    amountUsdCents: number;
    expiresAt: Instant;
    metadata: Record<string, string>;
  }): Promise<{ id: string }>;

  /**
   * Raises one invoice, finalized and payable. `metadata` is part of the
   * idempotency key, so the same change invoiced twice reaches the same
   * invoice rather than raising a second one.
   */
  abstract createOneOffInvoice(input: {
    customerId: string;
    currency: ConnectedCurrency;
    lines: ConnectedInvoiceLine[];
    bankTransfer: BankTransfer | null;
    metadata: Record<string, string>;
  }): Promise<ProviderInvoice>;

  /** One invoice as the provider holds it now. Throws when it has none. */
  abstract getInvoice(stripeInvoiceId: string): Promise<ProviderInvoice>;

  /** Whether a finalized usage invoice covers the period ending at `periodEnd`. */
  abstract hasFinalizedUsageInvoice(input: {
    subscriptionId: string;
    periodEnd: Instant;
  }): Promise<boolean>;

  /** Finance received the money outside the provider. */
  abstract payOutOfBand(stripeInvoiceId: string): Promise<void>;
}
