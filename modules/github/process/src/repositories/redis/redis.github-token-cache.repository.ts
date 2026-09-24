import { randomBytes } from "node:crypto";

import type { ProcessMembers } from "@langwatch/process-stores/members";
import { nowInstant } from "@langwatch/time";

import {
  GithubTokenCacheRepository,
  type GithubInstallationKey,
  type GithubLockAcquisition,
} from "../github-token-cache.repository.ts";

const LOCK_TTL_SEC = 15;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_WAIT_MS = 3_000;

/** The Redis tier. A Redis that cannot answer keeps every row absent, as a cold cache does. */
export class GithubTokenCacheRedisRepository extends GithubTokenCacheRepository {
  static create(redis: ProcessMembers["redis"]): GithubTokenCacheRedisRepository {
    return new GithubTokenCacheRedisRepository(redis);
  }

  private constructor(private readonly redis: ProcessMembers["redis"]) {
    super();
  }

  findToken(input: GithubInstallationKey & { scopeKey: string }): Promise<string | null> {
    return this.read(`${prefix(input)}:${input.scopeKey}`);
  }

  storeToken(
    input: GithubInstallationKey & { scopeKey: string; token: string; ttlSec: number },
  ): Promise<void> {
    return this.write(`${prefix(input)}:${input.scopeKey}`, input.token, input.ttlSec);
  }

  async hasLiveness(input: GithubInstallationKey): Promise<boolean> {
    return Boolean(await this.read(livenessKey(input)));
  }

  markLiveness(
    input: GithubInstallationKey & { value: "alive" | "backoff"; ttlSec: number },
  ): Promise<void> {
    return this.write(livenessKey(input), input.value, input.ttlSec);
  }

  acquireLivenessLock(input: GithubInstallationKey): Promise<GithubLockAcquisition> {
    return this.acquireOnce(`${livenessKey(input)}:lock`);
  }

  acquireMintLock(
    input: GithubInstallationKey & { scopeKey: string },
  ): Promise<GithubLockAcquisition> {
    return this.acquireWaiting(`${prefix(input)}:${input.scopeKey}:lock`);
  }

  releaseLivenessLock(input: GithubInstallationKey & { token: string }): Promise<void> {
    return this.release(`${livenessKey(input)}:lock`, input.token);
  }

  releaseMintLock(
    input: GithubInstallationKey & { scopeKey: string; token: string },
  ): Promise<void> {
    return this.release(`${prefix(input)}:${input.scopeKey}:lock`, input.token);
  }

  private async read(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  private async write(key: string, value: string, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(key, value, "EX", ttlSec);
    } catch {
      // Cache failure does not change the provider operation's result.
    }
  }

  private async acquireOnce(key: string): Promise<GithubLockAcquisition> {
    const token = randomBytes(16).toString("hex");
    try {
      const result = await this.redis.set(key, token, "EX", LOCK_TTL_SEC, "NX");
      return result === "OK" ? { acquired: true, token } : { acquired: false };
    } catch {
      return { acquired: false };
    }
  }

  private async acquireWaiting(key: string): Promise<GithubLockAcquisition> {
    const token = randomBytes(16).toString("hex");
    const deadline = nowInstant().epochMilliseconds + LOCK_MAX_WAIT_MS;
    while (nowInstant().epochMilliseconds < deadline) {
      try {
        const result = await this.redis.set(key, token, "EX", LOCK_TTL_SEC, "NX");
        if (result === "OK") {
          return { acquired: true, token };
        }
      } catch {
        return { acquired: false };
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }

    return { acquired: false };
  }

  private async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      );
    } catch {
      // Locks expire if best-effort release fails.
    }
  }
}

function prefix(input: GithubInstallationKey): string {
  const segment = input.host === "github.com" ? "" : `${input.host}:`;
  return `langy:gh:insttoken:${segment}${input.installationId}`;
}

function livenessKey(input: GithubInstallationKey): string {
  return `${prefix(input)}:liveness`;
}
