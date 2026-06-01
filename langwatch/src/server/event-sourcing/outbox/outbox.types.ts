import type { Prisma, ReactorOutbox, ReactorOutboxStatus } from "@prisma/client";

export type OutboxRow = ReactorOutbox;
export type OutboxStatus = ReactorOutboxStatus;

/**
 * JSON payload stored on a ReactorOutbox row.
 *
 * Variable-size data goes here (trigger config, target ids, rendered
 * template inputs) so wakeup payloads stay constant-size — see ADR-023.
 */
export type OutboxPayload = Prisma.InputJsonValue;

export interface EnqueueOutboxParams {
  projectId: string;
  reactorName: string;
  /**
   * Stable identifier of the match. Collisions on (reactorName, dedupKey)
   * are the claim primitive that makes pipeline replays safe — see
   * ADR-022.
   *
   * MUST begin with `${projectId}/`. The unique index is global on
   * `(reactorName, dedupKey)` and the row carries `projectId` as a
   * column, not part of the claim key — without the prefix a producer
   * in project A could suppress an enqueue for the same unprefixed key
   * in project B under the same reactor. `OutboxService.enqueue`
   * validates the prefix and throws before any row is written.
   *
   * Convention (per-trigger subject scoping; the `${projectId}/` prefix
   * mirrors the `groupKey` shape so every dedup/group identifier in the
   * outbox layer is self-describing for an operator scanning rows; the
   * `:trace:` / `:graph:` discriminator namespaces subject types):
   *   - Trace/evaluation triggers: `${projectId}/${triggerId}:trace:${traceId}`
   *   - Custom-graph alerts:       `${projectId}/${triggerId}:graph:${customGraphId}`
   *
   * Aggregate-driven triggers (window-bucketed, no per-occurrence
   * subject row) are a separate future namespace —
   * `${projectId}/${triggerId}:${groupByLabelsHash}:${windowBucket}` —
   * not a per-subject key.
   */
  dedupKey: string;
  /**
   * GroupQueue routing key for the wakeup payload — see ADR-023.
   * MUST begin with `${projectId}/` so `tenantIdFromGroupId` can
   * extract the tenant for per-tenant fairness via
   * `TenantRateTracker`. The outbox queue is free-standing and
   * bypasses `queueManager`'s automatic `${tenantId}/` wrapping, so
   * the producer is responsible for the prefix.
   *
   * Convention for trigger reactors:
   *   `${projectId}/${reactorName}:${triggerId}`
   *
   * Per-trigger FIFO holds at both the wakeup boundary (the
   * GroupQueue serialises wakeups per groupKey) and at the row
   * level (the drainer's `leaseNext` scopes its claim by
   * groupKey) — see the longer note on `OutboxWakeup.groupKey`.
   */
  groupKey: string;
  payload: OutboxPayload;
  /** Override the per-row max retry count (default 8). */
  maxAttempts?: number;
}

export interface EnqueueOutboxResult {
  /** False when a row already existed for (reactorName, dedupKey). */
  enqueued: boolean;
}

export interface LeaseOutboxParams {
  projectId: string;
  reactorName: string;
  /**
   * GroupQueue routing key of the wakeup driving this lease. Scoping
   * the claim by `groupKey` keeps per-trigger FIFO at the row level —
   * a wakeup for trigger A can never drain trigger B's row, even when
   * trigger B's `nextAttemptAt` is older. See ADR-023.
   */
  groupKey: string;
  /** How long the lease should hold before another worker can re-claim. */
  leaseDurationMs: number;
}

export interface MarkFailedRetryableParams {
  /**
   * The leased row being failed. Carries the post-lease `attempts`
   * count and `projectId` so the service can decide dead-promotion and
   * scope the write without a racy re-read.
   */
  row: OutboxRow;
  error: string;
  /**
   * Optional explicit backoff override (ms). When omitted, the service
   * derives the next attempt time from `attempts` via exponential
   * backoff — see `backoff.ts`.
   */
  backoffMs?: number;
}

export interface MarkFailedRetryableResult {
  /** "dead" when the failure pushed `attempts` past `maxAttempts`. */
  status: Extract<OutboxStatus, "failed_retryable" | "dead">;
  nextAttemptAt: Date | null;
}

export interface RecoverStuckLeasesParams {
  /** Cap on rows touched per sweep to keep latency bounded. */
  limit?: number;
}

export interface ListOutboxParams {
  projectId: string;
  reactorName?: string;
  status?: OutboxStatus;
  limit?: number;
}
