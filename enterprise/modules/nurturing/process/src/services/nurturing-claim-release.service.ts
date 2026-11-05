// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";

/** Gives claims back when the work they guard failed, so its retry acts. */
export class NurturingClaimReleaseService {
  static create(claims: NurturingClaimRepository): NurturingClaimReleaseService {
    return new NurturingClaimReleaseService(claims);
  }

  private constructor(private readonly claims: NurturingClaimRepository) {}

  /** Gives every claim back; the reasons a release failed, so the caller's error carries them. */
  async releasedAll(keys: readonly string[]): Promise<unknown[]> {
    const results = await Promise.allSettled(keys.map((key) => this.claims.release(key)));
    return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  }

  /** Gives back the claims of a step that failed, then fails with its error. */
  async rethrowAfterReleasing({
    error,
    keys,
  }: Readonly<{ error: unknown; keys: readonly string[] }>): Promise<never> {
    const released = await this.releasedAll(keys);
    if (released.length > 0) {
      throw new AggregateError([error, ...released], "nurturing could not give back every claim");
    }
    throw error;
  }
}
