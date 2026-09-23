// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Invoice billing for a connected self-hosted customer (ADR-156 section 7),
 * as everything outside the billing process reads it.
 */

import type { Instant } from "@langwatch/time";

/** Hosted usage is USD only; a seat contract may be written in either. */
export type ConnectedCurrency = "USD" | "EUR";

export type BankTransferType = "us_bank_transfer" | "eu_bank_transfer";

/** How a customer pays into a virtual bank account at the payment provider. */
export interface BankTransfer {
  type: BankTransferType;
  /** Two-letter country, required for an EU transfer. */
  country?: string;
}

export type InvoiceKind = "annual" | "seat_change" | "usage";

/** How the invoicing of one seat change stands. */
export type SeatChangeState = "intent" | "invoiced" | "nothing_to_invoice";

/**
 * What a mid-term seat change owed. `not_onboarded` is a customer with no
 * billing account: finance invoices those by hand, and the operator is told so
 * rather than left thinking an invoice went out.
 */
export type SeatChangeBillingOutcome = "invoiced" | "nothing_to_invoice" | "not_onboarded";

/**
 * Which contract an organization's hosted usage is invoiced under.
 *
 * `cloud` is a SEAT_EVENT organization with an active growth-seat
 * subscription, invoiced monthly. `connected` is a self-hosted customer with a
 * `ConnectedBillingAccount`: it buys no Cloud plan, so it is not on SEAT_EVENT
 * pricing at all, and its usage rides the quarterly subscription that account
 * names.
 */
export type UsageBillingContract = "cloud" | "connected";

/**
 * Why a credit was granted. Always prepaid, never promotional: `commit` is the
 * term's own credit, `added` a mid-term raise, `renewal` the next term's credit
 * once the old term's last usage invoice has closed.
 */
export type CreditGrantKind = "commit" | "added" | "renewal";

export interface ConnectedOnboardInput {
  organizationId: string;
  organizationName: string;
  billingEmail: string;
  termStartsAt: Instant;
  termEndsAt: Instant;
  seats: number;
  seatRateCents: number;
  seatCurrency: ConnectedCurrency;
  commitUsdCents: number;
  bankTransfer: BankTransfer | null;
  operatorId: string;
}

export interface ConnectedRenewInput {
  organizationId: string;
  termStartsAt: Instant;
  termEndsAt: Instant;
  seats: number;
  seatRateCents: number;
  seatCurrency: ConnectedCurrency;
  commitUsdCents: number;
  operatorId: string;
}

/** Whether the renewal credit was granted, is still waiting, or was never pending. */
export type RenewalCompletion = "completed" | "waiting" | "none";
