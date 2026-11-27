// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { LicenseBillingSectionProps } from "@langwatch/enterprise-billing-client";
/**
 * The contract an operator onboards or renews a connected customer on
 * (ADR-156 section 7), starting from what the account already says and
 * falling back to the license, whose terms are where the commit was agreed.
 */
import type {
  ConnectedBillingAccountView,
  ConnectedOnboardRequest,
  ConnectedRenewRequest,
} from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";

const CENTS = 100;

export type BankTransferChoice = "" | "us_bank_transfer" | "eu_bank_transfer";

/** The license terms the billing section starts from, as the license drawer holds them. */

export interface BillingForm {
  billingEmail: string;
  termStartsAt: string;
  termEndsAt: string;
  seats: string;
  seatRate: string;
  seatCurrency: "USD" | "EUR";
  commit: string;
  bankTransferType: BankTransferChoice;
  bankTransferCountry: string;
}

export const dollarsToCents = (value: string): number | undefined => {
  if (value.trim() === "") return void 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * CENTS) : void 0;
};

export const centsToDollars = (cents: number | null | undefined): string =>
  cents == null ? "" : (cents / CENTS).toFixed(2);

/** An amount the way finance reads it: two decimals, then the currency. */
export const money = (cents: number, currency: string): string =>
  `${(cents / CENTS).toFixed(2)} ${currency}`;

const isoDay = (iso: string): string => iso.slice(0, 10);

export function billingFormFrom({
  account,
  license,
}: {
  account: ConnectedBillingAccountView | null;
  license: LicenseBillingSectionProps;
}): BillingForm {
  return {
    billingEmail: account?.billingEmail ?? license.email,
    termStartsAt: isoDay(account?.termStartsAt ?? license.issuedAt),
    termEndsAt: isoDay(account?.termEndsAt ?? license.expiresAt),
    seats: String(account?.seats ?? license.maxMembers),
    seatRate: centsToDollars(account?.seatRateCents ?? license.seatRateCents),
    seatCurrency: account?.seatCurrency ?? license.seatCurrency ?? "USD",
    commit: centsToDollars(account?.commitUsdCents ?? license.commitUsdCents),
    bankTransferType: account?.bankTransferType ?? "",
    bankTransferCountry: account?.bankTransferCountry ?? "",
  };
}

/** The dates and amounts both onboarding and renewal send. */
export function contractPayload({
  form,
  organizationId,
}: {
  form: BillingForm;
  organizationId: string;
}): ConnectedRenewRequest {
  return {
    organizationId,
    termStartsAt: `${form.termStartsAt}T00:00:00.000Z`,
    termEndsAt: `${form.termEndsAt}T00:00:00.000Z`,
    seats: Number(form.seats),
    seatRateCents: dollarsToCents(form.seatRate) ?? 0,
    seatCurrency: form.seatCurrency,
    commitUsdCents: dollarsToCents(form.commit) ?? 0,
  };
}

export function onboardPayload({
  form,
  license,
}: {
  form: BillingForm;
  license: LicenseBillingSectionProps;
}): ConnectedOnboardRequest {
  const bankTransfer =
    form.bankTransferType === ""
      ? null
      : {
          type: form.bankTransferType,
          ...(form.bankTransferCountry ? { country: form.bankTransferCountry.toUpperCase() } : {}),
        };
  return {
    ...contractPayload({ form, organizationId: license.organizationId }),
    organizationName: license.organizationName,
    billingEmail: form.billingEmail,
    bankTransfer,
  };
}

const addYear = (day: string): string => Temporal.PlainDate.from(day).add({ years: 1 }).toString();

/**
 * The paid term a form starts on. A trial's starts when the trial ends (or
 * today, once it has ended); a renewal's starts when the current term ends.
 * Either runs one year. Billing that stopped part way finishes its own term.
 */
export function nextPaidTerm({
  account,
  license,
  today,
  finished = true,
}: {
  account: ConnectedBillingAccountView | null;
  license: LicenseBillingSectionProps;
  today: string;
  finished?: boolean;
}): { termStartsAt: string; termEndsAt: string } {
  if (account && !finished) {
    return { termStartsAt: isoDay(account.termStartsAt), termEndsAt: isoDay(account.termEndsAt) };
  }
  const from = isoDay(account?.termEndsAt ?? license.expiresAt);
  const termStartsAt = from < today ? today : from;
  return { termStartsAt, termEndsAt: addYear(termStartsAt) };
}

/** Whether a paid term ends on another day than the license, so the license is signed again first. */
export function needsLicenseSigned({
  form,
  license,
}: {
  form: BillingForm;
  license: LicenseBillingSectionProps;
}): boolean {
  return form.termEndsAt !== isoDay(license.expiresAt);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Why a paid term cannot be submitted yet: a day left empty, or an end that is not after the start. */
export function paidTermProblem(form: BillingForm): string | undefined {
  if (!ISO_DAY.test(form.termStartsAt) || !ISO_DAY.test(form.termEndsAt)) {
    return "Enter the day the paid term starts and the day it ends.";
  }
  if (form.termEndsAt <= form.termStartsAt) return "The paid term must end after it starts.";
  return undefined;
}

/** The instant the license is signed to for a paid term: midday, so every time zone reads the day. */
export const termEndInstant = (form: BillingForm): string => `${form.termEndsAt}T12:00:00.000Z`;

/** The annual invoice line by line: seats at the rate, then the prepaid commit. */
export function annualInvoiceText(form: BillingForm): string {
  const seatRate = dollarsToCents(form.seatRate) ?? 0;
  const commit = dollarsToCents(form.commit) ?? 0;
  const seats = Number(form.seats);
  const lines = `${seats} seats × ${money(seatRate, form.seatCurrency)} + ${money(commit, "USD")} commit`;
  if (form.seatCurrency !== "USD") return lines;
  return `${lines} = ${money(seats * seatRate + commit, "USD")}`;
}
