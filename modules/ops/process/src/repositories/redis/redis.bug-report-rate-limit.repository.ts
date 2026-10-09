import type { RedisConnection } from "@langwatch/redis-client";

import type {
  BugReportRateLimitRepository,
  BugReportRateLimitWindow,
} from "../bug-report-rate-limit.repository.ts";
import { MemoryBugReportRateLimitRepository } from "../memory/memory.bug-report-rate-limit.repository.ts";

type CounterConnection = Pick<RedisConnection, "incr" | "expire" | "ttl">;

/**
 * The intake's buckets in Redis under main's key, so every process spends one allowance. A
 * failed command counts in this process instead, as main's limiter did (ADR-093), and a count
 * left without an expiry is given one, so no caller stays refused past the window.
 */
export class RedisBugReportRateLimitRepository implements BugReportRateLimitRepository {
  readonly #connection: CounterConnection;
  readonly #fallback: MemoryBugReportRateLimitRepository;

  private constructor(connection: CounterConnection, fallback: MemoryBugReportRateLimitRepository) {
    this.#connection = connection;
    this.#fallback = fallback;
  }

  static create({
    connection,
  }: {
    connection: CounterConnection;
  }): RedisBugReportRateLimitRepository {
    return new RedisBugReportRateLimitRepository(
      connection,
      MemoryBugReportRateLimitRepository.create(),
    );
  }

  async consume(window: BugReportRateLimitWindow): Promise<Readonly<{ allowed: boolean }>> {
    const redisKey = `langwatch:ratelimit:${window.key}`;
    try {
      const count = await this.#connection.incr(redisKey);
      if ((await this.#connection.ttl(redisKey)) < 0) {
        await this.#connection.expire(redisKey, window.windowSeconds);
      }
      return { allowed: count <= window.max };
    } catch {
      return this.#fallback.consume(window);
    }
  }
}
