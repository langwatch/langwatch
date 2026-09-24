import { CliSessionRecordNotFoundError } from "@langwatch/auth-contract";

import type { CliDeviceSessionRepository } from "../cli-device-session.repository.ts";

/** In-process twin of Auth's Redis-backed CLI device-session cache. */
export class MemoryCliDeviceSessionRepository implements CliDeviceSessionRepository {
  readonly values = new Map<string, string>();
  readonly tokenIndexes = new Map<string, Set<string>>();
  readonly #valueExpiresAt = new Map<string, number>();
  readonly #tokenIndexExpiresAt = new Map<string, number>();

  readonly #now: () => number;

  private constructor(now: () => number) {
    this.#now = now;
  }

  static create(options: { now?: () => number } = {}): MemoryCliDeviceSessionRepository {
    return new MemoryCliDeviceSessionRepository(options.now ?? Date.now);
  }

  async get(key: string): Promise<string> {
    this.#expireValue(key);
    const value = this.values.get(key);
    if (value === undefined) throw new CliSessionRecordNotFoundError();

    return value;
  }

  async set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    this.values.set(input.key, input.value);
    this.#valueExpiresAt.set(input.key, this.#now() + input.ttlSeconds * 1000);
  }

  async setIfAbsent(input: { key: string; value: string; ttlSeconds: number }): Promise<boolean> {
    this.#expireValue(input.key);
    if (this.values.has(input.key)) return false;

    this.values.set(input.key, input.value);
    this.#valueExpiresAt.set(input.key, this.#now() + input.ttlSeconds * 1000);
    return true;
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.#valueExpiresAt.delete(key);
    this.tokenIndexes.delete(key);
    this.#tokenIndexExpiresAt.delete(key);
  }

  async indexTokens(input: {
    indexKey: string;
    memberKeys: string[];
    ttlMs: number;
  }): Promise<void> {
    if (input.memberKeys.length === 0) return;

    this.#expireIndex(input.indexKey);
    const index = this.tokenIndexes.get(input.indexKey) ?? new Set<string>();
    this.tokenIndexes.set(input.indexKey, index);
    input.memberKeys.forEach((key) => index.add(key));
    this.#tokenIndexExpiresAt.set(input.indexKey, this.#now() + input.ttlMs);
  }

  async removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void> {
    this.#expireIndex(input.indexKey);
    this.tokenIndexes.get(input.indexKey)?.delete(input.memberKey);
  }

  #expireValue(key: string): void {
    const expiresAt = this.#valueExpiresAt.get(key);
    if (expiresAt === undefined || expiresAt > this.#now()) return;

    this.values.delete(key);
    this.#valueExpiresAt.delete(key);
  }

  #expireIndex(key: string): void {
    const expiresAt = this.#tokenIndexExpiresAt.get(key);
    if (expiresAt === undefined || expiresAt > this.#now()) return;

    this.tokenIndexes.delete(key);
    this.#tokenIndexExpiresAt.delete(key);
  }
}
