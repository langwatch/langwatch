import { issuerForProviderId } from "./better-auth-account-queries.rules.ts";

/**
 * The key a pre-3.17 Azure AD account moves to on its first sign-in after the upgrade.
 * Rationale and the replay-parity exemption: specs/auth/azure-ad-account-upgrade.feature.
 */
export const MICROSOFT_PROVIDER_ID = "microsoft";

/** The synthetic issuer the `account_issuer` migration gave pre-3.17 Microsoft rows. */
export const LEGACY_MICROSOFT_ISSUER = issuerForProviderId(MICROSOFT_PROVIDER_ID);

/** From the token's `sub` (how the row was stored) to its `iss` and `oid` (how 1.7 looks it up). */
export type MicrosoftAccountKeyMove =
  | { kind: "none" }
  | { kind: "move"; legacySubject: string; issuer: string; accountId: string };

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** The move one Microsoft id token asks for; none when it cannot name both keys, or they match. */
export function readMicrosoftAccountKeyMove(
  profile: Readonly<Record<string, unknown>>,
): MicrosoftAccountKeyMove {
  const { sub, oid, iss } = profile;
  const claimsPresent = nonEmpty(sub) && nonEmpty(oid) && nonEmpty(iss);
  if (!claimsPresent) return { kind: "none" };
  if (!iss.startsWith("https://") || sub === oid) return { kind: "none" };
  return { kind: "move", legacySubject: sub, issuer: iss, accountId: oid };
}
