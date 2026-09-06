import { z } from "zod";

/**
 * What a session proved, and what an organization does with it (D06, D07).
 *
 * `Organization.mfaRequired` is a MEMBERSHIP CONDITION — "every member of
 * this organization can prove a second factor" — and not a policy evaluated
 * per session. It is asked when a member reaches that organization's data,
 * it holds the ones who cannot prove one at an enrollment gate for THAT
 * organization alone, and it ends no session, ever.
 *
 * Three things satisfy it and the organization does not care which:
 *
 *   1. an enrollment on the person's own account (D06)
 *   2. a passkey on the sign-in that minted this session (D07, `phw`)
 *   3. an identity provider that ASSERTED a factor at sign-in (`amr`)
 *
 * (1) is a property of the account and travels with the person. (2) and (3)
 * are properties of the SIGN-IN, which is the whole reason a session records
 * `amr` at all: somebody whose only second factor is a passkey meets the gate
 * again when they sign in with a password instead, because that sign-in
 * proved nothing extra.
 */

/**
 * Authentication method references (RFC 8176 vocabulary, plus `saml` for the
 * federated case). A CLOSED list on purpose: `amr` arrives from an identity
 * provider we do not control, and the one rule that matters here is that
 * nothing infers a factor the provider did not assert. An unrecognized value
 * is kept for the record and asserts nothing.
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

/**
 * The `amr` values that assert a SECOND factor, and nothing else does.
 *
 * `pwd` is the first factor. `saml` and `oidc` name a protocol, not a proof —
 * a connection that asserts only those is asserting nothing, and its members
 * are held at the gate like anybody else. `swk` is deliberately absent: a
 * software key is a key the provider holds, and we are not going to read a
 * second factor into it on the provider's behalf.
 */
export const SECOND_FACTOR_AMR_VALUES = [
  "otp",
  "phw",
  "hwk",
  "mfa",
] as const satisfies readonly Amr[];

/**
 * The passkey's value. A passkey is possession-based AND phishing-resistant,
 * so it clears the bar `mfaRequired` exists for and one that an authenticator
 * code does not: a convincing website can talk somebody through reading a
 * code off their screen, and cannot talk a browser into signing a challenge
 * for the wrong origin.
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
export function secondFactorsIn(
  amr: readonly string[] | null | undefined,
): readonly Amr[] {
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
export function signInProvedSecondFactor(
  amr: readonly string[] | null | undefined,
): boolean {
  return secondFactorsIn(amr).length > 0;
}

/**
 * A session that recorded nothing. Every session minted before D06 is one of
 * these, and so is every ordinary password sign-in by somebody with no
 * enrollment — which is why a null `amr` has to be a first-class value here
 * and not an error. Nothing about it ends a session.
 */
export function recordedNothing(
  amr: readonly string[] | null | undefined,
): boolean {
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
 * boolean because the enrollment gate has to tell the person WHAT would let
 * them through, and an administrator's member list has to say which of their
 * members is held.
 */
export type SecondFactorSatisfaction =
  /** The organization does not require one. */
  | { satisfied: true; by: "not_required" }
  /** Set up on the person's own account. */
  | { satisfied: true; by: "account_enrollment" }
  /** Proved on this sign-in — a passkey, or a provider that asserted one. */
  | { satisfied: true; by: "sign_in"; factors: readonly Amr[] }
  /** Held at the enrollment gate for this organization alone. */
  | { satisfied: false; by: "none" };

/**
 * The membership condition, in one place. Evaluated when a member reaches an
 * organization's data — never at session mint, and never as a step-up.
 *
 * The account is checked first because it is the durable answer: somebody who
 * has set one up is challenged at every sign-in, so a session of theirs that
 * never answered cannot exist, and the sign-in evidence would only restate
 * what the account already settles.
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
 * What a two-step challenge may ask for, and it is a closed list because the
 * answer to "why not a passkey too" is that a passkey is a FIRST factor here.
 * Registering one is a way in, never a way of setting two-step verification
 * up, and the challenge screen must not offer it as one.
 */
export const MFA_CHALLENGE_METHODS = ["totp", "backup_code"] as const;
export type MfaChallengeMethod = (typeof MFA_CHALLENGE_METHODS)[number];

export function isMfaChallengeMethod(value: string): value is MfaChallengeMethod {
  return (MFA_CHALLENGE_METHODS as readonly string[]).includes(value);
}

/**
 * Whether an identity provider connection is asserting a second factor for
 * the people who sign in through it. An administrator whose organization
 * requires one needs to be told when the answer is no — otherwise every one
 * of their federated members is held at a gate for a reason that looks like
 * our bug and is their identity provider's configuration.
 */
export function connectionAssertsSecondFactor(
  assertedAmr: readonly string[] | null | undefined,
): boolean {
  return signInProvedSecondFactor(assertedAmr);
}
