import type { SemConvAttributes } from "langwatch/observability";

export interface EventSourcedQueueProcessorOptions {
  concurrency?: number;
  /**
   * Maximum number of groups that can be processed in parallel.
   * Only used by GroupQueueProcessor.
   * @default 100 (or the GLOBAL_QUEUE_CONCURRENCY env var)
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
  /**
   * Whether a dedup key whose job has already been DISPATCHED (removed from
   * staging) but whose TTL is still alive should SQUASH a new job rather than be
   * treated as stale and cleaned up.
   *
   * Default (`false`): the historical behavior — once the deduplicated job is
   * dispatched, the dedup key is considered stale, deleted, and a new job stages
   * (so a late re-trigger re-runs the command). When `true`, the still-alive TTL
   * is HONORED: the new job is squashed for the remainder of the TTL window, so a
   * late re-trigger arriving after dispatch cannot re-run the command. Use it
   * when the dedup TTL is sized to span the whole window in which duplicate
   * triggers may arrive (fixes per-trace evaluations running twice, #3912).
   * @default false
   */
  shouldSurviveDispatch?: boolean;
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
 * const perAggregate: DeduplicationStrategy<Event> = "aggregate";
 * const custom: DeduplicationStrategy<Event> = {
 *   makeId: (event) => `${event.tenantId}:custom-key`,
 *   ttlMs: 2000,
 * };
 * ```
 */
export type DeduplicationStrategy<Payload> = "aggregate" | DeduplicationConfig<Payload>;

/**
 * What the queue knows about THIS delivery of a job, as opposed to the job's
 * own payload.
 *
 * `attempt` is 1 on a fresh delivery and increments per retry. A fold uses it
 * to tell a first delivery from a redelivery: on a fresh delivery the previous
 * batch for that group must already have been acked (the queue holds one
 * active batch per group), so anything it recorded about applied events is
 * dead and can be discarded rather than accumulated forever.
 */
export interface JobDelivery {
  attempt: number;
  /**
   * True when this handler call is a later sub-batch of the SAME locked
   * dispatch, after an earlier sub-batch of this delivery already committed
   * (set by the GroupQueue's batch bisection). Delivery-scoped state written by
   * the handler — the fold store's applied-event-id set — must be EXTENDED on a
   * continuation, never replaced: each commit in the chain only carries its own
   * sub-batch's ids, and replacing would erase the ids the earlier commits
   * recorded, letting a retry re-apply them (#6578).
   */
  isContinuation?: boolean;
}

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

export interface EventSourcedQueueDefinition<Payload extends Record<string, unknown>> {
  /**
   * Base name for the queue and job.
   * Queue name will be derived as `{name}` (with braces).
   * Job name will be `name` (without braces).
   */
  name: string;
  /**
   * Domain-specific processor that runs inside the worker.
   */
  process: (payload: Payload, delivery?: JobDelivery) => Promise<void>;

  /**
   * Optional batch processor. When set together with `coalesceMaxBatch`, the
   * GroupQueue may fold several queued jobs of the same group into a single
   * invocation (the dispatched job plus drained siblings), in occurredAt order.
   * Used by fold projections to collapse a backed-up group's events into one
   * load/apply/store cycle. The first payload is always the dispatched job.
   */
  processBatch?: (payloads: Payload[], delivery?: JobDelivery) => Promise<void>;

  /**
   * Optional per-payload resolver for the maximum number of same-group jobs to
   * coalesce into one `processBatch` call (including the dispatched job).
   * Returns 1 (or undefined) to disable coalescing for that payload — the
   * default, which leaves the per-job path byte-for-byte unchanged.
   */
  coalesceMaxBatch?: (payload: Payload) => number | undefined;

  /**
   * Optional per-payload resolver for the maximum total byte size of a coalesced
   * batch (ADR-066 pillar 2). The drain stops before taking a same-group job
   * that would push the batch past this budget, so a coalesced append stays
   * inside the downstream flush budget; a job too large to fit is left for its
   * own later dispatch. Returns undefined to fall back to the GroupQueue default
   * ({@link DEFAULT_COALESCE_MAX_BYTES}). Only consulted when `coalesceMaxBatch`
   * enables coalescing.
   *
   * The budget is spent in payload bytes — the size a worker's batch actually
   * holds — not in the bytes the job occupies in Redis, which for a compressed
   * or blob-offloaded body is a small fraction of it.
   */
  coalesceMaxBytes?: (payload: Payload) => number | undefined;

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
}

/**
 * Options for per-send overrides of queue behavior.
 * Allows individual send calls to override the queue-level delay and deduplication.
 */
export interface QueueSendOptions<Payload> {
  delay?: number;
  deduplication?: DeduplicationConfig<Payload>;
}

export interface EventSourcedQueueProcessor<Payload extends Record<string, unknown>> {
  send(payload: Payload, options?: QueueSendOptions<Payload>): Promise<void>;
  sendBatch(payloads: Payload[], options?: QueueSendOptions<Payload>): Promise<void>;
  /**
   * Gracefully closes the queue processor, waiting for in-flight jobs to complete.
   * Should be called during application shutdown.
   */
  close(): Promise<void>;
  /**
   * Waits until the queue processor is ready to accept jobs.
   * For groupQueue, this waits for the worker to connect to Redis.
   * For memory queues, this resolves immediately.
   */
  waitUntilReady(): Promise<void>;
}
