import {
  calculateBackoffMs,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
  DEFAULT_BACKOFF_FACTOR,
} from "./backoff";
import type { OutboxRepository } from "./outbox.repository";
import type {
  EnqueueOutboxParams,
  EnqueueOutboxResult,
  LeaseOutboxParams,
  ListOutboxParams,
  MarkFailedRetryableParams,
  MarkFailedRetryableResult,
  OutboxRow,
  RecoverStuckLeasesParams,
} from "./outbox.types";

export interface OutboxServiceOptions {
  /**
   * Cap on rows recovered per `recoverStuckLeases` sweep. Keeps the
   * crash-recovery scan latency bounded under failure storms.
   */
  recoverLeasesBatchSize?: number;
  backoff?: {
    baseMs?: number;
    factor?: number;
    capMs?: number;
    random?: () => number;
  };
  /** Injectable clock for deterministic tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

const DEFAULT_RECOVER_BATCH_SIZE = 500;

/**
 * Public surface for the reactor outbox. Wraps the repository with
 * business rules: replay-safe enqueue, backoff math, retry promotion
 * to `dead`. See dev/docs/adr/021-024 for the design.
 *
 * Consumers should not import the repository directly — go through
 * this service so backoff/replay/dead promotion stay consistent
 * across reactors.
 */
export class OutboxService {
  private readonly recoverLeasesBatchSize: number;
  private readonly baseMs: number;
  private readonly factor: number;
  private readonly capMs: number;
  private readonly random: () => number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: OutboxRepository,
    options: OutboxServiceOptions = {},
  ) {
    this.recoverLeasesBatchSize =
      options.recoverLeasesBatchSize ?? DEFAULT_RECOVER_BATCH_SIZE;
    this.baseMs = options.backoff?.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.factor = options.backoff?.factor ?? DEFAULT_BACKOFF_FACTOR;
    this.capMs = options.backoff?.capMs ?? DEFAULT_BACKOFF_CAP_MS;
    this.random = options.backoff?.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Insert a row for a fresh match. Replay-safe: a second call with
   * the same (reactorName, dedupKey) is a no-op and returns
   * `enqueued: false`. The caller is responsible for posting a
   * wakeup to the GroupQueue afterwards.
   */
  async enqueue(params: EnqueueOutboxParams): Promise<EnqueueOutboxResult> {
    const enqueued = await this.repository.insertIfAbsent({
      projectId: params.projectId,
      reactorName: params.reactorName,
      dedupKey: params.dedupKey,
      groupKey: params.groupKey,
      payload: params.payload,
      maxAttempts: params.maxAttempts,
    });
    return { enqueued };
  }

  /**
   * Lease the next claimable row for (projectId, reactorName). Returns
   * null when the queue for this group is empty or all rows are still
   * backing off.
   */
  async leaseNext(params: LeaseOutboxParams): Promise<OutboxRow | null> {
    const now = this.now();
    const leasedUntil = new Date(now.getTime() + params.leaseDurationMs);
    return this.repository.leaseNext({
      projectId: params.projectId,
      reactorName: params.reactorName,
      leasedUntil,
      now,
    });
  }

  async markDispatched(rowId: string): Promise<void> {
    await this.repository.markDispatched({ rowId, now: this.now() });
  }

  /**
   * Record a retryable failure. Increments attempts, schedules the
   * next attempt via exponential backoff, and promotes to `dead`
   * when the row exceeds its `maxAttempts`.
   *
   * The repository has already incremented `attempts` on lease, so
   * the row passed back here reflects the post-attempt count.
   */
  async markFailedRetryable(
    params: MarkFailedRetryableParams,
  ): Promise<MarkFailedRetryableResult> {
    const row = await this.repository.findById(params.rowId);
    if (!row) {
      throw new Error(
        `OutboxService.markFailedRetryable: row ${params.rowId} not found`,
      );
    }

    const now = this.now();

    if (row.attempts >= row.maxAttempts) {
      await this.repository.markRetry({
        rowId: row.id,
        attempts: row.attempts,
        status: "dead",
        nextAttemptAt: null,
        lastError: params.error,
        lastErrorAt: now,
      });
      return { status: "dead", nextAttemptAt: null };
    }

    const backoffMs =
      params.backoffMs ??
      calculateBackoffMs({
        attempts: row.attempts,
        baseMs: this.baseMs,
        factor: this.factor,
        capMs: this.capMs,
        random: this.random,
      });
    const nextAttemptAt = new Date(now.getTime() + backoffMs);

    await this.repository.markRetry({
      rowId: row.id,
      attempts: row.attempts,
      status: "failed_retryable",
      nextAttemptAt,
      lastError: params.error,
      lastErrorAt: now,
    });

    return { status: "failed_retryable", nextAttemptAt };
  }

  /**
   * Force a row to `dead` regardless of attempts — used when the
   * dispatcher reports a permanently fatal failure (e.g. 4xx from
   * provider, malformed template).
   */
  async markDead({
    rowId,
    error,
  }: {
    rowId: string;
    error: string;
  }): Promise<void> {
    const row = await this.repository.findById(rowId);
    if (!row) {
      throw new Error(`OutboxService.markDead: row ${rowId} not found`);
    }
    const now = this.now();
    await this.repository.markRetry({
      rowId: row.id,
      attempts: row.attempts,
      status: "dead",
      nextAttemptAt: null,
      lastError: error,
      lastErrorAt: now,
    });
  }

  /**
   * Reset rows whose lease expired without the worker reporting back.
   * Drainer worker should call this on a slow timer (every ~30s)
   * since it is independent of any specific wakeup.
   */
  async recoverStuckLeases(
    params: RecoverStuckLeasesParams = {},
  ): Promise<number> {
    return this.repository.recoverExpiredLeases({
      now: this.now(),
      limit: params.limit ?? this.recoverLeasesBatchSize,
    });
  }

  async list(params: ListOutboxParams): Promise<OutboxRow[]> {
    return this.repository.list({
      projectId: params.projectId,
      reactorName: params.reactorName,
      status: params.status,
      limit: params.limit ?? 100,
    });
  }
}
