/**
 * The installation-token rows the GitHub App keeps outside Postgres: a minted
 * token under its scope key, the liveness verdict for an installation, and the
 * two locks that keep one process minting at a time. Every one of them is a
 * short-lived row with a time to live, which is why they live in Redis in a
 * deployment that has Redis and in the memory tier in a process that does not.
 */
export abstract class GithubTokenCacheRepository {
  abstract findToken(input: { installationId: string; scopeKey: string }): Promise<string | null>;
  abstract storeToken(input: {
    installationId: string;
    scopeKey: string;
    token: string;
    ttlSec: number;
  }): Promise<void>;
  abstract hasLiveness(installationId: string): Promise<boolean>;
  abstract markLiveness(input: {
    installationId: string;
    value: "alive" | "backoff";
    ttlSec: number;
  }): Promise<void>;
  abstract acquireLivenessLock(installationId: string): Promise<string | null>;
  abstract acquireMintLock(input: {
    installationId: string;
    scopeKey: string;
  }): Promise<string | null>;
  abstract releaseLivenessLock(input: { installationId: string; token: string }): Promise<void>;
  abstract releaseMintLock(input: {
    installationId: string;
    scopeKey: string;
    token: string;
  }): Promise<void>;
}
