import type { OutboxRow, OutboxStatus } from "./outbox.types";

export interface OutboxInsertRow {
  projectId: string;
  reactorName: string;
  dedupKey: string;
  groupKey: string;
  payload: unknown;
  maxAttempts?: number;
}

export interface OutboxLeaseQuery {
  projectId: string;
  reactorName: string;
  leasedUntil: Date;
  now: Date;
}

export interface OutboxRetryUpdate {
  rowId: string;
  attempts: number;
  status: Extract<OutboxStatus, "failed_retryable" | "dead">;
  nextAttemptAt: Date | null;
  lastError: string;
  lastErrorAt: Date;
}

export interface OutboxListQuery {
  projectId: string;
  reactorName?: string;
  status?: OutboxStatus;
  limit: number;
}

/**
 * Data-only repository for ReactorOutbox.
 *
 * Stays free of business rules: backoff math, replay decisions,
 * wakeup scheduling all live in `outbox.service.ts`. See
 * dev/docs/adr/019-repository-service-layering.md for the convention.
 */
export interface OutboxRepository {
  /**
   * Insert a row if one does not already exist for (reactorName,
   * dedupKey). Returns true when a row was inserted, false when a
   * pre-existing row deduplicated the call. This is the claim
   * primitive — see ADR-022.
   */
  insertIfAbsent(row: OutboxInsertRow): Promise<boolean>;

  /**
   * Atomically lease the next claimable row for (projectId,
   * reactorName) whose nextAttemptAt has elapsed. Updates status to
   * "dispatching", sets leasedUntil, increments attempts. Returns
   * null when no row is claimable. See ADR-023 for why the lease
   * lives in PG (not Redis).
   */
  leaseNext(query: OutboxLeaseQuery): Promise<OutboxRow | null>;

  /**
   * Recover rows whose lease expired without the worker reporting
   * back — flip them from "dispatching" back to "queued" so the next
   * drainer wake-up can re-lease.
   */
  recoverExpiredLeases({
    now,
    limit,
  }: {
    now: Date;
    limit: number;
  }): Promise<number>;

  markDispatched({
    rowId,
    now,
  }: {
    rowId: string;
    now: Date;
  }): Promise<void>;

  markRetry(update: OutboxRetryUpdate): Promise<void>;

  findById(rowId: string): Promise<OutboxRow | null>;

  list(query: OutboxListQuery): Promise<OutboxRow[]>;
}
