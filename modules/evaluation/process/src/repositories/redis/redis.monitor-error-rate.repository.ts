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
/** Distinct messages kept per bucket; a new message past this is not tallied. */
const MAX_DISTINCT_MESSAGES = 20;

function keysOf({ projectId, monitorId, monitorRevision }: MonitorRevisionKey) {
  const base = `${KEY_PREFIX}:{${projectId}:${monitorId}:${monitorRevision}}`;
  return {
    counts: `${base}:counts`,
    messagesAt: (bucket: number) => `${base}:messages:${bucket}`,
    report: `${base}:reported`,
  };
}

function sumOf(values: (string | null)[]): number {
  return values.reduce((sum, value) => sum + (value ? Number.parseInt(value, 10) || 0 : 0), 0);
}

/** The bucket fields of the TTL span before the window, so a busy revision's hash stays bounded. */
function expiredFieldsBefore(oldest: number): string[] {
  const span = (TTL_SECONDS * 1000) / MONITOR_ERROR_RATE_WINDOW_MS;
  const count = span * monitorErrorRateBuckets(0).length;
  return Array.from({ length: count }, (_, index) => oldest - 1 - index).flatMap((bucket) => [
    `r:${bucket}`,
    `e:${bucket}`,
  ]);
}

/** Per monitor revision: a hash of five-minute buckets, a message hash per bucket, a claim. */
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
    const newest = buckets[0] ?? 0;
    const isError = input.outcome === "error";
    const pipe = this.redis.pipeline();
    pipe.hincrby(keys.counts, `r:${newest}`, 1);
    if (isError) pipe.hincrby(keys.counts, `e:${newest}`, 1);
    pipe.hdel(keys.counts, ...expiredFieldsBefore(buckets.at(-1) ?? newest));
    pipe.expire(keys.counts, TTL_SECONDS);
    pipe.hmget(keys.counts, ...buckets.map((bucket) => `r:${bucket}`));
    pipe.hmget(keys.counts, ...buckets.map((bucket) => `e:${bucket}`));
    const results = await pipe.exec();
    const offset = isError ? 4 : 3;
    const runs = sumOf((results?.[offset]?.[1] as (string | null)[] | undefined) ?? []);
    const errors = sumOf((results?.[offset + 1]?.[1] as (string | null)[] | undefined) ?? []);
    if (isError && input.errorMessage) {
      await this.tally({ key: keys.messagesAt(newest), message: input.errorMessage });
    }
    return { runs, errors };
  }

  async findTopErrors(input: MonitorRevisionKey & { now: number }): Promise<string[]> {
    const keys = keysOf(input);
    const pipe = this.redis.pipeline();
    for (const bucket of monitorErrorRateBuckets(input.now)) pipe.hgetall(keys.messagesAt(bucket));
    const results = (await pipe.exec()) ?? [];
    const totals = new Map<string, number>();
    for (const [, tallies] of results) {
      for (const [message, value] of Object.entries((tallies ?? {}) as Record<string, string>)) {
        totals.set(message, (totals.get(message) ?? 0) + (Number.parseInt(value, 10) || 0));
      }
    }
    return [...totals].toSorted(([, left], [, right]) => right - left).map(([message]) => message);
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
