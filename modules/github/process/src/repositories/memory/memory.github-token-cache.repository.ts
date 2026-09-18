import { randomBytes } from "node:crypto";
import { nowInstant } from "@langwatch/time";

import { GithubTokenCacheRepository } from "../github-token-cache.repository.ts";
import type { MemoryGithubDatabase } from "./memory.github.database.ts";

const LOCK_TTL_SEC = 15;

/**
 * The memory twin of the installation-token rows. Expiry is honoured the way
 * Redis honours it - a row past its deadline reads as absent - so a test can
 * prove the cache misses without waiting for a real key to expire.
 */
export class MemoryGithubTokenCacheRepository extends GithubTokenCacheRepository {
  static create(parts: { memory: MemoryGithubDatabase }): MemoryGithubTokenCacheRepository {
    return new MemoryGithubTokenCacheRepository(parts.memory);
  }

  private constructor(private readonly memory: MemoryGithubDatabase) {
    super();
  }

  async findToken(input: { installationId: string; scopeKey: string }): Promise<string | null> {
    return this.read(this.tokenKey(input));
  }

  async storeToken(input: {
    installationId: string;
    scopeKey: string;
    token: string;
    ttlSec: number;
  }): Promise<void> {
    this.write(this.tokenKey(input), input.token, input.ttlSec);
  }

  async hasLiveness(installationId: string): Promise<boolean> {
    return this.read(`${installationId}:liveness`) !== null;
  }

  async markLiveness(input: {
    installationId: string;
    value: "alive" | "backoff";
    ttlSec: number;
  }): Promise<void> {
    this.write(`${input.installationId}:liveness`, input.value, input.ttlSec);
  }

  async acquireLivenessLock(installationId: string): Promise<string | null> {
    return this.acquire(`${installationId}:liveness:lock`);
  }

  async acquireMintLock(input: {
    installationId: string;
    scopeKey: string;
  }): Promise<string | null> {
    return this.acquire(`${this.tokenKey(input)}:lock`);
  }

  async releaseLivenessLock(input: { installationId: string; token: string }): Promise<void> {
    this.release(`${input.installationId}:liveness:lock`, input.token);
  }

  async releaseMintLock(input: {
    installationId: string;
    scopeKey: string;
    token: string;
  }): Promise<void> {
    this.release(`${this.tokenKey(input)}:lock`, input.token);
  }

  private tokenKey(input: { installationId: string; scopeKey: string }): string {
    return `${input.installationId}:${input.scopeKey}`;
  }

  private read(key: string): string | null {
    const row = this.memory.expiring.get(key);
    if (!row) {
      return null;
    }
    if (row.expiresAt <= nowInstant().epochMilliseconds) {
      this.memory.expiring.delete(key);
      return null;
    }

    return row.value;
  }

  private write(key: string, value: string, ttlSec: number): void {
    this.memory.expiring.set(key, {
      value,
      expiresAt: nowInstant().epochMilliseconds + ttlSec * 1000,
    });
  }

  private acquire(key: string): string | null {
    if (this.read(key) !== null) {
      return null;
    }

    const token = randomBytes(16).toString("hex");
    this.write(key, token, LOCK_TTL_SEC);

    return token;
  }

  private release(key: string, token: string): void {
    if (this.read(key) === token) {
      this.memory.expiring.delete(key);
    }
  }
}
