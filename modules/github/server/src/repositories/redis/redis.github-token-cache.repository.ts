import { randomBytes } from "node:crypto";
import { nowInstant } from "@langwatch/time";

import type { GithubRedis } from "./github-redis.connection.ts";
import type { GithubHost } from "../../app/github.infrastructure.ts";
import { GithubTokenCacheRepository } from "../github-token-cache.repository.ts";

const LOCK_TTL_SEC = 15;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_WAIT_MS = 3_000;

/**
 * The Redis tier. The connection is nullable because this module's Redis is
 * optional infrastructure: a process that opened none keeps every row absent,
 * which is the same answer a cold cache gives, so the App degrades to asking
 * GitHub every time rather than refusing to boot.
 */
export class GithubTokenCacheRedisRepository extends GithubTokenCacheRepository {
  static create(parts: {
    redis: GithubRedis | null;
    host: GithubHost;
  }): GithubTokenCacheRedisRepository {
    return new GithubTokenCacheRedisRepository(parts.redis, parts.host);
  }

  private constructor(
    private readonly redis: GithubRedis | null,
    private readonly host: GithubHost,
  ) {
    super();
  }

  findToken(input: { installationId: string; scopeKey: string }): Promise<string | null> {
    return this.read(`${this.prefix(input.installationId)}:${input.scopeKey}`);
  }

  storeToken(input: {
    installationId: string;
    scopeKey: string;
    token: string;
    ttlSec: number;
  }): Promise<void> {
    return this.write(
      `${this.prefix(input.installationId)}:${input.scopeKey}`,
      input.token,
      input.ttlSec,
    );
  }

  async hasLiveness(installationId: string): Promise<boolean> {
    return Boolean(await this.read(this.livenessKey(installationId)));
  }

  markLiveness(input: {
    installationId: string;
    value: "alive" | "backoff";
    ttlSec: number;
  }): Promise<void> {
    return this.write(this.livenessKey(input.installationId), input.value, input.ttlSec);
  }

  acquireLivenessLock(installationId: string): Promise<string | null> {
    return this.acquireOnce(`${this.livenessKey(installationId)}:lock`);
  }

  acquireMintLock(input: { installationId: string; scopeKey: string }): Promise<string | null> {
    return this.acquireWaiting(`${this.prefix(input.installationId)}:${input.scopeKey}:lock`);
  }

  releaseLivenessLock(input: { installationId: string; token: string }): Promise<void> {
    return this.release(`${this.livenessKey(input.installationId)}:lock`, input.token);
  }

  releaseMintLock(input: {
    installationId: string;
    scopeKey: string;
    token: string;
  }): Promise<void> {
    return this.release(`${this.prefix(input.installationId)}:${input.scopeKey}:lock`, input.token);
  }

  private prefix(installationId: string): string {
    const hostname = this.host.getHost();
    const segment = hostname === "github.com" ? "" : `${hostname}:`;
    return `langy:gh:insttoken:${segment}${installationId}`;
  }

  private livenessKey(installationId: string): string {
    return `${this.prefix(installationId)}:liveness`;
  }

  private async read(key: string): Promise<string | null> {
    if (!this.redis) {
      return null;
    }

    try {
      return await this.redis.tryGet(key);
    } catch {
      return null;
    }
  }

  private async write(key: string, value: string, ttlSec: number): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.trySet(key, value, "EX", ttlSec);
    } catch {
      // Cache failure does not change the provider operation's result.
    }
  }

  private async acquireOnce(key: string): Promise<string | null> {
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

  private async acquireWaiting(key: string): Promise<string | null> {
    if (!this.redis) {
      return null;
    }

    const token = randomBytes(16).toString("hex");
    const deadline = nowInstant().epochMilliseconds + LOCK_MAX_WAIT_MS;
    while (nowInstant().epochMilliseconds < deadline) {
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
