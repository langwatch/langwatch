/**
 * Whether an address's domain belongs to a disposable (throwaway) email service.
 * List: `disposable-email-domains.generated.json`, read at the commit `.source.json` names.
 * Spec: specs/auth/sign-up-disposable-email.feature
 */
import type { SignUpDisposableEmails } from "@langwatch/organization-contract";

import DISPOSABLE_EMAIL_DOMAINS from "./disposable-email-domains.generated.json" with { type: "json" };

const DISPOSABLE_EMAIL_DOMAIN_SET: ReadonlySet<string> = new Set(DISPOSABLE_EMAIL_DOMAINS);

/** True when the domain, or any parent of it, is listed; case and a trailing dot are ignored. */
export function isDisposableEmailDomain({ domain }: { domain: string }): boolean {
  const labels = domain.trim().toLowerCase().replace(/\.$/, "").split(".");
  // Stops before the last label: a bare suffix such as `com` is never a listed domain.
  for (let start = 0; start < labels.length - 1; start++) {
    const candidate = labels.slice(start).join(".");
    if (DISPOSABLE_EMAIL_DOMAIN_SET.has(candidate)) return true;
  }
  return false;
}

/** `SIGN_UP_DISPOSABLE_EMAILS` when set; unset, the cloud refuses and a self-hosted one allows. */
export function refusesDisposableEmails({
  setting,
  isSaas,
}: {
  setting: SignUpDisposableEmails | undefined;
  isSaas: boolean;
}): boolean {
  return setting === undefined ? isSaas : setting === "refuse";
}
