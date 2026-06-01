import type { OutboxPayload, OutboxRow, OutboxStatus } from "./outbox.types";

export interface OutboxInsertRow {
  projectId: string;
  reactorName: string;
  dedupKey: string;
  groupKey: string;
  payload: OutboxPayload;
  maxAttempts?: number;
}

export interface OutboxLeaseQuery {
  projectId: string;
  reactorName: string;
  /**
   * GroupQueue routing key of the wakeup that triggered this lease.
   * The lease SQL filters on it so a wakeup for trigger A can never
   * drain a row belonging to trigger B — per-group FIFO holds at the
   * row level, not just at the wakeup boundary. See ADR-023.
   */
  groupKey: string;
  leasedUntil: Date;
  now: Date;
}

export interface OutboxRetryUpdate {
  rowId: string;
  /** Tenancy guard — every write is scoped to the owning project. */
  projectId: string;
  /**
   * Expected `attempts` of the leased row. The update is a conditional
   * CAS — it only applies while the row is still `dispatching` with
   * this exact attempt count, so a stale read cannot clobber a row a
   * recovery sweep already re-queued and a second worker re-leased.
   */
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
   * reactorName, groupKey) whose nextAttemptAt has elapsed. Updates
   * status to "dispatching", sets leasedUntil, increments attempts.
   * Returns null when no row is claimable. Scoping by `groupKey`
   * preserves per-trigger FIFO at the row level (see ADR-023). See
   * ADR-023 for why the lease lives in PG (not Redis).
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
    projectId,
    now,
  }: {
    rowId: string;
    projectId: string;
    now: Date;
  }): Promise<void>;

  markRetry(update: OutboxRetryUpdate): Promise<void>;

  findById({
    rowId,
    projectId,
  }: {
    rowId: string;
    projectId: string;
  }): Promise<OutboxRow | null>;

  list(query: OutboxListQuery): Promise<OutboxRow[]>;
}
