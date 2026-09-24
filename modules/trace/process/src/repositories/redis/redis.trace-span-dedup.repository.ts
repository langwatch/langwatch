/**
 * Best-effort span dedup on the same Redis keys every other graph uses. THE
 * KEY FORMAT IS FROZEN: a live deployment holds claims under it, and
 * changing it would re-ingest every span an SDK retries mid-rollout.
 */
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";

import {
  type SpanDedupClaim,
  type SpanDedupRef,
  TraceSpanDedupRepository,
} from "../trace-span-dedup.repository.ts";

const SPAN_DEDUP_KEY_PREFIX = "span_dedup:";
/** Short enough that a crashed process's lock expires before a retry needs it. */
const PROCESSING_TTL_SECONDS = 60;
/** Long enough to cover an SDK's own retry window, which is well under an hour. */
const CONFIRMED_TTL_SECONDS = 3600;

const dedupKey = (span: SpanDedupRef): string =>
  `${SPAN_DEDUP_KEY_PREFIX}${span.tenantId}:${span.traceId}:${span.spanId}`;

/**
 * The claim, over the process's Redis. Every failure is a warning and an
 * ingestion that proceeds: losing a duplicate is worse than recording one.
 */
export class RedisTraceSpanDedupRepository extends TraceSpanDedupRepository {
  static create(input: {
    connection: ProcessMembers["redis"];
    logger?: Pick<Logger, "warn"> | undefined;
  }): RedisTraceSpanDedupRepository {
    return new RedisTraceSpanDedupRepository(
      input.connection,
      input.logger ?? createLogger("langwatch:trace:span-dedup"),
    );
  }

  #connection: ProcessMembers["redis"];
  #logger: Pick<Logger, "warn">;

  private constructor(connection: ProcessMembers["redis"], logger: Pick<Logger, "warn">) {
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
}
