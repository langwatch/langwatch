export abstract class GithubTokenCachePort {
  abstract tryGetToken(input: { installationId: string; scopeKey: string }): Promise<string | null>;
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
  abstract tryAcquireLivenessLock(installationId: string): Promise<string | null>;
  abstract tryAcquireMintLock(input: {
    installationId: string;
    scopeKey: string;
  }): Promise<string | null>;
  abstract releaseLivenessLock(installationId: string, token: string): Promise<void>;
  abstract releaseMintLock(input: {
    installationId: string;
    scopeKey: string;
    token: string;
  }): Promise<void>;
}
