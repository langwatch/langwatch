/**
 * The installation-token rows the GitHub App keeps outside Postgres: a minted
 * token, an installation's liveness verdict, and the two locks that keep one
 * process minting at a time — short-lived, so Redis-backed where Redis exists.
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
