/** One better-auth `Account` row, of the parts these screens read. */
export interface LinkedAccount {
  id: string;
  provider: string;
  providerAccountId: string;
}

/**
 * The identity an Auth0 subject actually belongs to.
 *
 * An Auth0 deployment holds every identity under the one `auth0` provider and
 * names the real one in the subject — `google-oauth2|…`, `windowslive|…` — so
 * a row would otherwise read "Auth0" to somebody who has only ever clicked a
 * Google button.
 */
const AUTH0_STRATEGY_METHODS: Record<string, string> = {
  "google-oauth2": "google",
  windowslive: "microsoft",
  github: "github",
};

/**
 * Which sign-in method a linked account IS.
 *
 * A method id rather than a name, so the row's mark and the row's words come
 * from the same two places the auth screens' own buttons take them from — a
 * second table of provider names is a second thing to keep in step.
 */
export function linkedAccountMethodId({
  provider,
  providerAccountId,
}: {
  provider: string;
  providerAccountId: string;
}): string {
  if (provider !== "auth0") return provider;

  const [strategy] = providerAccountId.split("|");
  return AUTH0_STRATEGY_METHODS[strategy ?? ""] ?? strategy ?? provider;
}

/**
 * Whether this row is the password rather than an identity provider.
 *
 * It is the seam the settings page is split on: a password is set, changed and
 * removed, and a linked account is connected and disconnected. They were one
 * section for as long as they were rows of one database table, which is a fact
 * about our storage and never a fact about the person reading.
 */
export function isCredentialAccount({
  provider,
  providerAccountId,
}: {
  provider: string;
  providerAccountId: string;
}): boolean {
  if (provider === "credential") return true;
  if (provider === "auth0") {
    const [strategy] = providerAccountId.split("|");
    return strategy === "auth0";
  }
  return false;
}
