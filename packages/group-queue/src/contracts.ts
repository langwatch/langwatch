import type { Instant } from "@langwatch/time";
import type { Attributes } from "@opentelemetry/api";
import type { Cluster, Redis as IORedis } from "ioredis";

import type { ExhaustedOutcome } from "./deadLetter.ts";
import type { MintStorageUri, ObjectStore } from "./storage.ts";

export interface GroupQueuePayloadSchema<Payload> {
  parse(value: unknown): Payload;
}

export interface GroupQueueDefinition<
  Payload extends Record<string, unknown>,
  Name extends string = string,
> {
  readonly name: Name;
  readonly transportName: `{${Name}}`;
  readonly payload: GroupQueuePayloadSchema<Payload>;
  readonly groupBy: (payload: Payload) => string;
  readonly identify: (payload: Payload) => string;
  readonly score?: (payload: Payload) => number;
  readonly spanAttributes?: (payload: Payload) => Attributes;
  readonly delay?: number;
  readonly deduplication?: DeduplicationConfig<Payload>;
  readonly coalescing?: GroupQueueCoalescing<Payload>;
  /** Absent blocks the group, as before; "dead-letter" parks only the job and drains on. */
  readonly onExhausted?: (payload: Payload) => ExhaustedOutcome;
}

export interface GroupQueueCoalescing<Payload> {
  readonly maxItems: (payload: Payload) => number | undefined;
  readonly maxBytes?: (payload: Payload) => number | undefined;
}

export interface DeduplicationConfig<Payload> {
  makeId: (payload: Payload) => string;
  ttlMs?: number;
  extend?: boolean;
  replace?: boolean;
  shouldSurviveDispatch?: boolean;
}

export interface QueueSendOptions<Payload> {
  delay?: number;
  deduplication?: DeduplicationConfig<Payload>;
}

/**
 * One payload's answer from `sendEach`, at its input position. `rejected` wrote nothing for it;
 * `unknown` means Redis may or may not have staged it, so resend it with the same identity.
 */
export type QueueSendResult =
  | Readonly<{ status: "staged" }>
  | Readonly<{ status: "deduplicated" }>
  | Readonly<{ status: "rejected"; error: unknown }>
  | Readonly<{ status: "unknown"; error: unknown }>;

export interface JobDelivery {
  attempt: number;
  isContinuation?: boolean;
  /** The staged job's id, stable across retries and crash redelivery (ADR-080). */
  jobId?: string;
  /** A coalesced batch's staged job ids, one per payload in order. */
  jobIds?: readonly string[];
}

export interface GroupQueueHandlerContext extends JobDelivery {
  signal: AbortSignal;
}

/** One group's share of a cross-group batch: its payloads in queue order and its own delivery. */
export interface GroupBatchEntry<Payload> {
  payloads: Payload[];
  delivery: JobDelivery;
}

/** A handler identity whose ready groups may share one call: the envelope's routing trio. */
export interface GroupBatchRoute {
  pipelineName: string;
  jobType: string;
  jobName: string;
}

/**
 * Ready groups of one handler and one tenant run as one call (ARCHITECTURE §9). The call is
 * all-or-nothing; a failure is narrowed to whole groups by halving, and each group keeps its
 * own claim, attempts and order.
 */
export interface GroupQueueGroupBatching<Payload> {
  /** The handler identities that accept a cross-group call; read before each claim. */
  readonly routes: () => readonly GroupBatchRoute[];
  readonly run: (
    groups: { payloads: Payload[]; context: GroupQueueHandlerContext }[],
  ) => Promise<void>;
}

export interface GroupQueuePolicy {
  /** Slots a consumer starts at and never goes below; they grow while throughput rises. */
  globalConcurrency?: number;
  drainTimeoutMs?: number;
  tenantConcurrencyCap?: number;
  globalConcurrencyBudget?: number;
  confirmedDeathThreshold?: number;
  quarantineFailureThreshold?: number;
  bisectionSplitBudget?: number;
  /** Milliseconds a fresh group collects jobs before it is claimable; 0 claims at once. */
  settleWindowMs?: number;
  /** Most ready groups one cross-group call carries; 1 runs every group alone. */
  groupBatchMaxGroups?: number;
  /** Byte budget a cross-group call's coalesced payloads share. */
  groupBatchMaxBytes?: number;
  compression?: "gzip" | "zstd";
  payloadCodec?: "json" | "msgpack";
}

export interface GroupQueueContextMetadata {
  traceId?: string;
  parentSpanId?: string;
  organizationId?: string;
  projectId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface GroupQueueContext {
  capture(): GroupQueueContextMetadata | undefined;
  run<T>(metadata: GroupQueueContextMetadata | undefined, operation: () => Promise<T>): Promise<T>;
}

export interface GroupQueueActivity<Payload> {
  staged(event: {
    queue: string;
    group: string;
    payload: Payload;
    count: number;
  }): void | Promise<void>;
}

export interface GroupQueueFailureDecision {
  retryable: boolean;
  /** A floor over the queue's backoff. Present means overloaded: a batch backs off whole. */
  retryAfterMs?: number;
}

export interface GroupQueueFailureClassifier {
  classify(error: unknown): GroupQueueFailureDecision;
}

export interface GroupQueueDependencies<Payload, Destination = unknown> {
  redis: IORedis | Cluster;
  policy?: GroupQueuePolicy;
  context?: GroupQueueContext;
  activity?: GroupQueueActivity<Payload>;
  failures?: GroupQueueFailureClassifier;
  objectStoreFor?: (projectId: string) => ObjectStore;
  resolveStorageDestination?: (projectId: string) => Promise<Destination>;
  mintUri?: MintStorageUri<Destination>;
  /**
   * Names the preflight allow-list this queue's dispatch is scoped by. Set by
   * the migration role so system-migrations can register the groups it will
   * touch and drain them before anything else consumes the queue.
   */
  dispatchGroupAllowListKey?: string;
  /** A consumer that runs only the groups on lists a producer's `runListedWork` opened. */
  dispatchListed?: boolean;
}

export interface QueueAuditAdapter<Payload> {
  onEnqueue(event: {
    payload: Payload;
    groupKey: string;
    dedupKey: string | undefined;
    scheduledAt: Instant;
    maxAttempts?: number;
  }): Promise<void>;
  onLeased(event: { payload: Payload; attempt: number; leasedUntil?: Instant }): Promise<void>;
  onDispatched(event: { payload: Payload; at: Instant; attempt: number }): Promise<void>;
  onFailed(event: {
    payload: Payload;
    error: string;
    willRetry: boolean;
    nextAttemptAt?: Instant;
    attempt: number;
  }): Promise<void>;
  onDead(event: { payload: Payload; lastError: string; attempt: number }): Promise<void>;
}

/** Internal runtime shape. Public callers create this through defineGroupQueue. */
export interface GroupQueueRuntimeDefinition<Payload extends Record<string, unknown>> {
  name: string;
  process: (payload: Payload, delivery?: JobDelivery) => Promise<void>;
  processBatch?: (payloads: Payload[], delivery?: JobDelivery) => Promise<void>;
  /** Several groups of one handler and tenant in one call; see {@link GroupQueueGroupBatching}. */
  processGroups?: (groups: GroupBatchEntry<Payload>[]) => Promise<void>;
  groupBatchRoutes?: () => readonly GroupBatchRoute[];
  coalesceMaxBatch?: (payload: Payload) => number | undefined;
  coalesceMaxBytes?: (payload: Payload) => number | undefined;
  onExhausted?: (payload: Payload) => ExhaustedOutcome;
  options?: { globalConcurrency?: number };
  delay?: number;
  deduplication?: DeduplicationConfig<Payload>;
  spanAttributes?: (payload: Payload) => Attributes;
  groupKey: (payload: Payload) => string;
  identify: (payload: Payload) => string;
  score?: (payload: Payload) => number;
  auditAdapter?: QueueAuditAdapter<Payload>;
}

/** A listed run, as its work sees it: the work may wait for its own jobs before sending more. */
export interface ListedRun {
  /** Returns once at most `maxOutstanding` of this run's jobs wait or run; `signal` ends it. */
  waitForRoom(input: { maxOutstanding: number; signal?: AbortSignal }): Promise<void>;
}
