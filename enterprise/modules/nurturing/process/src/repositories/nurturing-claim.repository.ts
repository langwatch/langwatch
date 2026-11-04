// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** Remembers a key for the window in which a redelivery must not act twice. */
export interface NurturingClaimRepository {
  /** True the first time this key is seen inside the window, false after. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  /** Forgets a claim whose work failed, so its redelivery acts. */
  release(key: string): Promise<void>;
}
