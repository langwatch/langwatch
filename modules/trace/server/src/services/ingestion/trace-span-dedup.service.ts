/**
 * Best-effort span dedup on the same Redis keys every other graph uses. THE
 * KEY FORMAT IS FROZEN: a live deployment holds claims under it, and
 * changing it would re-ingest every span an SDK retries mid-rollout.
 */
import { createLogger, type Logger } from "@langwatch/observability";

import { TraceSpanDedup, type SpanDedupRef } from "./trace-ingestion.service.ts";

/** Exactly the two Redis operations a claim is made and released with. */
export interface TraceSpanDedupConnection {
  set(
    key: string,
    value: string,
    expiry: "EX",
    seconds: number,
    mode: "NX",
  ): Promise<string | null>;
  set(key: string, value: string, expiry: "EX", seconds: number): Promise<string | null>;
  del(key: string): Promise<number>;
}

const SPAN_DEDUP_KEY_PREFIX = "span_dedup:";
/** Short enough that a crashed process's lock expires before a retry needs it. */
const PROCESSING_TTL_SECONDS = 60;
/** Long enough to cover an SDK's own retry window, which is well under an hour. */
const CONFIRMED_TTL_SECONDS = 3600;

const dedupKey = (span: SpanDedupRef): string =>
  `${SPAN_DEDUP_KEY_PREFIX}${span.tenantId}:${span.traceId}:${span.spanId}`;

/**
 * The claim, over a real connection. Every failure is a warning and an
 * ingestion that proceeds: losing a duplicate is worse than recording one.
 */
export class RedisTraceSpanDedupAdapter extends TraceSpanDedup {
  static create(input: {
    connection: TraceSpanDedupConnection;
    logger?: Pick<Logger, "warn"> | undefined;
  }): RedisTraceSpanDedupAdapter {
    return new RedisTraceSpanDedupAdapter(
      input.connection,
      input.logger ?? createLogger("langwatch:trace:span-dedup"),
    );
  }

  #connection: TraceSpanDedupConnection;
  #logger: Pick<Logger, "warn">;

  private constructor(connection: TraceSpanDedupConnection, logger: Pick<Logger, "warn">) {
    super();
    this.#connection = connection;
    this.#logger = logger;
  }

  async tryAcquireProcessingLock(span: SpanDedupRef): Promise<boolean | null> {
    try {
      const claimed = await this.#connection.set(
        dedupKey(span),
        "processing",
        "EX",
        PROCESSING_TTL_SECONDS,
        "NX",
      );
      return claimed === "OK";
    } catch (error) {
      this.#logger.warn({ error, ...span }, "span dedup claim failed; ingesting anyway");
      return null;
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

/** No Redis: every span is claimed, and a duplicate export records twice. */
export class NullTraceSpanDedupAdapter extends TraceSpanDedup {
  static create(): NullTraceSpanDedupAdapter {
    return new NullTraceSpanDedupAdapter();
  }

  tryAcquireProcessingLock(): Promise<boolean | null> {
    return Promise.resolve(true);
  }

  confirmProcessed(): Promise<void> {
    return Promise.resolve();
  }

  releaseOnFailure(): Promise<void> {
    return Promise.resolve();
  }
}
