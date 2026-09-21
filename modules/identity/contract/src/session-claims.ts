import {
  type Amr,
  isAmr,
  PASSWORD_AMR,
  PHISHING_RESISTANT_AMR,
  TOTP_AMR,
} from "./mfa-condition.ts";

/**
 * What a sign-in proved, and which way in minted the session (D06). Pure over
 * better-auth's own endpoint path, so a decision a session carries for thirty
 * days is testable without an authentication round trip.
 */

/** better-auth's endpoint paths that mint a session, as we read them. */
const CREDENTIAL_PATHS = ["/sign-in/email", "/sign-up/email"] as const;
const TWO_FACTOR_PATHS = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"] as const;
const PASSKEY_PATHS = ["/passkey/verify-authentication"] as const;

/**
 * What a path says about the sign-in behind it. Not recognizing a path is an
 * ordinary answer, stated rather than spelled as an absence.
 */
export type SignInPathReading =
  | { readonly recognized: true; readonly provider: string }
  | { readonly recognized: false };

const UNRECOGNIZED_PATH: SignInPathReading = { recognized: false };

/**
 * The provider a path signs in through, in the vocabulary `Account.provider`
 * and `Identifier.provider` use. A federated callback names its own provider
 * in the path, so several mounted providers stay distinguishable.
 */
export function signInProviderForPath({ path }: { path: string }): SignInPathReading {
  if ((CREDENTIAL_PATHS as readonly string[]).includes(path)) {
    return { recognized: true, provider: "credential" };
  }
  // A two-step challenge stands between a password and a session: the account
  // being signed into is the credential one, and the challenge is a second
  // proof on the same method rather than a method of its own.
  if ((TWO_FACTOR_PATHS as readonly string[]).includes(path)) {
    return { recognized: true, provider: "credential" };
  }
  if ((PASSKEY_PATHS as readonly string[]).includes(path)) {
    return { recognized: true, provider: "passkey" };
  }
  const callback = /^\/(?:oauth2\/)?callback\/([^/?#]+)/.exec(path);
  if (callback?.[1]) return { recognized: true, provider: callback[1] };
  // The SSO plugin's own callbacks, which do not live under `/callback`.
  // Missing them left every session minted through a customer's identity
  // provider with no `identifierId` and an empty `amr`, so that organization's
  // own members were held at a gate their provider could never clear.
  const federated =
    /^\/sso\/callback\/([^/?#]+)/.exec(path) ?? /^\/sso\/saml2\/sp\/acs\/([^/?#]+)/.exec(path);
  return federated?.[1] ? { recognized: true, provider: federated[1] } : UNRECOGNIZED_PATH;
}

/**
 * What the sign-in itself proved, before anything the identity provider
 * asserted. Empty for a path we do not recognize — every path we do proves at
 * least one thing, so the two cases never need telling apart.
 */
export function localFactorsForPath({ path }: { path: string }): readonly Amr[] {
  if ((CREDENTIAL_PATHS as readonly string[]).includes(path)) return [PASSWORD_AMR];
  // The password is what the challenge stands behind: better-auth mints the
  // session here, not at `/sign-in/email`. A backup code records the same
  // `otp` as an authenticator code, so the list is no oracle for which one
  // somebody fell back to.
  if ((TWO_FACTOR_PATHS as readonly string[]).includes(path)) return [PASSWORD_AMR, TOTP_AMR];
  if ((PASSKEY_PATHS as readonly string[]).includes(path)) return [PHISHING_RESISTANT_AMR];
  // A federated callback proves the protocol and nothing more. `oidc` names a
  // protocol, not a proof, so it satisfies no organization's requirement on
  // its own; SAML arrives the same way and is recorded under the same name.
  if (signInProviderForPath({ path }).recognized) return ["oidc"];
  return [];
}

/**
 * Everything the session should record: what the path proved plus what the
 * identity provider asserted, de-duplicated and in order. An assertion
 * outside the closed vocabulary is DROPPED, never carried.
 */
export function deriveSessionAmr({
  path,
  providerAssertedAmr = [],
}: {
  path: string;
  providerAssertedAmr?: readonly string[];
}): readonly Amr[] {
  const local = localFactorsForPath({ path });
  if (local.length === 0) return [];
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
 * Which of somebody's ways in minted a session, as a value something can
 * decide on. `oidc` and `saml` give ONE answer: a federated callback records
 * the protocol, never which mounted provider it was.
 */
export type SignedInWith = "password" | "passkey" | "federated" | "unknown";

/**
 * `unknown` is an ordinary answer rather than a missing one: every session
 * minted before the column recorded no factors at all, and nothing may read
 * that as a password.
 */
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
 * The words are a rendering of the answer above rather than a second reading
 * of `amr`, so a screen that ACTS on which method minted a session and a
 * screen that PRINTS it cannot disagree about what it proved.
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
