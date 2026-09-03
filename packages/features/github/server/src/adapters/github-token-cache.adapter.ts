import { randomBytes } from "node:crypto";

import type { GithubRedisPort } from "../ports/github-app-token.port";
import type { GithubHostPort } from "../ports/github-host.port";
import { GithubTokenCachePort } from "../ports/github-token-cache.port";

const LOCK_TTL_SEC = 15;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_WAIT_MS = 3_000;

function installationPrefix(installationId: string, host: GithubHostPort): string {
  const hostname = host.getHost();
  const segment = hostname === "github.com" ? "" : `${hostname}:`;
  return `langy:gh:insttoken:${segment}${installationId}`;
}

export class GithubTokenCacheAdapter extends GithubTokenCachePort {
  static create(
    redis: GithubRedisPort | null,
    host: GithubHostPort,
  ): GithubTokenCacheAdapter {
    return new GithubTokenCacheAdapter(redis, host);
  }

  private constructor(
    private readonly redis: GithubRedisPort | null,
    private readonly host: GithubHostPort,
  ) {
    super();
  }

  tryGetToken(input: {
    installationId: string;
    scopeKey: string;
  }): Promise<string | null> {
    return this.tryGet(`${this.prefix(input.installationId)}:${input.scopeKey}`);
  }

  storeToken(input: {
    installationId: string;
    scopeKey: string;
    token: string;
    ttlSec: number;
  }): Promise<void> {
    return this.trySet(
      `${this.prefix(input.installationId)}:${input.scopeKey}`,
      input.token,
      input.ttlSec,
    );
  }

  async hasLiveness(installationId: string): Promise<boolean> {
    return Boolean(await this.tryGet(this.livenessKey(installationId)));
  }

  markLiveness(input: {
    installationId: string;
    value: "alive" | "backoff";
    ttlSec: number;
  }): Promise<void> {
    return this.trySet(this.livenessKey(input.installationId), input.value, input.ttlSec);
  }

  tryAcquireLivenessLock(installationId: string): Promise<string | null> {
    return this.tryAcquire(`${this.livenessKey(installationId)}:lock`);
  }

  tryAcquireMintLock(input: {
    installationId: string;
    scopeKey: string;
  }): Promise<string | null> {
    return this.acquire(`${this.prefix(input.installationId)}:${input.scopeKey}:lock`);
  }

  releaseLivenessLock(installationId: string, token: string): Promise<void> {
    return this.release(`${this.livenessKey(installationId)}:lock`, token);
  }

  releaseMintLock(input: {
    installationId: string;
    scopeKey: string;
    token: string;
  }): Promise<void> {
    return this.release(
      `${this.prefix(input.installationId)}:${input.scopeKey}:lock`,
      input.token,
    );
  }

  private prefix(installationId: string): string {
    return installationPrefix(installationId, this.host);
  }

  private livenessKey(installationId: string): string {
    return `${this.prefix(installationId)}:liveness`;
  }

  private async tryGet(key: string): Promise<string | null> {
    if (!this.redis) {
      return null;
    }

    try {
      return await this.redis.tryGet(key);
    } catch {
      return null;
    }
  }

  private async trySet(key: string, value: string, ttlSec: number): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.trySet(key, value, "EX", ttlSec);
    } catch {
      // Cache failure does not change the provider operation's result.
    }
  }

  private async tryAcquire(key: string): Promise<string | null> {
    if (!this.redis) {
      return null;
    }

    const token = randomBytes(16).toString("hex");
    try {
      const result = await this.redis.trySet(key, token, "NX", "EX", LOCK_TTL_SEC);
      return result === "OK" ? token : null;
    } catch {
      return null;
    }
  }

  private async acquire(key: string): Promise<string | null> {
    if (!this.redis) {
      return null;
    }

    const token = randomBytes(16).toString("hex");
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const result = await this.redis.trySet(key, token, "NX", "EX", LOCK_TTL_SEC);
        if (result === "OK") {
          return token;
        }
      } catch {
        return null;
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }

    return null;
  }

  private async release(key: string, token: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      const deleted = await this.redis.tryEval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      );
      if (deleted !== null) {
        return;
      }

      if ((await this.redis.tryGet(key)) === token) {
        await this.redis.delete(key);
      }
    } catch {
      // Locks expire if best-effort release fails.
    }
  }
}
