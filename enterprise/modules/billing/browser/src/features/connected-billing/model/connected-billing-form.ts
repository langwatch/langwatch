// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { UiLicenseBillingSectionProps } from "@langwatch/browser-host/declarations";
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
  license: UiLicenseBillingSectionProps;
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
  license: UiLicenseBillingSectionProps;
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
