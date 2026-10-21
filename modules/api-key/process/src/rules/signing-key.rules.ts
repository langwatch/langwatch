import type { SigningKeyStatus } from "@langwatch/api-key-contract";
import type { Instant } from "@langwatch/time";

import { SIGNING_KEY_USAGE_HOUR_MS } from "../repositories/signing-key-usage.repository.ts";

type SigningKeyLifetime = Readonly<{ revokedAt: Instant | null; verifiesUntil: Instant | null }>;

/** A key verifies until it is revoked or its rotation overlap ends, whichever comes first. */
export function signingKeyVerifiesAt({
  key,
  at,
}: {
  key: SigningKeyLifetime;
  at: number;
}): boolean {
  if (key.revokedAt !== null) return false;
  return key.verifiesUntil === null || key.verifiesUntil.epochMilliseconds > at;
}

/** Revoked once it no longer verifies; verifying while a rotation overlap runs; else active. */
export function signingKeyStatusOf({
  key,
  at,
}: {
  key: SigningKeyLifetime;
  at: number;
}): SigningKeyStatus {
  if (!signingKeyVerifiesAt({ key, at })) return "revoked";
  return key.verifiesUntil === null ? "active" : "verifying";
}

/** The hour a count is held under. */
export function signingKeyUsageHourOf({ at }: { at: number }): number {
  return Math.floor(at / SIGNING_KEY_USAGE_HOUR_MS);
}
