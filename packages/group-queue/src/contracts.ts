import type { Attributes } from "@opentelemetry/api";
import type { Cluster, Redis as IORedis } from "ioredis";

import type { ObjectStore, ProjectStorageDestination } from "./storage";

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

export interface JobDelivery {
  attempt: number;
  isContinuation?: boolean;
}

export interface GroupQueueHandlerContext extends JobDelivery {
  signal: AbortSignal;
}

export interface GroupQueuePolicy {
  globalConcurrency?: number;
  drainTimeoutMs?: number;
  tenantConcurrencyCap?: number;
  globalConcurrencyBudget?: number;
  confirmedDeathThreshold?: number;
  quarantineFailureThreshold?: number;
  bisectionSplitBudget?: number;
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

export interface GroupQueueContextPort {
  capture(): GroupQueueContextMetadata | undefined;
  run<T>(
    metadata: GroupQueueContextMetadata | undefined,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export interface GroupQueueActivityPort<Payload> {
  staged(event: {
    queue: string;
    group: string;
    payload: Payload;
    count: number;
  }): void | Promise<void>;
}

export interface GroupQueueFailureDecision {
  retryable: boolean;
  retryAfterMs?: number;
}

export interface GroupQueueFailureClassifier {
  classify(error: unknown): GroupQueueFailureDecision;
}

export interface GroupQueueDependencies<Payload> {
  redis: IORedis | Cluster;
  policy?: GroupQueuePolicy;
  context?: GroupQueueContextPort;
  activity?: GroupQueueActivityPort<Payload>;
  failures?: GroupQueueFailureClassifier;
  objectStoreFor?: (projectId: string) => ObjectStore;
  resolveStorageDestination?: (
    projectId: string,
  ) => Promise<ProjectStorageDestination>;
}

export interface QueueAuditAdapter<Payload> {
  onEnqueue(event: {
    payload: Payload;
    groupKey: string;
    dedupKey: string | undefined;
    scheduledAt: Date;
    maxAttempts?: number;
  }): Promise<void>;
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

/** Internal runtime shape. Public callers create this through defineGroupQueue. */
export interface GroupQueueRuntimeDefinition<
  Payload extends Record<string, unknown>,
> {
  name: string;
  process: (payload: Payload, delivery?: JobDelivery) => Promise<void>;
  processBatch?: (payloads: Payload[], delivery?: JobDelivery) => Promise<void>;
  coalesceMaxBatch?: (payload: Payload) => number | undefined;
  coalesceMaxBytes?: (payload: Payload) => number | undefined;
  options?: { globalConcurrency?: number };
  delay?: number;
  deduplication?: DeduplicationConfig<Payload>;
  spanAttributes?: (payload: Payload) => Attributes;
  groupKey: (payload: Payload) => string;
  identify: (payload: Payload) => string;
  score?: (payload: Payload) => number;
  auditAdapter?: QueueAuditAdapter<Payload>;
}
