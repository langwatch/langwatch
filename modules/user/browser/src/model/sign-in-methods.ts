/**
 * How a linked sign-in method is named and classified — the Auth0 strategy
 * encoding is a convention nothing enforces, and reading it wrong is how a
 * Google account starts calling itself "Email/Password" in the UI.
 */

/** Title-cases a provider id that has no friendlier name. */
function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Under Auth0 the real provider is the first segment of the account id:
 * `google-oauth2|1234` is Google via the Auth0 tenant, `auth0|1234` is
 * Auth0's own database — both arrive as `provider: "auth0"`.
 */
const AUTH0_STRATEGY_NAMES: Readonly<Record<string, string>> = {
  auth0: "Email/Password",
  "google-oauth2": "Google",
  windowslive: "Microsoft",
  github: "GitHub",
};

export function providerDisplayName(provider: string, providerAccountId: string): string {
  if (provider !== "auth0") return titleCase(provider);
  const [strategy] = providerAccountId.split("|");
  // An account id with no strategy in it names nothing, and the platform
  // version title-cased it into an EMPTY STRING — a row in a list of sign-in
  // methods with no label at all. "Unknown" is the honest fallback and the one
  // the platform code plainly meant, since it already passed "unknown" as the
  // default and then never reached it (an empty string is not nullish).
  return AUTH0_STRATEGY_NAMES[strategy ?? ""] ?? titleCase(strategy || "unknown");
}

/**
 * Whether this account is the one a password belongs to — only a credential
 * account has one. Offering "Change Password" on a Google account sends the
 * reader to a dialog that can only fail; withholding it on credential leaves them stuck.
 */
export function isCredentialAccount(account: {
  provider: string;
  providerAccountId: string;
}): boolean {
  if (account.provider === "credential") return true;
  if (account.provider !== "auth0") return false;
  const [strategy] = account.providerAccountId.split("|");
  return strategy === "auth0";
}

/**
 * Which password offer the account's Security page makes, or none (ADR-027).
 * Wherever the deployment issues its own a password is offered, even behind an
 * enterprise provider; under Auth0 only an account with a database identity has one.
 */
export function passwordOfferFor({
  authProvider,
  emailPasswordEnabled,
  holdsCredentialAccount,
  hasPasswordAnswer,
}: {
  authProvider: string | undefined;
  emailPasswordEnabled: boolean;
  holdsCredentialAccount: boolean;
  hasPasswordAnswer: boolean | undefined;
}): { held: boolean } | null {
  // Assumed held until the answer arrives: flickering "Set a password" at
  // somebody who has one reads as their password having been lost.
  if (authProvider === "email" || emailPasswordEnabled) return { held: hasPasswordAnswer ?? true };
  if (authProvider === "auth0" && holdsCredentialAccount) return { held: true };

  return null;
}

/**
 * Whether a password can be changed at all on this deployment. Email and
 * Auth0 modes keep the credential reachable; every other mode (OIDC, an
 * enterprise connection) holds it elsewhere — offering to change it would lie.
 */
export function canChangePassword(authProvider: string | undefined): boolean {
  return authProvider === "email" || authProvider === "auth0";
}

/**
 * Whether a linked method may be removed — never the last one, and never
 * any of them on an organization pinned to a single sign-on provider. The
 * server refuses under a serializable transaction; this says so before the click.
 */
export function isRemovableMethod({
  linkedCount,
  hasSsoProvider,
}: {
  linkedCount: number;
  hasSsoProvider: boolean;
}): boolean {
  return !hasSsoProvider && linkedCount > 1;
}

/**
 * Whether a passkey lives on a portable key (usb, nfc, ble)
 * rather than a synced device authenticator.
 */
export function isSecurityKey(passkey: { transports?: string | null }): boolean {
  const transports = passkey.transports ?? "";
  return ["usb", "nfc", "ble"].some((transport) => transports.includes(transport));
}

/**
 * What to call a passkey in a list of them. One from sign-up is labelled
 * with its address; one from settings carries whatever the browser chose,
 * often nothing. "Passkey" is the honest fallback — why renaming exists.
 */
export function passkeyLabel(passkey: { name?: string | null }): string {
  return passkey.name?.trim() || "Passkey";
}
