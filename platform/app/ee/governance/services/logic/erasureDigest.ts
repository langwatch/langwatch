// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One digest, used for two jobs (ADR-128 §9 steps 1 and 5).
 *
 * When a governance identity is erased we need to do two things forever after:
 * recognise the identifier if a provider sends it again, and write something
 * stable in its place. Both are the same function of the same input, so a write
 * path computes it once and uses it twice — as the membership test against the
 * suppression list, and, on a hit, as the value it writes instead of the
 * original.
 *
 * That is why there is no table mapping pseudonyms back to originals, and why
 * there must never be one: such a table would hold the erased identifier in
 * plaintext forever, which is the opposite of what the erasure was for. The
 * fold already holds the original in hand — it just read it off the raw event —
 * so a membership test and a recomputation are all it needs.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import { createHmac } from "node:crypto";

/**
 * The environment variable holding the digest's secret.
 *
 * NEVER ROTATE THIS VALUE ON A DEPLOYMENT THAT HAS ERASED ANYONE. Every stored
 * digest is a function of it, so a rotation makes the whole suppression list
 * stop matching: the next thirty-day-lookback pull re-ingests every erased
 * identifier, and nothing anywhere reports that it happened. There is no
 * migration path either, because recomputing the digests under a new secret
 * would require the identifiers, which is precisely what was erased.
 */
export const ERASURE_SECRET_ENV = "GOVERNANCE_ERASURE_PSEUDONYM_SECRET";

/**
 * The shortest secret worth calling one. An email address is low-entropy
 * enough to brute-force against a bare SHA-256, so the secret is the only
 * thing standing between somebody holding a copy of the suppression list and
 * the addresses it was built to keep out.
 */
export const ERASURE_SECRET_MIN_LENGTH = 32;

/**
 * Raised when erasure is asked for on a deployment that has no digest secret.
 *
 * Deliberately fatal rather than defaulted. Hashing with an empty secret would
 * produce a list that looks identical to a real one and protects nothing, and
 * the failure would only ever be discovered by whoever brute-forced it.
 */
export class ErasureSecretMissingError extends Error {
  name = "ErasureSecretMissingError" as const;

  constructor(reason: string) {
    super(
      `Governance erasure needs ${ERASURE_SECRET_ENV} to be set to at least ${ERASURE_SECRET_MIN_LENGTH} characters (${reason}). Generate one with \`openssl rand -hex 32\`, set it once, and never change it: every digest already stored is a function of this value.`,
    );
  }
}

/**
 * Reads the digest secret, refusing anything too short to be one.
 *
 * Takes the environment as a parameter rather than reaching for `process.env`
 * so a test can state the secret it is reasoning about instead of mutating the
 * process.
 */
export function readErasureSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  const secret = env[ERASURE_SECRET_ENV];
  if (!secret) throw new ErasureSecretMissingError("it is unset");
  if (secret.length < ERASURE_SECRET_MIN_LENGTH) {
    throw new ErasureSecretMissingError(
      `it is ${secret.length} characters long`,
    );
  }
  return secret;
}

/**
 * `HMAC-SHA256(secret, identifier)`, lowercase hex.
 *
 * HMAC rather than `SHA-256(secret ‖ identifier)`, which is the construction
 * HMAC exists to replace: a plain hash of a secret followed by a message is
 * length-extendable, so anyone holding one digest can derive the digest of a
 * longer identifier sharing that prefix without knowing the secret. Email
 * addresses share prefixes constantly. Every other keyed digest in this
 * codebase is an HMAC — both peppers included — and this is the same job.
 *
 * Deterministic in the identifier, which is what lets a replay of any day land
 * on the same key without anything having been stored: replay the same events
 * a hundred times and the erased actor is the same one row every time, holding
 * the correct total.
 *
 * The identifier is fed in verbatim, with no trimming or case folding. A
 * provider that sends `M.Silva@acme.test` today and `m.silva@acme.test`
 * tomorrow is sending two identifiers as far as every other part of this
 * system is concerned — the rollup keys them as two rows — and normalising
 * only here would make the suppression list disagree with the table it is
 * meant to keep clean.
 */
export function erasureDigest({
  secret,
  identifier,
}: {
  secret: string;
  identifier: string;
}): string {
  return createHmac("sha256", secret).update(identifier).digest("hex");
}
