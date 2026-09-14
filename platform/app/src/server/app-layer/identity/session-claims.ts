import {
  type Amr,
  isAmr,
  PASSWORD_AMR,
  PHISHING_RESISTANT_AMR,
  TOTP_AMR,
} from "@langwatch/identity";

/**
 * What a sign-in proved, and which of the person's sign-in methods minted the
 * session it produced (D06).
 *
 * A pure module over better-auth's own endpoint path, for the reason the
 * enrollment gate's decision is one: the answer decides what a session
 * carries for thirty days, and a rule that consequential has to be testable
 * without an authentication round trip.
 *
 * Two rules run through every branch below and neither has an exception:
 *
 *   1. Nothing infers a factor that was not proved. A path we do not
 *      recognize records NOTHING rather than guessing, and an identity
 *      provider that asserts nothing contributes nothing - which is exactly
 *      what holds its members at an organization's enrollment gate.
 *   2. Recording nothing is an ordinary answer, not an error. Every session
 *      minted before this shipped records nothing, and the membership
 *      condition reads that as "proved nothing" rather than as a session to
 *      end.
 */

/** better-auth's endpoint paths that mint a session, as we read them. */
const CREDENTIAL_PATHS = ["/sign-in/email", "/sign-up/email"] as const;
const TWO_FACTOR_PATHS = [
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
] as const;
const PASSKEY_PATHS = ["/passkey/verify-authentication"] as const;

/**
 * The provider a path signs in through, in the vocabulary `Account.provider`
 * and `Identifier.provider` use. A federated callback names its own provider
 * in the path (`/callback/auth0`), which is how one deployment's several
 * mounted providers stay distinguishable.
 */
export function signInProviderForPath({
  path,
}: {
  path: string;
}): string | null {
  if ((CREDENTIAL_PATHS as readonly string[]).includes(path)) {
    return "credential";
  }
  // A two-step challenge stands between a password and a session: the account
  // that is being signed into is the credential one, and the challenge is a
  // second proof on the same method rather than a method of its own.
  if ((TWO_FACTOR_PATHS as readonly string[]).includes(path)) {
    return "credential";
  }
  if ((PASSKEY_PATHS as readonly string[]).includes(path)) return "passkey";
  const callback = /^\/(?:oauth2\/)?callback\/([^/?#]+)/.exec(path);
  if (callback?.[1]) return callback[1];
  // THE SSO PLUGIN'S OWN CALLBACKS, which do not live under `/callback`.
  //
  // Missing these meant every session minted through a customer's identity
  // provider recorded no `identifierId` and an empty `amr` — so an
  // organization that turned its second-factor requirement on held every
  // member who signed in through its OWN provider at a gate that provider's
  // assertion could never clear, and per-identifier revocation could never
  // reach a federated session. The captured group is the connection id,
  // which is what `Identifier.provider` holds for these accounts.
  const federated =
    /^\/sso\/callback\/([^/?#]+)/.exec(path) ??
    /^\/sso\/saml2\/sp\/acs\/([^/?#]+)/.exec(path);
  return federated?.[1] ?? null;
}

/**
 * What the sign-in itself proved, before anything the identity provider
 * asserted is added.
 *
 * `null` means "we do not recognize this path", which is a different answer
 * from "this path proved nothing": an unrecognized path records nothing at
 * all, and a federated callback records the protocol it went through even
 * when the provider asserted no factor beside it.
 */
export function localFactorsForPath({
  path,
}: {
  path: string;
}): readonly Amr[] | null {
  if ((CREDENTIAL_PATHS as readonly string[]).includes(path)) {
    return [PASSWORD_AMR];
  }
  if ((TWO_FACTOR_PATHS as readonly string[]).includes(path)) {
    // The password is what the challenge stands behind: better-auth does not
    // mint a session at `/sign-in/email` for an account with two-step
    // verification on, it mints one here once the code is right. A backup
    // code records the same `otp` as an authenticator code - it is a
    // one-time code by another name, and answering differently would make
    // the session list an oracle for which one somebody had to fall back to.
    return [PASSWORD_AMR, TOTP_AMR];
  }
  if ((PASSKEY_PATHS as readonly string[]).includes(path)) {
    return [PHISHING_RESISTANT_AMR];
  }
  // A federated callback proves the protocol and nothing more. `oidc` names
  // a protocol, not a proof, so this satisfies no organization's requirement
  // on its own - the provider's own assertion is what can. SAML's assertion
  // arrives the same way and is recorded under the same name: what the
  // organization's requirement reads is the provider's `amr`, and naming the
  // binding here would make one protocol satisfy a rule the other could not.
  if (signInProviderForPath({ path })) return ["oidc"];
  return null;
}

/**
 * Everything the session should record: what the path proved, plus the
 * factors the identity provider asserted, de-duplicated and in order.
 *
 * Unrecognized assertions are DROPPED rather than carried. `amr` arrives from
 * a provider we do not control, and the closed vocabulary is what stops an
 * invented value from being read as a factor later.
 */
export function deriveSessionAmr({
  path,
  providerAssertedAmr = [],
}: {
  path: string;
  providerAssertedAmr?: readonly string[];
}): readonly Amr[] {
  const local = localFactorsForPath({ path });
  if (local === null) return [];
  const seen = new Set<Amr>();
  const factors: Amr[] = [];
  for (const value of [...local, ...providerAssertedAmr]) {
    if (!isAmr(value) || seen.has(value)) continue;
    seen.add(value);
    factors.push(value);
  }
  return factors;
}

/**
 * Which of somebody's ways in minted this session, as a value something can
 * decide on.
 *
 * ADR-120 needs this, and needs it as a value rather than a sentence: a
 * passkey is offered where it REPLACES a password, so the offer has to know
 * whether a password is what got somebody in. Reading `amr` at each place that
 * asks would put RFC 8176's vocabulary in a dialog component and let two
 * readings of the same session drift apart.
 *
 * `oidc` and `saml` give ONE answer on purpose. A federated callback records
 * the protocol it went through and nothing about which mounted provider it
 * was, so telling a customer's identity provider apart from a brokered social
 * sign-in here would be inventing a distinction the session does not carry.
 *
 * `unknown` is an ordinary answer rather than a missing one: every session
 * minted before D06 recorded no factors at all, and nothing may read that as a
 * password.
 */
export type SignedInWith = "password" | "passkey" | "federated" | "unknown";

export function signedInWithFor({
  amr,
}: {
  amr: readonly string[] | null | undefined;
}): SignedInWith {
  if (!amr || amr.length === 0) return "unknown";
  if (amr.includes(PHISHING_RESISTANT_AMR)) return "passkey";
  if (amr.includes("oidc") || amr.includes("saml")) return "federated";
  if (amr.includes(PASSWORD_AMR)) return "password";
  return "unknown";
}

/**
 * How a session reads on somebody's own list of signed-in devices.
 *
 * Words rather than the wire values: `pwd` and `phw` are RFC 8176's
 * vocabulary and nobody outside this file should have to learn it. A session
 * that recorded nothing reads as an ordinary sign-in, because that is what it
 * is - every session minted before this shipped is one.
 *
 * The words are a rendering of the answer above rather than a second reading
 * of `amr`. A screen that ACTS on which method minted a session and a screen
 * that PRINTS it cannot then disagree about what the session proved.
 */
const SIGN_IN_METHOD_LABELS: Record<SignedInWith, string> = {
  passkey: "Passkey",
  federated: "Identity provider",
  password: "Email and password",
  unknown: "Signed in",
};

export function signInMethodLabelFor({
  amr,
}: {
  amr: readonly string[] | null | undefined;
}): string {
  return SIGN_IN_METHOD_LABELS[signedInWithFor({ amr })];
}
