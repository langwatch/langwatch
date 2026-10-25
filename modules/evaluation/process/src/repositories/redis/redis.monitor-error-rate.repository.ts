import type { RedisConnection } from "@langwatch/redis-client";

import {
  MONITOR_ERROR_RATE_WINDOW_MS,
  monitorErrorRateBuckets,
  type MonitorErrorRateCounts,
} from "../../rules/monitor-error-rate.rules.ts";
import type {
  MonitorErrorRateRepository,
  MonitorRevisionKey,
} from "../monitor-error-rate.repository.ts";

const KEY_PREFIX = "evaluation:monitor_error_rate";
/** Twice the window, so a key outlives every bucket it holds. */
const TTL_SECONDS = (2 * MONITOR_ERROR_RATE_WINDOW_MS) / 1000;
/** Distinct messages kept per revision; a new message past this is not tallied. */
const MAX_DISTINCT_MESSAGES = 20;

function keysOf({ projectId, monitorId, monitorRevision }: MonitorRevisionKey) {
  const base = `${KEY_PREFIX}:{${projectId}:${monitorId}:${monitorRevision}}`;
  return { counts: `${base}:counts`, messages: `${base}:messages`, report: `${base}:reported` };
}

function sumOf(values: (string | null)[]): number {
  return values.reduce((sum, value) => sum + (value ? Number.parseInt(value, 10) || 0 : 0), 0);
}

/** One hash of five-minute buckets per monitor revision, one hash of messages, one claim key. */
export class RedisMonitorErrorRateRepository implements MonitorErrorRateRepository {
  private constructor(private readonly redis: RedisConnection) {}

  static create({ redis }: Readonly<{ redis: RedisConnection }>): RedisMonitorErrorRateRepository {
    return new RedisMonitorErrorRateRepository(redis);
  }

  async record(
    input: MonitorRevisionKey & {
      outcome: "processed" | "error";
      errorMessage?: string;
      now: number;
    },
  ): Promise<MonitorErrorRateCounts> {
    const keys = keysOf(input);
    const buckets = monitorErrorRateBuckets(input.now);
    const [newest] = buckets;
    const isError = input.outcome === "error";
    const pipe = this.redis.pipeline();
    pipe.hincrby(keys.counts, `r:${newest}`, 1);
    if (isError) pipe.hincrby(keys.counts, `e:${newest}`, 1);
    pipe.expire(keys.counts, TTL_SECONDS);
    pipe.hmget(keys.counts, ...buckets.map((bucket) => `r:${bucket}`));
    pipe.hmget(keys.counts, ...buckets.map((bucket) => `e:${bucket}`));
    const results = await pipe.exec();
    const offset = isError ? 3 : 2;
    const runs = sumOf((results?.[offset]?.[1] as (string | null)[] | undefined) ?? []);
    const errors = sumOf((results?.[offset + 1]?.[1] as (string | null)[] | undefined) ?? []);
    if (isError && input.errorMessage) {
      await this.tally({ key: keys.messages, message: input.errorMessage });
    }
    return { runs, errors };
  }

  async findTopErrors(input: MonitorRevisionKey): Promise<string[]> {
    const tallies = await this.redis.hgetall(keysOf(input).messages);
    return Object.entries(tallies)
      .map(([message, value]) => ({ message, count: Number.parseInt(value, 10) || 0 }))
      .toSorted((left, right) => right.count - left.count)
      .map(({ message }) => message);
  }

  async claimReport(input: MonitorRevisionKey): Promise<boolean> {
    const claimed = await this.redis.set(keysOf(input).report, "1", "EX", TTL_SECONDS, "NX");
    return claimed === "OK";
  }

  async releaseReport(input: MonitorRevisionKey): Promise<void> {
    await this.redis.del(keysOf(input).report);
  }

  private async tally({ key, message }: { key: string; message: string }): Promise<void> {
    const [known, distinct] = await Promise.all([
      this.redis.hexists(key, message),
      this.redis.hlen(key),
    ]);
    if (!known && distinct >= MAX_DISTINCT_MESSAGES) return;
    await this.redis.pipeline().hincrby(key, message, 1).expire(key, TTL_SECONDS).exec();
  }
}
