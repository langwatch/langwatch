/** A lock this caller now holds, with the token that releases it, or one someone else holds. */
export type GithubLockAcquisition = { acquired: true; token: string } | { acquired: false };

/** One installation on one GitHub host: the same id on two hosts is two installations. */
export type GithubInstallationKey = { host: string; installationId: string };

/**
 * The installation-token rows the GitHub App keeps outside Postgres: a minted
 * token, an installation's liveness verdict, and the two locks that keep one
 * process minting at a time — short-lived, so Redis-backed in the live tier.
 */
export abstract class GithubTokenCacheRepository {
  abstract findToken(input: GithubInstallationKey & { scopeKey: string }): Promise<string | null>;
  abstract storeToken(
    input: GithubInstallationKey & { scopeKey: string; token: string; ttlSec: number },
  ): Promise<void>;
  abstract hasLiveness(input: GithubInstallationKey): Promise<boolean>;
  abstract markLiveness(
    input: GithubInstallationKey & { value: "alive" | "backoff"; ttlSec: number },
  ): Promise<void>;
  abstract acquireLivenessLock(input: GithubInstallationKey): Promise<GithubLockAcquisition>;
  abstract acquireMintLock(
    input: GithubInstallationKey & { scopeKey: string },
  ): Promise<GithubLockAcquisition>;
  abstract releaseLivenessLock(input: GithubInstallationKey & { token: string }): Promise<void>;
  abstract releaseMintLock(
    input: GithubInstallationKey & { scopeKey: string; token: string },
  ): Promise<void>;
}
