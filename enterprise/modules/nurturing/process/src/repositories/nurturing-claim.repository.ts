// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** Remembers a key for the window in which a redelivery must not act twice. */
export interface NurturingClaimRepository {
  /** True the first time this key is seen inside the window, false after. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  /** Forgets a claim whose work failed, so its redelivery acts. */
  release(key: string): Promise<void>;
}

/** Gives every claim back; the reasons a release failed, so the caller's error carries them. */
export async function releasedAll({
  keys,
  claims,
}: Readonly<{ keys: readonly string[]; claims: NurturingClaimRepository }>): Promise<unknown[]> {
  const results = await Promise.allSettled(keys.map((key) => claims.release(key)));
  return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}

/** Gives back the claims of a step that failed, then fails with its error, so its retry acts. */
export async function rethrowAfterReleasing({
  error,
  keys,
  claims,
}: Readonly<{
  error: unknown;
  keys: readonly string[];
  claims: NurturingClaimRepository;
}>): Promise<never> {
  const released = await releasedAll({ keys, claims });
  if (released.length > 0) {
    throw new AggregateError([error, ...released], "nurturing could not give back every claim");
  }
  throw error;
}
