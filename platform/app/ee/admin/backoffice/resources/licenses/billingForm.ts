import type { RouterOutputs } from "~/utils/api";
import { centsToDollars, dollarsToCents } from "./terms";
import type { License } from "./types";

export type BillingOverview = RouterOutputs["connectedBilling"]["get"];

export type BankTransferChoice = "" | "us_bank_transfer" | "eu_bank_transfer";

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

const isoDay = (date: Date | null | undefined): string =>
  date ? date.toISOString().slice(0, 10) : "";

/**
 * The form an operator starts from: what the account already says, falling
 * back to the license, whose terms are where the commit was agreed.
 */
export function billingFormFrom({
  account,
  license,
}: {
  account: BillingOverview["account"] | null;
  license: License;
}): BillingForm {
  return {
    billingEmail: account?.billingEmail ?? license.email,
    termStartsAt: isoDay(account?.termStartsAt ?? license.issuedAt),
    termEndsAt: isoDay(account?.termEndsAt ?? license.expiresAt),
    seats: String(account?.seats ?? license.maxMembers),
    seatRate: centsToDollars(account?.seatRateCents ?? license.seatRateCents),
    seatCurrency: account?.seatCurrency ?? license.seatCurrency ?? "USD",
    commit: centsToDollars(account?.commitUsdCents ?? license.commitUsdCents),
    bankTransferType: (account?.bankTransferType ?? "") as BankTransferChoice,
    bankTransferCountry: account?.bankTransferCountry ?? "",
  };
}

/** The dates and amounts both onboarding and renewal send. */
export function contractPayload(form: BillingForm) {
  return {
    termStartsAt: new Date(`${form.termStartsAt}T00:00:00.000Z`),
    termEndsAt: new Date(`${form.termEndsAt}T00:00:00.000Z`),
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
  license: License;
}) {
  return {
    organizationId: license.organizationId ?? "",
    organizationName: license.organizationName,
    billingEmail: form.billingEmail,
    bankTransfer: form.bankTransferType
      ? {
          type: form.bankTransferType,
          ...(form.bankTransferCountry
            ? { country: form.bankTransferCountry.toUpperCase() }
            : {}),
        }
      : null,
    ...contractPayload(form),
  };
}
