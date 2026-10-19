/**
 * Best-effort span dedup on the same Redis keys every other graph uses. THE
 * KEY FORMAT IS FROZEN: a live deployment holds claims under it, and
 * changing it would re-ingest every span an SDK retries mid-rollout.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

import {
  type SpanDedupClaim,
  type SpanDedupRef,
  TraceSpanDedupRepository,
  type UsageRecordRef,
} from "../trace-span-dedup.repository.ts";

const SPAN_DEDUP_KEY_PREFIX = "span_dedup:";
/** Short enough that a crashed process's lock expires before a retry needs it. */
const PROCESSING_TTL_SECONDS = 60;
/** Long enough to cover an SDK's own retry window, which is well under an hour. */
const CONFIRMED_TTL_SECONDS = 3600;

const dedupKey = (span: SpanDedupRef): string =>
  `${SPAN_DEDUP_KEY_PREFIX}${span.tenantId}:${span.traceId}:${span.spanId}`;

const USAGE_DEDUP_KEY_PREFIX = "usage_dedup:";
/** The spans that share a usage record come from two exporters, minutes apart at most. */
const USAGE_RECORD_TTL_SECONDS = 24 * 60 * 60;

const usageKey = (record: UsageRecordRef): string =>
  `${USAGE_DEDUP_KEY_PREFIX}${record.tenantId}:${record.recordId}`;

/** Sets the holder when the record is free and returns whoever holds it. */
const CLAIM_USAGE_RECORD_SCRIPT = `
local holder = redis.call('GET', KEYS[1])
if holder then
  return holder
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return ARGV[1]
`;

const RELEASE_USAGE_RECORD_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * The claim, over the process's Redis. Every failure is a warning and an
 * ingestion that proceeds: losing a duplicate is worse than recording one.
 */
export class RedisTraceSpanDedupRepository extends TraceSpanDedupRepository {
  static create(input: {
    connection: RedisConnection;
    logger?: Pick<Logger, "warn"> | undefined;
  }): RedisTraceSpanDedupRepository {
    return new RedisTraceSpanDedupRepository(
      input.connection,
      input.logger ?? createLogger("langwatch:trace:span-dedup"),
    );
  }

  #connection: RedisConnection;
  #logger: Pick<Logger, "warn">;

  private constructor(connection: RedisConnection, logger: Pick<Logger, "warn">) {
    super();
    this.#connection = connection;
    this.#logger = logger;
  }

  async claimProcessing(span: SpanDedupRef): Promise<SpanDedupClaim> {
    try {
      const claimed = await this.#connection.set(
        dedupKey(span),
        "processing",
        "EX",
        PROCESSING_TTL_SECONDS,
        "NX",
      );
      return claimed === "OK" ? { outcome: "acquired" } : { outcome: "held" };
    } catch (error) {
      this.#logger.warn({ error, ...span }, "span dedup claim failed; ingesting anyway");
      return { outcome: "unknown" };
    }
  }

  async confirmProcessed(span: SpanDedupRef): Promise<void> {
    try {
      await this.#connection.set(dedupKey(span), "processed", "EX", CONFIRMED_TTL_SECONDS);
    } catch (error) {
      this.#logger.warn({ error, ...span }, "span dedup confirmation failed");
    }
  }

  async releaseOnFailure(span: SpanDedupRef): Promise<void> {
    try {
      await this.#connection.del(dedupKey(span));
    } catch (error) {
      this.#logger.warn({ error, ...span }, "span dedup release failed");
    }
  }

  async claimUsageRecord(record: UsageRecordRef): Promise<SpanDedupClaim> {
    try {
      const holder = await this.#connection.eval(
        CLAIM_USAGE_RECORD_SCRIPT,
        1,
        usageKey(record),
        record.spanId,
        String(USAGE_RECORD_TTL_SECONDS),
      );
      return holder === record.spanId ? { outcome: "acquired" } : { outcome: "held" };
    } catch (error) {
      this.#logger.warn({ error, ...record }, "usage record claim failed; counting the span");
      return { outcome: "unknown" };
    }
  }

  async releaseUsageRecord(record: UsageRecordRef): Promise<void> {
    try {
      await this.#connection.eval(RELEASE_USAGE_RECORD_SCRIPT, 1, usageKey(record), record.spanId);
    } catch (error) {
      this.#logger.warn({ error, ...record }, "usage record release failed");
    }
  }
}
