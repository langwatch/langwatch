// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createHmac } from "node:crypto";

import { ErasureSecretMissingError } from "@langwatch/enterprise-governance-contract";

/** An email is low-entropy; the secret is all that stands between the list and a brute force. */
export const ERASURE_SECRET_MIN_LENGTH = 32;

/** Refuses a secret too short to be one. Never rotate it once anyone is erased (ADR-128 §9). */
export function getErasureSecret({ secret }: { secret: string | undefined }): string {
  if (!secret) throw new ErasureSecretMissingError("it is unset");
  if (secret.length < ERASURE_SECRET_MIN_LENGTH) {
    throw new ErasureSecretMissingError(`it is ${secret.length} characters long`);
  }
  return secret;
}

/**
 * `HMAC-SHA256(secret, identifier)`, lowercase hex: the suppression key and the pseudonym at
 * once, so no table maps pseudonyms back. HMAC, not a length-extendable `SHA-256(secret‖id)`;
 * the identifier goes in verbatim, as the rollup keys it. Spec: governance-identity-and-erasure.
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

/** The pseudonym, and every digest to suppress — the display text too when it differs. */
export function erasureDigestsFor({
  secret,
  person,
}: {
  secret: string;
  person: { rawActorId: string; displayText: string };
}): { pseudonym: string; identifierHashes: string[] } {
  const pseudonym = erasureDigest({ secret, identifier: person.rawActorId });
  if (person.displayText === person.rawActorId) return { pseudonym, identifierHashes: [pseudonym] };
  return {
    pseudonym,
    identifierHashes: [pseudonym, erasureDigest({ secret, identifier: person.displayText })],
  };
}
