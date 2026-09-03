/**
 * How a linked sign-in method is named and classified.
 *
 * Pure, because it is the part of the section that is worth stating: the Auth0
 * strategy encoding is a convention nothing enforces, and reading it wrong is
 * how a Google account starts calling itself "Email/Password" — which is the
 * one label that decides whether a Change Password control is offered.
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
 * Under Auth0 the real provider is the first segment of the account id.
 *
 * `google-oauth2|1234` is a Google sign-in that arrived through the Auth0
 * tenant; `auth0|1234` is Auth0's own username-password database. Both come
 * back with `provider: "auth0"`, so the account id is the only thing that tells
 * them apart.
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
 * Whether this account is the one a password belongs to.
 *
 * Only a credential account has a password to change. Getting this wrong in
 * either direction is a real defect: offering "Change Password" on a Google
 * account sends the reader to a dialog whose submit can only fail, and
 * withholding it from a credential account leaves them no way to change theirs.
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
 * Whether a password can be changed at all on this deployment.
 *
 * Email mode keeps the credential in this database; Auth0 mode keeps it in the
 * Auth0 tenant and the product still drives the change through it. Every other
 * mode — an OIDC provider, an enterprise connection — holds the credential
 * somewhere the product cannot reach, and offering to change it would be a lie.
 */
export function canChangePassword(authProvider: string | undefined): boolean {
  return authProvider === "email" || authProvider === "auth0";
}

/**
 * Whether a linked method may be removed.
 *
 * Never the last one, and never any of them on an organization pinned to a
 * single sign-on provider: the server refuses the last account under a
 * serializable transaction, and this is the affordance saying so before the
 * click rather than after it.
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
 * Whether a passkey lives on a key somebody carries rather than on a device
 * they own.
 *
 * Read off TRANSPORTS rather than `deviceType`, which is the tempting field and
 * the wrong one: `deviceType` says whether the credential syncs, and a platform
 * authenticator that does not sync is still on the person's laptop, not on a
 * key in their pocket. `usb`, `nfc` and `ble` are how a roaming authenticator
 * is reached, and nothing else is reached that way.
 *
 * It stays a heuristic — transports are a hint the authenticator supplies — so
 * it decides only which HEADING a card sits under, never anything that would
 * matter if it were wrong.
 */
export function isSecurityKey(passkey: { transports?: string | null }): boolean {
  const transports = passkey.transports ?? "";
  return ["usb", "nfc", "ble"].some((transport) => transports.includes(transport));
}

/**
 * What to call a passkey in a list of them.
 *
 * One registered from the sign-up screen is labelled with the address it was
 * created for; one added from settings carries whatever the browser chose,
 * which is often nothing. "Passkey" is the honest fallback — better than an id,
 * and it is exactly why renaming exists.
 */
export function passkeyLabel(passkey: { name?: string | null }): string {
  return passkey.name?.trim() || "Passkey";
}
