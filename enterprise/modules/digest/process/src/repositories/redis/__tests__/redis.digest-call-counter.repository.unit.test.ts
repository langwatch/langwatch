// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The fixed-window call counter against an in-memory Redis with real TTL semantics: a key that
 * lost its expiry is re-armed so a caller is never rate-limited forever, and a live window is
 * never pushed out by later calls.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { describe, expect, it } from "vitest";

import {
  type DigestCallCounterRedis,
  RedisDigestCallCounterRepository,
} from "../redis.digest-call-counter.repository.ts";

const KEY = "digest:call-counter:caller";

/** Redis semantics the counter relies on: ttl is -2 for a missing key, -1 for one with no expiry. */
class FakeRedis implements DigestCallCounterRedis {
  readonly #counts = new Map<string, number>();
  readonly #ttls = new Map<string, number>();

  seed(key: string, count: number, ttl?: number): void {
    this.#counts.set(key, count);
    if (ttl !== undefined) this.#ttls.set(key, ttl);
  }

  async incr(key: string): Promise<number> {
    const next = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.#counts.has(key)) return 0;
    this.#ttls.set(key, seconds);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    if (!this.#counts.has(key)) return -2;
    return this.#ttls.get(key) ?? -1;
  }
}

describe("RedisDigestCallCounterRepository", () => {
  describe("when a key was orphaned without an expiry", () => {
    it("re-arms it with the full window and keeps counting against max", async () => {
      const redis = new FakeRedis();
      redis.seed(KEY, 5);
      const repository = RedisDigestCallCounterRepository.create({ redis });

      const result = await repository.count({ key: "caller", windowSeconds: 60, max: 5 });

      expect(await redis.ttl(KEY)).toBe(60);
      expect(result.allowed).toBe(false);
    });
  });

  describe("when a window is already open", () => {
    it("opens it on the first call and does not extend it on later calls", async () => {
      const redis = new FakeRedis();
      const repository = RedisDigestCallCounterRepository.create({ redis });

      const first = await repository.count({ key: "caller", windowSeconds: 60, max: 2 });
      expect(await redis.ttl(KEY)).toBe(60);
      expect(first.allowed).toBe(true);

      redis.seed(KEY, 1, 10);
      const second = await repository.count({ key: "caller", windowSeconds: 60, max: 2 });

      expect(await redis.ttl(KEY)).toBe(10);
      expect(second.allowed).toBe(true);
    });
  });
});
