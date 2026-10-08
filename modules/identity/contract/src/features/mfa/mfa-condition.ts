import { z } from "zod";

/** What a session proved and how organizations enforce MFA requirements. A membership condition
 * that holds members at an enrollment gate if they cannot prove a second factor. See D06/D07.
 */

/**
 * Authentication method references (RFC 8176, plus `saml`). A CLOSED list —
 * `amr` comes from a provider we do not control, and nothing here infers a
 * factor the provider did not assert.
 */
export const AMR_VALUES = [
  /** A password. */
  "pwd",
  /** A one-time code from an authenticator. */
  "otp",
  /** A PIN. */
  "pin",
  /** Federated: the sign-in went through SAML. Says nothing about factors. */
  "saml",
  /** Federated: the sign-in went through OpenID Connect. Same. */
  "oidc",
  /** A phishing-resistant proof of possession — a passkey. */
  "phw",
  /** A hardware-secured key. */
  "hwk",
  /** A software-secured key. */
  "swk",
  /** The provider states it ran multi-factor authentication of its own. */
  "mfa",
] as const;
export const amrSchema = z.enum(AMR_VALUES);
export type Amr = (typeof AMR_VALUES)[number];

/** The `amr` values that assert a second factor. `pwd`, `saml`, and `oidc` are first-factor only;
 * `swk` is absent because software keys don't count as proof the user holds a factor.
 */
export const SECOND_FACTOR_AMR_VALUES = [
  "otp",
  "phw",
  "hwk",
  "mfa",
] as const satisfies readonly Amr[];

/**
 * The passkey's value. Possession-based AND phishing-resistant — unlike an
 * authenticator code, a convincing site cannot talk a browser into signing a
 * challenge for the wrong origin.
 */
export const PHISHING_RESISTANT_AMR = "phw" as const satisfies Amr;

/** The first-factor proof a password sign-in records. */
export const PASSWORD_AMR = "pwd" as const satisfies Amr;

/** An authenticator code — what answering a two-step challenge records. */
export const TOTP_AMR = "otp" as const satisfies Amr;

export function isAmr(value: string): value is Amr {
  return (AMR_VALUES as readonly string[]).includes(value);
}

/**
 * Whether one `amr` value asserts a second factor. Unrecognized values are
 * `false` — the closed list IS the rule about inferring nothing.
 */
export function assertsSecondFactor(value: string): boolean {
  return (SECOND_FACTOR_AMR_VALUES as readonly string[]).includes(value);
}

/**
 * The recognized second factors a session recorded. Order-preserving and
 * de-duplicated, so a caller can say WHICH factor satisfied the condition —
 * an administrator looking at a connection needs that, not a boolean.
 */
export function secondFactorsIn(amr: readonly string[] | null | undefined): readonly Amr[] {
  if (!amr) return [];
  const seen = new Set<string>();
  const factors: Amr[] = [];
  for (const value of amr) {
    if (!assertsSecondFactor(value) || seen.has(value)) continue;
    seen.add(value);
    factors.push(value as Amr);
  }
  return factors;
}

/**
 * Whether the sign-in that minted a session proved a second factor on its
 * own — independently of anything set up on the account.
 */
export function signInProvedSecondFactor(amr: readonly string[] | null | undefined): boolean {
  return secondFactorsIn(amr).length > 0;
}

/**
 * A session that recorded nothing — every session minted before D06, plus any
 * ordinary password sign-in with no enrollment. Not an error; nothing ends a
 * session over it.
 */
export function recordedNothing(amr: readonly string[] | null | undefined): boolean {
  return !amr || amr.length === 0;
}

/** What is known about the person and the session that is asking. */
export interface SecondFactorEvidence {
  /** The person's own two-step verification is ENABLED. */
  accountEnrollmentEnabled: boolean;
  /** What the session that is asking recorded it proved; null before D06. */
  amr: readonly string[] | null;
}

/**
 * Why a member reaches an organization's data, or does not. Named rather than
 * boolean: the enrollment gate must say WHAT would let them through.
 */
export const secondFactorSatisfactionSchema = z.discriminatedUnion("by", [
  /** The organization does not require one. */
  z.object({ satisfied: z.literal(true), by: z.literal("not_required") }),
  /** Set up on the person's own account. */
  z.object({ satisfied: z.literal(true), by: z.literal("account_enrollment") }),
  /** Proved on this sign-in — a passkey, or a provider that asserted one. */
  z.object({
    satisfied: z.literal(true),
    by: z.literal("sign_in"),
    factors: z.array(amrSchema).readonly(),
  }),
  /** Held at the enrollment gate for this organization alone. */
  z.object({ satisfied: z.literal(false), by: z.literal("none") }),
]);
export type SecondFactorSatisfaction = z.infer<typeof secondFactorSatisfactionSchema>;

/** Evaluates whether a member satisfies the organization's MFA requirement at access time. Checks
 * account enrollment first because it is the durable answer across sessions.
 */
export function satisfiesOrganizationMfaRequirement({
  mfaRequired,
  evidence,
}: {
  mfaRequired: boolean;
  evidence: SecondFactorEvidence;
}): SecondFactorSatisfaction {
  if (!mfaRequired) return { satisfied: true, by: "not_required" };
  if (evidence.accountEnrollmentEnabled) {
    return { satisfied: true, by: "account_enrollment" };
  }
  const factors = secondFactorsIn(evidence.amr);
  if (factors.length > 0) return { satisfied: true, by: "sign_in", factors };
  return { satisfied: false, by: "none" };
}

/**
 * What a two-step challenge may ask for. Closed: a passkey is a FIRST factor
 * here, so the challenge screen must not offer it as a way to set one up.
 */
export const MFA_CHALLENGE_METHODS = ["totp", "backup_code"] as const;
export type MfaChallengeMethod = (typeof MFA_CHALLENGE_METHODS)[number];

export function isMfaChallengeMethod(value: string): value is MfaChallengeMethod {
  return (MFA_CHALLENGE_METHODS as readonly string[]).includes(value);
}

/**
 * Whether an identity provider connection asserts a second factor for its
 * sign-ins. When it does not, federated members are held at the enrollment
 * gate for their provider's configuration, not our bug.
 */
export function connectionAssertsSecondFactor(
  assertedAmr: readonly string[] | null | undefined,
): boolean {
  return signInProvedSecondFactor(assertedAmr);
}
