import type { SemConvAttributes } from "langwatch/observability";

export interface EventSourcedQueueProcessorOptions {
  concurrency?: number;
  /**
   * Maximum number of groups that can be processed in parallel.
   * Only used by GroupQueueProcessor.
   * @default 300
   */
  globalConcurrency?: number;
}

/**
 * Configuration for job deduplication.
 * When enabled, jobs with the same deduplication ID will be deduplicated within the TTL window.
 */
export interface DeduplicationConfig<Payload> {
  /**
   * Function to generate deduplication ID from payload.
   * Jobs with the same deduplication ID will be deduplicated within the TTL window.
   */
  makeId: (payload: Payload) => string;
  /**
   * TTL for deduplication in milliseconds.
   * @default 200
   */
  ttlMs?: number;
  /**
   * Whether to extend the TTL when a new job with the same deduplication ID is added.
   * When true, enables Debounce Mode where new jobs replace existing ones and reset the TTL.
   * @default true
   */
  extend?: boolean;
  /**
   * Whether to replace the job data when a new job with the same deduplication ID is added.
   * When true, enables Debounce Mode where the latest job data is used.
   * @default true
   */
  replace?: boolean;
}

/**
 * Strategy for deduplicating queue jobs.
 *
 * - `undefined`: No deduplication (default) - every event processed individually
 * - `"aggregate"`: Dedupe by `${tenantId}:${aggregateType}:${aggregateId}`
 * - `DeduplicationConfig`: Custom makeId function and TTL
 *
 * @example
 * ```typescript
 * // No deduplication (default) - processes every event
 * .withEventHandler("spanStorage", SpanStorageEventHandler, {
 *   eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
 * })
 *
 * // Dedupe by aggregate - only process latest event per aggregate
 * .withProjection("traceSummary", TraceSummaryProjectionHandler, {
 *   deduplication: "aggregate",
 *   delay: 1500,
 * })
 *
 * // Custom deduplication
 * .withProjection("analytics", AnalyticsProjectionHandler, {
 *   deduplication: {
 *     makeId: (event) => `${event.tenantId}:custom-key`,
 *     ttlMs: 2000,
 *   },
 * })
 * ```
 */
export type DeduplicationStrategy<Payload> =
  | "aggregate"
  | DeduplicationConfig<Payload>;

/**
 * Resolves a deduplication strategy to a concrete DeduplicationConfig or undefined.
 */
export function resolveDeduplicationStrategy<Payload>(
  strategy: DeduplicationStrategy<Payload> | undefined,
  createDefaultId: (payload: Payload) => string,
): DeduplicationConfig<Payload> | undefined {
  if (strategy === undefined) {
    return undefined;
  }
  if (strategy === "aggregate") {
    return { makeId: createDefaultId };
  }
  return strategy;
}

export interface EventSourcedQueueDefinition<
  Payload extends Record<string, unknown>,
> {
  /**
   * Base name for the queue and job.
   * Queue name will be derived as `{name}` (with braces).
   * Job name will be `name` (without braces).
   */
  name: string;
  /**
   * Domain-specific processor that runs inside the worker.
   */
  process: (payload: Payload) => Promise<void>;

  /**
   * Optional batch processor. When set together with `coalesceMaxBatch`, the
   * GroupQueue may fold several queued jobs of the same group into a single
   * invocation (the dispatched job plus drained siblings), in occurredAt order.
   * Used by fold projections to collapse a backed-up group's events into one
   * load/apply/store cycle. The first payload is always the dispatched job.
   */
  processBatch?: (payloads: Payload[]) => Promise<void>;

  /**
   * Optional per-payload resolver for the maximum number of same-group jobs to
   * coalesce into one `processBatch` call (including the dispatched job).
   * Returns 1 (or undefined) to disable coalescing for that payload — the
   * default, which leaves the per-job path byte-for-byte unchanged.
   */
  coalesceMaxBatch?: (payload: Payload) => number | undefined;

  /**
   * Optional options for the queue processor.
   */
  options?: EventSourcedQueueProcessorOptions;

  /**
   * Optional delay in milliseconds before processing the job.
   */
  delay?: number;

  /**
   * Optional deduplication configuration.
   * When set, jobs with the same deduplication ID will be deduplicated within the TTL window.
   */
  deduplication?: DeduplicationConfig<Payload>;

  /**
   * Optional function to extract span attributes from the payload.
   * These attributes will be merged with common attributes like queue.name, queue.job_name, etc.
   */
  spanAttributes?: (payload: Payload) => SemConvAttributes;

  /**
   * Optional function to extract a group key from the payload.
   * When provided, enables per-group sequential processing via the GroupQueue staging layer.
   * Jobs with the same group key are processed sequentially (FIFO), while different groups
   * are processed in parallel up to globalConcurrency.
   *
   * @example
   * ```typescript
   * groupKey: (event) => `${event.tenantId}:${event.aggregateType}:${event.aggregateId}`
   * ```
   */
  groupKey?: (payload: Payload) => string;

  /**
   * Optional function to extract a stable score (timestamp) from the payload.
   * Used by GroupQueue to ensure global ordering across nodes.
   */
  score?: (payload: Payload) => number;

  /**
   * Optional audit adapter that mirrors every job lifecycle event to a
   * durable side-store (typically PG). Used by the outbox dispatch queue
   * per ADR-030 revision: the queue owns scheduling and execution, and
   * the adapter projects each transition into a row that operator
   * dashboards query against.
   *
   * Adapter calls are best-effort relative to the queue's own state: a
   * PG outage logs+metrics, the queue keeps running, the next
   * transition's write resyncs the projection. Each call writes the
   * latest projection, not an event log.
   */
  auditAdapter?: QueueAuditAdapter<Payload>;
}

/**
 * Lifecycle hooks for queues that want to project state into a durable
 * side-store. Used by the outbox dispatch queue (ADR-030 revision).
 *
 * The queue invokes:
 *   - `onEnqueue` on a successful new-stage `send` (skipped on a
 *     dedup-collapsed send — the row already exists from the first
 *     send).
 *   - `onLeased` / `onDispatched` / `onFailed` / `onDead` around the
 *     `process` / `processBatch` callback execution.
 *
 * Adapter writes do not block dispatch — a thrown hook is caught and
 * logged so a PG outage cannot stall the Redis-side queue.
 */
export interface QueueAuditAdapter<Payload> {
  onEnqueue(event: {
    payload: Payload;
    groupKey: string;
    dedupKey: string | undefined;
    scheduledAt: Date;
    maxAttempts?: number;
  }): Promise<void>;

  /**
   * `attempt` is the current attempt number (1-indexed) carried by the
   * job. Adapters that maintain a projection use it as a CAS token so a
   * late event from a stale lease (attempt N) can't overwrite a
   * re-leased row (attempt N+1).
   *
   * `leasedUntil` is the wall-clock time the queue intends to hold the
   * job before its retry layer reschedules it. Adapters that track
   * stuck-state observability project it onto the audit row.
   */
  onLeased(event: {
    payload: Payload;
    attempt: number;
    leasedUntil?: Date;
  }): Promise<void>;

  onDispatched(event: {
    payload: Payload;
    at: Date;
    attempt: number;
  }): Promise<void>;

  onFailed(event: {
    payload: Payload;
    error: string;
    willRetry: boolean;
    nextAttemptAt?: Date;
    attempt: number;
  }): Promise<void>;

  onDead(event: {
    payload: Payload;
    lastError: string;
    attempt: number;
  }): Promise<void>;
}

/**
 * Options for per-send overrides of queue behavior.
 * Allows individual send calls to override the queue-level delay and deduplication.
 */
export interface QueueSendOptions<Payload> {
  delay?: number;
  deduplication?: DeduplicationConfig<Payload>;
}

export interface EventSourcedQueueProcessor<
  Payload extends Record<string, unknown>,
> {
  send(payload: Payload, options?: QueueSendOptions<Payload>): Promise<void>;
  sendBatch(
    payloads: Payload[],
    options?: QueueSendOptions<Payload>,
  ): Promise<void>;
  /**
   * Gracefully closes the queue processor, waiting for in-flight jobs to complete.
   * Should be called during application shutdown.
   */
  close(): Promise<void>;
  /**
   * Waits until the queue processor is ready to accept jobs.
   * For BullMQ, this waits for the worker to connect to Redis.
   * For memory queues, this resolves immediately.
   */
  waitUntilReady(): Promise<void>;
}
