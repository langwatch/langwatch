/** A registry row as the Backoffice reads it (ADR-156). Declared here, not
 * derived from `RouterOutputs`: model stays pure and behavior depends on it,
 * never the reverse. */
export interface License {
  id: string;
  licenseId: string;
  organizationId: string | null;
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite: number;
  issuedAt: string;
  expiresAt: string;
  source: string;
  revokedAt: string | null;
  revokedReason: string | null;
  replacesId: string | null;
  services: string[];
  seatRateCents: number | null;
  seatCurrency: "USD" | "EUR" | null;
  commitUsdCents: number;
  overageEnabled: boolean;
  overageMaxUsdCents: number | null;
  instanceId: string | null;
  instanceBoundAt: string | null;
  lastSyncAt: string | null;
  lastSyncVersion: string | null;
  reportedMembers: number | null;
  reportedMembersLite: number | null;
  status: "active" | "revoked" | "superseded" | "expired";
  hasPendingDelivery: boolean;
}

/** The hosted services an operator can put on a license (ADR-156); kept a
 * plain array here since a core browser package names no enterprise one. */
export const SERVICES = ["instant_evals", "managed_models"] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service, string> = {
  instant_evals: "Instant evals",
  managed_models: "Managed models",
};

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

export function suggestedOverageMax(commit: string): string {
  const cents = dollarsToCents(commit);
  if (cents === null || cents <= 0) return "";
  return centsToDollars(Math.round(cents * SUGGESTED_OVERAGE_SHARE));
}

/** The form after the overage switch moved, with the maximum prefilled once. */
export function withOverageEnabled(form: TermsForm, overageEnabled: boolean): TermsForm {
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
    overageMaxUsdCents: form.overageEnabled ? dollarsToCents(form.overageMax) : null,
  };
}
