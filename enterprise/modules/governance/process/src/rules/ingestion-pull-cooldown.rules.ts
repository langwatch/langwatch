// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The longest wait a provider can talk us into: a malformed answer self-corrects within a day. */
export const INGESTION_PULL_MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** What a provider's refusal asks of us: nothing, or to wait until an instant. */
export type ProviderWait = { outcome: "no_wait" } | { outcome: "wait_until"; at: number };

/** Anything but a readable positive length is no wait; measured from the refusal instant. */
export function providerWaitFrom({
  retryAfterMs,
  refusedAt,
}: {
  retryAfterMs: number | null | undefined;
  refusedAt: number;
}): ProviderWait {
  if (retryAfterMs == null || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    return { outcome: "no_wait" };
  }
  return {
    outcome: "wait_until",
    at: refusedAt + Math.min(retryAfterMs, INGESTION_PULL_MAX_COOLDOWN_MS),
  };
}

/** The wait a provider named on a thrown error, read by shape. */
export function providerWaitOnError(
  error: unknown,
): { outcome: "no_wait" } | { outcome: "named"; retryAfterMs: number } {
  if (typeof error !== "object" || error === null || !("retryAfterMs" in error)) {
    return { outcome: "no_wait" };
  }
  const named = error.retryAfterMs;
  return typeof named === "number" && Number.isFinite(named) && named > 0
    ? { outcome: "named", retryAfterMs: named }
    : { outcome: "no_wait" };
}

/** Absence and an expired instant both read as no wait. */
export function isInCooldown({
  cooldownUntil,
  now,
}: {
  cooldownUntil: number | null | undefined;
  now: number;
}): boolean {
  return cooldownUntil != null && cooldownUntil > now;
}
