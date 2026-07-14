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
   *
   * Claim-once: when a row already exists, the second call's
   * `payload` / `groupKey` / `maxAttempts` are DISCARDED — the
   * original row is the source of truth (ADR-030 row-per-match). A
   * caller that mutates the payload shape and replays will still
   * dispatch the original payload, by design.
   *
   * Validates that `groupKey` starts with `${projectId}/` so the
   * wakeup parses cleanly under `tenantIdFromGroupId` (ADR-030). A
   * misformatted key would silently land in the wrong tenant bucket
   * for fair-scheduling purposes — failing here at enqueue is much
   * cheaper to debug than a starvation bug in production.
   */
  async enqueue(params: EnqueueOutboxParams): Promise<EnqueueOutboxResult> {
    const required = `${params.projectId}/`;
    if (!params.groupKey.startsWith(required)) {
      throw new Error(
        `OutboxService.enqueue: groupKey must start with "${required}" (got "${params.groupKey}"). See ADR-030.`,
      );
    }
    // The PG unique constraint is (projectId, reactorName, dedupKey),
    // so a key that doesn't carry the project at all CAN still pass —
    // but it makes operator log lines and debugging much worse, since
    // the dedupKey value loses tenant identity. Match the groupKey
    // convention: every `dedupKey` produced by an outbox reactor must
    // begin with `${projectId}/`. A caller that forgets is more
    // likely to also collide on (reactorName, dedupKey) across tenants
    // before the schema's project-scoped uniqueness was added, so this
    // check stays in place as a defence in depth.
    if (!params.dedupKey.startsWith(required)) {
      throw new Error(
        `OutboxService.enqueue: dedupKey must start with "${required}" (got "${params.dedupKey}"). See ADR-030.`,
      );
    }
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
      groupKey: params.groupKey,
      leasedUntil,
      now,
    });
  }

  async markDispatched({
    rowId,
    projectId,
  }: {
    rowId: string;
    projectId: string;
  }): Promise<void> {
    await this.repository.markDispatched({
      rowId,
      projectId,
      now: this.now(),
    });
  }

  /**
   * Record a retryable failure. Schedules the next attempt via
   * exponential backoff, and promotes to `dead` when the row has
   * exceeded its `maxAttempts`.
   *
   * Operates on the leased row passed in by the drainer — the
   * repository already incremented `attempts` on lease, so
   * `row.attempts` reflects the post-attempt count. No re-read: the
   * underlying `markRetry` is a CAS on (status `dispatching`,
   * `attempts`), so a concurrent recovery + re-lease cannot be
   * clobbered by a stale write.
   */
  async markFailedRetryable(
    params: MarkFailedRetryableParams,
  ): Promise<MarkFailedRetryableResult> {
    const { row } = params;
    const now = this.now();

    if (row.attempts >= row.maxAttempts) {
      await this.repository.markRetry({
        rowId: row.id,
        projectId: row.projectId,
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
      projectId: row.projectId,
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
   * provider, malformed template). Operates on the leased row; the
   * underlying CAS guards against clobbering a re-leased row.
   */
  async markDead({
    row,
    error,
  }: {
    row: OutboxRow;
    error: string;
  }): Promise<void> {
    const now = this.now();
    await this.repository.markRetry({
      rowId: row.id,
      projectId: row.projectId,
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
