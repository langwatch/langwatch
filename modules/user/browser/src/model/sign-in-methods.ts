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

/**
 * What a federated identifier is called on the profile. A provider id is the
 * operator's word (`oidc`, `azure-ad`); known consumer identities keep their
 * own name and everything else reads as single sign-on.
 */
const FEDERATED_LABELS: Readonly<Record<string, string>> = {
  google: "Google",
  github: "GitHub",
  gitlab: "GitLab",
  "azure-ad": "Microsoft",
  microsoft: "Microsoft",
  okta: "Okta",
  cognito: "Amazon Cognito",
  onelogin: "OneLogin",
  "auth0-google": "Google",
  "auth0-github": "GitHub",
  "auth0-microsoft": "Microsoft",
};

export function federatedMethodLabel(provider: string): string {
  return FEDERATED_LABELS[provider] ?? "Single sign-on";
}

/** One line of the profile's sign-in methods summary. */
export type SignInMethodRow = {
  key: string;
  label: string;
  detail: string;
  chip: { label: string; tone: "neutral" | "warning" } | null;
  testId: string;
};

type SummaryIdentifier = {
  identifierId: string;
  provider: string;
  value: string | null;
  isPrimary: boolean;
  confirmed: boolean;
};

/** An auth0 account counts as the method behind it (`github|123` is GitHub), as on main. */
export function linkedAccountMethodId({
  provider,
  providerAccountId,
}: {
  provider: string;
  providerAccountId: string;
}): string {
  if (provider !== "auth0") return provider;
  // ponytail: main also maps strategy names to native ids (google-oauth2 is google);
  // port that map if a strategy name differs from its method id.
  return providerAccountId.split("|")[0] || provider;
}

/**
 * The lines this account earns, addresses first. The identifier projection is
 * the richer answer but is empty for an account that never attached one, so the
 * account's own address stands in and "None yet" means none anywhere.
 */
export function signInMethodRows({
  identifiers,
  accountAddress,
  passkeyDetail,
  hasPassword,
}: {
  identifiers: readonly SummaryIdentifier[];
  accountAddress: { email: string | null; confirmed: boolean } | null;
  passkeyDetail: string;
  hasPassword: boolean;
}): SignInMethodRow[] {
  const addresses = identifiers.filter((row) => row.provider === "email" && row.value !== null);
  const federated = identifiers.filter(
    (row) => !["email", "credential", "passkey"].includes(row.provider),
  );
  const primary = addresses.find((row) => row.isPrimary) ?? addresses[0];
  const shown = shownAddress({ primary, accountAddress });

  return [
    {
      key: "email",
      label: "Email address",
      detail: shown?.value ?? "None yet",
      chip: addressChip({ count: addresses.length, shown }),
      testId: "method-row-email",
    },
    ...federated.map((row) => ({
      key: row.identifierId,
      label: federatedMethodLabel(row.provider),
      detail: row.value ?? "Not recorded",
      chip: null,
      testId: "method-row-federated",
    })),
    {
      key: "passkeys",
      label: "Passkeys",
      detail: passkeyDetail,
      chip: null,
      testId: "method-row-passkeys",
    },
    {
      key: "password",
      label: "Password",
      detail: hasPassword ? "Set" : "Not set",
      chip: null,
      testId: "method-row-password",
    },
  ];
}

function shownAddress({
  primary,
  accountAddress,
}: {
  primary: SummaryIdentifier | undefined;
  accountAddress: { email: string | null; confirmed: boolean } | null;
}): { value: string | null; confirmed: boolean } | null {
  if (primary) return { value: primary.value, confirmed: primary.confirmed };
  if (accountAddress?.email)
    return { value: accountAddress.email, confirmed: accountAddress.confirmed };
  return null;
}

function addressChip({
  count,
  shown,
}: {
  count: number;
  shown: { confirmed: boolean } | null;
}): SignInMethodRow["chip"] {
  if (count > 1) return { label: `${count} addresses`, tone: "neutral" };
  if (shown && !shown.confirmed) return { label: "Not confirmed yet", tone: "warning" };
  return null;
}

/**
 * The providers still offered for linking: what the sign-in rail offers, less
 * any already connected. A credential account is not a provider, so it never
 * hides one. An organization pinned to single sign-on can link nothing.
 */
export function connectableProviders({
  offered,
  linked,
  hasSsoProvider,
}: {
  offered: readonly string[];
  linked: readonly { provider: string; providerAccountId: string }[];
  hasSsoProvider: boolean;
}): string[] {
  if (hasSsoProvider) return [];
  const held = new Set(
    linked.filter((account) => !isCredentialAccount(account)).map(linkedAccountMethodId),
  );
  return Array.from(new Set(offered)).filter((id) => !held.has(id));
}

/** The button's noun: a provider's own name, else "single sign-on" in running text. */
export function connectLabel(provider: string): string {
  const label = federatedMethodLabel(provider);
  return label === "Single sign-on" ? "single sign-on" : label;
}
