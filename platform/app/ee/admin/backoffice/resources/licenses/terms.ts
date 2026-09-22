import { type License, SERVICES, type Service } from "./types";

export const dollarsToCents = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

export const centsToDollars = (cents: number | null | undefined): string =>
  cents == null ? "" : (cents / 100).toFixed(2);

export interface TermsForm {
  services: Service[];
  seatRate: string;
  seatCurrency: "USD" | "EUR";
  commit: string;
  overageEnabled: boolean;
  overageMax: string;
}

export function termsFormFrom(license: License | null | undefined): TermsForm {
  return {
    services: (license?.services ?? []).filter((service): service is Service =>
      (SERVICES as readonly string[]).includes(service),
    ),
    seatRate: centsToDollars(license?.seatRateCents),
    seatCurrency: license?.seatCurrency ?? "USD",
    commit: centsToDollars(license?.commitUsdCents ?? 0),
    overageEnabled: license?.overageEnabled ?? false,
    overageMax: centsToDollars(license?.overageMaxUsdCents),
  };
}

/** The share of the commit the overage maximum is prefilled with when overage is switched on. */
const SUGGESTED_OVERAGE_SHARE = 0.25;

/**
 * What the overage maximum reads when an operator switches overage on with
 * the field empty: a quarter of the commit, as a suggestion they can edit.
 * There is no default maximum on the registry; only the license carries one.
 */
export function suggestedOverageMax(commit: string): string {
  const cents = dollarsToCents(commit);
  if (cents === null || cents <= 0) return "";
  return centsToDollars(Math.round(cents * SUGGESTED_OVERAGE_SHARE));
}

/** The form after the overage switch moved, with the maximum prefilled once. */
export function withOverageEnabled(
  form: TermsForm,
  overageEnabled: boolean,
): TermsForm {
  const overageMax =
    overageEnabled && form.overageMax.trim() === ""
      ? suggestedOverageMax(form.commit)
      : form.overageMax;
  return { ...form, overageEnabled, overageMax };
}

export function termsPayload(form: TermsForm) {
  return {
    services: form.services,
    seatRateCents: dollarsToCents(form.seatRate),
    seatCurrency: form.seatRate.trim() === "" ? null : form.seatCurrency,
    commitUsdCents: dollarsToCents(form.commit) ?? 0,
    overageEnabled: form.overageEnabled,
    overageMaxUsdCents: form.overageEnabled
      ? dollarsToCents(form.overageMax)
      : null,
  };
}
