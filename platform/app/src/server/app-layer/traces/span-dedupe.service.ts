// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { SpanDedupRef } from "@langwatch/trace-server";
import { traced } from "../tracing";

const logger = createLogger("langwatch:trace-processing:span-dedup");

const SPAN_DEDUP_KEY_PREFIX = "span_dedup:";

/**
 * Short TTL while span is being processed. If the worker crashes,
 * the key expires and retries can proceed.
 */
const PROCESSING_TTL_SECONDS = 60;

/**
 * Longer TTL after successful processing. Covers the typical retry
 * window from OTEL SDKs (usually < 30 min).
 */
const CONFIRMED_TTL_SECONDS = 3600; // 1 hour

function buildKey(tenantId: string, traceId: string, spanId: string): string {
  return `${SPAN_DEDUP_KEY_PREFIX}${tenantId}:${traceId}:${spanId}`;
}

export interface SpanDedupService {
  tryAcquireProcessingLock(span: SpanDedupRef): Promise<boolean | null>;
  tryConfirmProcessed(span: SpanDedupRef): Promise<void>;
  tryReleaseOnFailure(span: SpanDedupRef): Promise<void>;
}

/**
 * Best-effort span deduplication using Redis SET NX.
 *
 * Dedup never blocks ingestion — all errors are swallowed and logged.
 */
export class RedisSpanDedupeService implements SpanDedupService {
  constructor(private readonly redis: IORedis | Cluster) {}

  /**
   * Attempt to claim a processing lock for a span.
   *
   * @returns `true` if the lock was acquired (new span — process it),
   *          `false` if the key already existed (duplicate — skip it),
   *          `null` if Redis throws (proceed without dedup).
   */
  async tryAcquireProcessingLock({
    tenantId,
    traceId,
    spanId,
  }: SpanDedupRef): Promise<boolean | null> {
    try {
      const result = await this.redis.set(
        buildKey(tenantId, traceId, spanId),
        "1",
        "EX",
        PROCESSING_TTL_SECONDS,
        "NX",
      );
      return result === "OK";
    } catch (error) {
      logger.error({ error, tenantId, traceId, spanId }, "Failed to acquire span dedup lock");
      return null;
    }
  }

  /**
   * Extend the key TTL after successful processing.
   */
  async tryConfirmProcessed({ tenantId, traceId, spanId }: SpanDedupRef): Promise<void> {
    try {
      await this.redis.expire(buildKey(tenantId, traceId, spanId), CONFIRMED_TTL_SECONDS);
    } catch (error) {
      logger.error({ error, tenantId, traceId, spanId }, "Failed to confirm span dedup");
    }
  }

  /**
   * Delete the key so retries can proceed immediately after a failure.
   */
  async tryReleaseOnFailure({ tenantId, traceId, spanId }: SpanDedupRef): Promise<void> {
    try {
      await this.redis.del(buildKey(tenantId, traceId, spanId));
    } catch (error) {
      logger.error({ error, tenantId, traceId, spanId }, "Failed to release span dedup lock");
    }
  }
}

/**
 * No-op implementation when Redis is unavailable.
 * All operations return gracefully so ingestion proceeds without dedup.
 */
export class NullSpanDedupeService implements SpanDedupService {
  async tryAcquireProcessingLock(_span: SpanDedupRef): Promise<null> {
    return null;
  }
  async tryConfirmProcessed(_span: SpanDedupRef): Promise<void> {}
  async tryReleaseOnFailure(_span: SpanDedupRef): Promise<void> {}
}

export function createSpanDedupeService(redis: IORedis | Cluster | null): SpanDedupService {
  if (!redis) return new NullSpanDedupeService();
  return traced(new RedisSpanDedupeService(redis), "SpanDedupeService");
}
