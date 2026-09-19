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
  seatOverageAllowance: string;
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
    seatOverageAllowance: license?.seatOverageAllowance?.toString() ?? "",
    seatRate: centsToDollars(license?.seatRateCents),
    seatCurrency: license?.seatCurrency ?? "USD",
    commit: centsToDollars(license?.commitUsdCents ?? 0),
    overageEnabled: license?.overageEnabled ?? false,
    overageMax: centsToDollars(license?.overageMaxUsdCents),
  };
}

export function termsPayload(form: TermsForm) {
  return {
    services: form.services,
    seatOverageAllowance:
      form.seatOverageAllowance.trim() === ""
        ? null
        : Number(form.seatOverageAllowance),
    seatRateCents: dollarsToCents(form.seatRate),
    seatCurrency: form.seatRate.trim() === "" ? null : form.seatCurrency,
    commitUsdCents: dollarsToCents(form.commit) ?? 0,
    overageEnabled: form.overageEnabled,
    overageMaxUsdCents: form.overageEnabled
      ? dollarsToCents(form.overageMax)
      : null,
  };
}
