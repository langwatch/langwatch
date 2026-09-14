import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import type {
  RecordSpanCommandData,
  TrackEventRESTParamsValidator,
} from "@langwatch/trace-contract";
import {
  TraceIngressCommand,
  TraceSpanCollectionService,
  TraceSpanDedup,
  TrackedEventSpanService,
  TrackedEventSync,
  type SpanDedupRef,
} from "@langwatch/trace-server";

/**
 * Live span feedback recorded via the REST handler path. The two paths must
 * stay one.
 */
export type WorkerTrackedEventComposition = {
  /** The `trackedEventSync` subscriber handler, ready to register. */
  handler: ReturnType<typeof TrackedEventSync.createTrackedEventSyncHandler>;
  /** Called once the pipeline is installed and `recordSpan` exists. */
  connect(recordSpan: (data: RecordSpanCommandData) => Promise<unknown>): void;
};

export function createWorkerTrackedEvents(options: {
  redis?: RedisConnection | null;
  logger?: Logger;
}): WorkerTrackedEventComposition {
  const commands = new WorkerTraceIngressCommandAdapter();
  const collection = TraceSpanCollectionService.create({
    dedup: createWorkerTraceSpanDedup(options),
    commands,
  });
  const trackedEvents = TrackedEventSpanService.create({ collection });

  return {
    handler: TrackedEventSync.createTrackedEventSyncHandler({
      recordTrackedEvent: (input: {
        tenantId: string;
        body: TrackEventRESTParamsValidator;
        eventId: string;
      }) => trackedEvents.record(input),
    }),
    connect: (recordSpan) => commands.connect(recordSpan),
  };
}

class WorkerTraceIngressCommandAdapter extends TraceIngressCommand {
  private delegate: ((data: RecordSpanCommandData) => Promise<unknown>) | undefined;

  connect(delegate: (data: RecordSpanCommandData) => Promise<unknown>): void {
    this.delegate = delegate;
  }

  async recordSpan(data: RecordSpanCommandData): Promise<void> {
    if (!this.delegate) {
      throw new Error("Trace processing must install before tracked events are recorded.");
    }
    await this.delegate(data);
  }
}

const SPAN_DEDUP_KEY_PREFIX = "span_dedup:";
/** Short enough that a crashed process's lock expires before a retry needs it. */
const PROCESSING_TTL_SECONDS = 60;
/** Long enough to cover an SDK's own retry window, which is well under an hour. */
const CONFIRMED_TTL_SECONDS = 3600;

/**
 * Best-effort span deduplication on shared Redis keys. Dedup never blocks
 * ingestion.
 */
export function createWorkerTraceSpanDedup(options: {
  redis?: RedisConnection | null;
  logger?: Logger;
}): TraceSpanDedup {
  if (!options.redis) return new WorkerNullTraceSpanDedupAdapter();
  return new WorkerRedisTraceSpanDedupAdapter(
    options.redis,
    options.logger ?? createLogger("langwatch:trace-processing:span-dedup"),
  );
}

class WorkerRedisTraceSpanDedupAdapter extends TraceSpanDedup {
  constructor(
    private readonly redis: RedisConnection,
    private readonly logger: Logger,
  ) {
    super();
  }

  async tryAcquireProcessingLock({
    tenantId,
    traceId,
    spanId,
  }: SpanDedupRef): Promise<boolean | null> {
    try {
      const result = await this.redis.set(
        key(tenantId, traceId, spanId),
        "1",
        "EX",
        PROCESSING_TTL_SECONDS,
        "NX",
      );
      return result === "OK";
    } catch (error) {
      this.logger.error({ error, tenantId, traceId, spanId }, "Failed to acquire span dedup lock");
      return null;
    }
  }

  async confirmProcessed({ tenantId, traceId, spanId }: SpanDedupRef): Promise<void> {
    try {
      await this.redis.expire(key(tenantId, traceId, spanId), CONFIRMED_TTL_SECONDS);
    } catch (error) {
      this.logger.error({ error, tenantId, traceId, spanId }, "Failed to confirm span dedup");
    }
  }

  async releaseOnFailure({ tenantId, traceId, spanId }: SpanDedupRef): Promise<void> {
    try {
      await this.redis.del(key(tenantId, traceId, spanId));
    } catch (error) {
      this.logger.error({ error, tenantId, traceId, spanId }, "Failed to release span dedup lock");
    }
  }
}

/** No Redis: every claim answers "I don't know", so nothing is ever skipped. */
class WorkerNullTraceSpanDedupAdapter extends TraceSpanDedup {
  async tryAcquireProcessingLock(_span: SpanDedupRef): Promise<null> {
    return null;
  }

  async confirmProcessed(_span: SpanDedupRef): Promise<void> {}

  async releaseOnFailure(_span: SpanDedupRef): Promise<void> {}
}

function key(tenantId: string, traceId: string, spanId: string): string {
  return `${SPAN_DEDUP_KEY_PREFIX}${tenantId}:${traceId}:${spanId}`;
}
