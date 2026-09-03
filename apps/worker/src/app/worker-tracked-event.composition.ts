import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import type { RecordSpanCommandData, TrackEventRESTParamsValidator } from "@langwatch/trace-contract";
import {
  TraceIngressCommandPort,
  TraceSpanCollectionService,
  TraceSpanDedupPort,
  TrackedEventSpanService,
  TrackedEventSync,
  type SpanDedupRef,
} from "@langwatch/trace-server";

/**
 * Live span feedback (`langwatch.event`) recorded as a tracked event, on the
 * same path the REST `POST /api/events/track` handler takes.
 *
 * THE TWO PATHS MUST STAY ONE. An SDK that reports a thumbs-up on a span and a
 * customer that POSTs the same rating produce the same row, because both mint a
 * span whose id is a digest of `${trace_id}:${eventId}` and send it through
 * `recordSpan`. That is why this composes the packaged builder rather than
 * writing the span here: a second encoding of the same event is a second answer
 * to "what did this customer rate", and nothing in the fold could tell them
 * apart.
 *
 * WHY IT NEEDED A CONVERSION AT ALL. The builder's last line dispatched through
 * `getApp()` — the process-wide singleton — so nothing outside the application
 * could run it. The dispatch target underneath was already this package's own
 * span collection, so the harvest gave this process a builder it can hand its
 * OWN collection to.
 *
 *     trackedEventSyncHandler                (trace-server owns the subscriber)
 *       └─ TrackedEventSpanService           the harvested builder
 *            └─ TraceSpanCollectionService   dedup + the one command handoff
 *                 ├─ WorkerTraceSpanDedupAdapter   this process's Redis, or none
 *                 └─ WorkerTraceIngressCommandAdapter
 *                      └─ the registered `recordSpan` command
 *
 * THE COMMAND IS LATE-BOUND, and it has to be: the handler is part of the
 * pipeline DEFINITION, and the command only exists once that definition has
 * been registered. The proxy is resolved during installation, which completes
 * before the consumer claims its first job.
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

class WorkerTraceIngressCommandAdapter extends TraceIngressCommandPort {
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
 * Best-effort span deduplication, on the same Redis keys the application uses.
 *
 * FROZEN TWIN of `platform/app/src/server/app-layer/traces/span-dedupe.service.ts`,
 * and the key format is the reason: while both graphs ingest, the same span may
 * be claimed by either process, and a prefix or separator spelled differently
 * here would give this process its own keyspace — so a span exported twice
 * would be recorded twice, once by each graph.
 *
 * DEDUP NEVER BLOCKS INGESTION. The claim answers `null` when Redis is
 * unreachable and the caller ingests anyway, because losing a cache is not a
 * reason to lose a customer's span; the other two operations report and
 * continue, because failing to tidy up after one span must not fail the span.
 */
export function createWorkerTraceSpanDedup(options: {
  redis?: RedisConnection | null;
  logger?: Logger;
}): TraceSpanDedupPort {
  if (!options.redis) return new WorkerNullTraceSpanDedupAdapter();
  return new WorkerRedisTraceSpanDedupAdapter(
    options.redis,
    options.logger ?? createLogger("langwatch:trace-processing:span-dedup"),
  );
}

class WorkerRedisTraceSpanDedupAdapter extends TraceSpanDedupPort {
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
class WorkerNullTraceSpanDedupAdapter extends TraceSpanDedupPort {
  async tryAcquireProcessingLock(_span: SpanDedupRef): Promise<null> {
    return null;
  }

  async confirmProcessed(_span: SpanDedupRef): Promise<void> {}

  async releaseOnFailure(_span: SpanDedupRef): Promise<void> {}
}

function key(tenantId: string, traceId: string, spanId: string): string {
  return `${SPAN_DEDUP_KEY_PREFIX}${tenantId}:${traceId}:${spanId}`;
}
