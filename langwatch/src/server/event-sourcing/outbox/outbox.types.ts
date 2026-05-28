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
   * ADR-022. Typical shape: `${entityId}:${targetId}`.
   */
  dedupKey: string;
  /**
   * GroupQueue routing key for the wakeup payload. Drives per-group
   * FIFO and fair scheduling — typically the projectId or tenantId.
   * See ADR-023.
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
  /** How long the lease should hold before another worker can re-claim. */
  leaseDurationMs: number;
}

export interface MarkFailedRetryableParams {
  rowId: string;
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
