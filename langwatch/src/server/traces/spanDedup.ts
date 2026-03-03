import { connection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";

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

/**
 * Best-effort span deduplication using Redis SET NX.
 *
 * Follows the abortManager pattern: plain exported object,
 * `if (!connection)` guards, catch-all error handling.
 * Dedup never blocks ingestion — all errors are swallowed and logged.
 */
export const spanDedup = {
  /**
   * Attempt to claim a processing lock for a span.
   *
   * @returns `true` if the lock was acquired (new span — process it),
   *          `false` if the key already existed (duplicate — skip it),
   *          `null` if Redis is unavailable (proceed without dedup).
   */
  async acquireProcessingLock(
    tenantId: string,
    traceId: string,
    spanId: string,
  ): Promise<boolean | null> {
    if (!connection) {
      return null;
    }

    try {
      const result = await connection.set(
        buildKey(tenantId, traceId, spanId),
        "1",
        "EX",
        PROCESSING_TTL_SECONDS,
        "NX",
      );
      return result === "OK";
    } catch (error) {
      logger.error(
        { error, tenantId, traceId, spanId },
        "Failed to acquire span dedup lock",
      );
      return null;
    }
  },

  /**
   * Extend the key TTL after successful processing.
   */
  async confirmProcessed(
    tenantId: string,
    traceId: string,
    spanId: string,
  ): Promise<void> {
    if (!connection) {
      return;
    }

    try {
      await connection.expire(
        buildKey(tenantId, traceId, spanId),
        CONFIRMED_TTL_SECONDS,
      );
    } catch (error) {
      logger.error(
        { error, tenantId, traceId, spanId },
        "Failed to confirm span dedup",
      );
    }
  },

  /**
   * Delete the key so retries can proceed immediately after a failure.
   */
  async releaseOnFailure(
    tenantId: string,
    traceId: string,
    spanId: string,
  ): Promise<void> {
    if (!connection) {
      return;
    }

    try {
      await connection.del(buildKey(tenantId, traceId, spanId));
    } catch (error) {
      logger.error(
        { error, tenantId, traceId, spanId },
        "Failed to release span dedup lock",
      );
    }
  },
};
