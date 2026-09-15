import { nativeProviderIdOfAuth0Strategy } from "@langwatch/identity";

/** One better-auth `Account` row, of the parts these screens read. */
export interface LinkedAccount {
  id: string;
  provider: string;
  providerAccountId: string;
}

/**
 * Which sign-in method a linked account IS.
 *
 * An Auth0 deployment holds every identity under the one `auth0` provider
 * and names the real one in the subject — `google-oauth2|…`,
 * `windowslive|…` — so a row would otherwise read "Auth0" to somebody who
 * has only ever clicked a Google button. The strategy vocabulary is
 * `@langwatch/identity`'s one table, shared with the backfill's derivation
 * and the connection bridge, so the row here and the button there can never
 * name the same identity differently. A method id rather than a name, so
 * the row's mark and words come from the same places the auth screens'
 * buttons take them from.
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
  return (
    nativeProviderIdOfAuth0Strategy(strategy ?? "") ?? strategy ?? provider
  );
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
