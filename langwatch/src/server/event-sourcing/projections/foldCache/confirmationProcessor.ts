import { createLogger } from "@langwatch/observability";
import type { Redis } from "ioredis";
import {
  incrementEsFoldCacheRedisError,
  incrementEsFoldConfirmationCheck,
  observeEsFoldConfirmationLag,
  observeEsFoldConfirmationReplicaLag,
  setEsFoldConfirmationPending,
} from "~/server/metrics";
import { decodeFoldCacheEntry } from "./foldCacheEntry";
import type { FoldDurabilityProbe } from "./durabilityProbe";
import { PendingConfirmations } from "./pendingConfirmations";

const logger = createLogger("langwatch:event-sourcing:fold-cache-confirmation");

/**
 * Reports which aggregates still have queue work outstanding.
 *
 * Needed because releasing a cache entry between a fold's durable write and a
 * RETRY of that same fold would let the retry read already-applied state from
 * the durable store and apply its events a second time. Retry backoff runs to
 * ten minutes, so this is not a narrow window.
 */
export interface AggregateLivenessCheck {
  /** Of the given aggregates, those with a job staged, active or retrying. */
  withWorkInFlight(input: {
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<Set<string>>;
}

export interface FoldCacheConfirmationTarget {
  /** Cache key prefix, also the projection label on metrics. */
  keyPrefix: string;
  /** Asks the durable store how far its slowest replica has caught up. */
  probe: FoldDurabilityProbe;
}

export interface FoldCacheConfirmationProcessorDeps {
  redis: Redis;
  targets: readonly FoldCacheConfirmationTarget[];
  /**
   * Optional only so the processor can be exercised in isolation. Wiring it in
   * production is required: without it, a confirmation landing between a fold's
   * durable write and its retry reopens the double-apply this design closes.
   * Absence is counted, not assumed away.
   */
  liveness?: AggregateLivenessCheck;
  /** Aggregates examined per projection per pass. */
  batchSize?: number;
  /** How long to wait before re-checking an aggregate that was not confirmed. */
  retryDelayMs?: number;
}

export interface ConfirmationPassSummary {
  confirmed: number;
  notYet: number;
  inFlight: number;
  backstopExpired: number;
  errors: number;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_RETRY_DELAY_MS = 15_000;

/**
 * Releases cached fold state once the durable store is confirmed to hold it.
 *
 * This is what makes a cache miss meaningful. Nothing else removes an entry
 * (bar the backstop TTL, which is reported separately), so a miss proves the
 * durable store is authoritative and can be read through safely — without a
 * quorum write or a sequential-consistency read, both of which were measured
 * and reverted in #2751 and #2899.
 *
 * Every failure path retains the entry. A lagging replica, an unreachable node,
 * a probe error, an aggregate with work in flight and the processor being down
 * all leave the cached copy in place. The cost of being wrong in that direction
 * is memory; the cost of being wrong in the other direction is losing folded
 * state.
 */
export class FoldCacheConfirmationProcessor {
  private readonly batchSize: number;
  private readonly retryDelayMs: number;

  constructor(private readonly deps: FoldCacheConfirmationProcessorDeps) {
    this.batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
    this.retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async runOnce(): Promise<ConfirmationPassSummary> {
    const total: ConfirmationPassSummary = {
      confirmed: 0,
      notYet: 0,
      inFlight: 0,
      backstopExpired: 0,
      errors: 0,
    };

    for (const target of this.deps.targets) {
      const summary = await this.runTarget(target);
      total.confirmed += summary.confirmed;
      total.notYet += summary.notYet;
      total.inFlight += summary.inFlight;
      total.backstopExpired += summary.backstopExpired;
      total.errors += summary.errors;
    }

    return total;
  }

  private async runTarget(
    target: FoldCacheConfirmationTarget,
  ): Promise<ConfirmationPassSummary> {
    const summary: ConfirmationPassSummary = {
      confirmed: 0,
      notYet: 0,
      inFlight: 0,
      backstopExpired: 0,
      errors: 0,
    };

    const pending = new PendingConfirmations(this.deps.redis, target.keyPrefix);

    try {
      setEsFoldConfirmationPending(target.keyPrefix, await pending.depth());
    } catch (error) {
      logger.warn(
        { keyPrefix: target.keyPrefix, error: String(error) },
        "Could not read pending-confirmation depth",
      );
    }

    let due: Array<{ tenantId: string; aggregateId: string }>;
    try {
      due = await pending.due({ nowMs: Date.now(), limit: this.batchSize });
    } catch (error) {
      incrementEsFoldConfirmationCheck(target.keyPrefix, "error");
      logger.error(
        { keyPrefix: target.keyPrefix, error: String(error) },
        "Could not read pending confirmations — entries retained",
      );
      summary.errors += 1;
      return summary;
    }

    if (due.length === 0) return summary;

    for (const [tenantId, aggregateIds] of groupByTenant(due)) {
      const tenantSummary = await this.runTenant({
        target,
        pending,
        tenantId,
        aggregateIds,
      });
      summary.confirmed += tenantSummary.confirmed;
      summary.notYet += tenantSummary.notYet;
      summary.inFlight += tenantSummary.inFlight;
      summary.backstopExpired += tenantSummary.backstopExpired;
      summary.errors += tenantSummary.errors;
    }

    return summary;
  }

  private async runTenant({
    target,
    pending,
    tenantId,
    aggregateIds,
  }: {
    target: FoldCacheConfirmationTarget;
    pending: PendingConfirmations;
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<ConfirmationPassSummary> {
    const summary: ConfirmationPassSummary = {
      confirmed: 0,
      notYet: 0,
      inFlight: 0,
      backstopExpired: 0,
      errors: 0,
    };

    const settle: Array<{ tenantId: string; aggregateId: string }> = [];
    const defer: Array<{
      tenantId: string;
      aggregateId: string;
      nextDueAtMs: number;
    }> = [];
    const nextDueAtMs = Date.now() + this.retryDelayMs;

    let entries: Map<string, { updatedAt: number | null }>;
    try {
      entries = await this.readEntries({
        keyPrefix: target.keyPrefix,
        tenantId,
        aggregateIds,
      });
    } catch (error) {
      incrementEsFoldCacheRedisError(target.keyPrefix, "get");
      incrementEsFoldConfirmationCheck(
        target.keyPrefix,
        "error",
        aggregateIds.length,
      );
      logger.error(
        { keyPrefix: target.keyPrefix, tenantId, error: String(error) },
        "Could not read cache entries — entries retained",
      );
      return { ...summary, errors: aggregateIds.length };
    }

    // A pending member whose entry is gone was released by the backstop TTL
    // rather than by confirmation. That means the entry outlived its guarantee,
    // so it is surfaced as a fault rather than folded into the confirmed count.
    const candidates: string[] = [];
    for (const aggregateId of aggregateIds) {
      const entry = entries.get(aggregateId);
      if (!entry) {
        settle.push({ tenantId, aggregateId });
        summary.backstopExpired += 1;
        continue;
      }
      // Entries written before durability gating carry no version, so they
      // cannot be confirmed. They are left to the backstop rather than guessed
      // at, and disappear within one backstop period of the deploy.
      if (entry.updatedAt === null) {
        defer.push({ tenantId, aggregateId, nextDueAtMs });
        summary.notYet += 1;
        continue;
      }
      candidates.push(aggregateId);
    }

    const inFlight = await this.inFlight({
      keyPrefix: target.keyPrefix,
      tenantId,
      aggregateIds: candidates,
    });

    const checkable = candidates.filter((aggregateId) => {
      if (!inFlight.has(aggregateId)) return true;
      defer.push({ tenantId, aggregateId, nextDueAtMs });
      summary.inFlight += 1;
      return false;
    });

    if (checkable.length > 0) {
      try {
        const confirmed = await target.probe.confirmedUpdatedAt({
          tenantId,
          aggregateIds: checkable,
        });

        for (const aggregateId of checkable) {
          const entry = entries.get(aggregateId);
          const wanted = entry?.updatedAt;
          if (wanted === null || wanted === undefined) continue;

          const slowest = confirmed.get(aggregateId);

          if (slowest !== undefined && slowest >= wanted) {
            settle.push({ tenantId, aggregateId });
            summary.confirmed += 1;
            observeEsFoldConfirmationLag(
              target.keyPrefix,
              Math.max(0, Date.now() - wanted) / 1000,
            );
            continue;
          }

          if (slowest !== undefined) {
            observeEsFoldConfirmationReplicaLag(
              target.keyPrefix,
              Math.max(0, wanted - slowest) / 1000,
            );
          }

          defer.push({ tenantId, aggregateId, nextDueAtMs });
          summary.notYet += 1;
        }
      } catch (error) {
        for (const aggregateId of checkable) {
          defer.push({ tenantId, aggregateId, nextDueAtMs });
        }
        summary.errors += checkable.length;
        logger.error(
          { keyPrefix: target.keyPrefix, tenantId, error: String(error) },
          "Durability probe failed — entries retained",
        );
      }
    }

    await this.release({
      keyPrefix: target.keyPrefix,
      tenantId,
      aggregateIds: settle
        .filter((entry) => entries.has(entry.aggregateId))
        .map((entry) => entry.aggregateId),
    });

    await pending.settle(settle);
    await pending.defer(defer);

    incrementEsFoldConfirmationCheck(
      target.keyPrefix,
      "confirmed",
      summary.confirmed,
    );
    incrementEsFoldConfirmationCheck(target.keyPrefix, "not_yet", summary.notYet);
    incrementEsFoldConfirmationCheck(
      target.keyPrefix,
      "in_flight",
      summary.inFlight,
    );
    incrementEsFoldConfirmationCheck(
      target.keyPrefix,
      "backstop_expired",
      summary.backstopExpired,
    );
    incrementEsFoldConfirmationCheck(target.keyPrefix, "error", summary.errors);

    return summary;
  }

  private async inFlight({
    keyPrefix,
    tenantId,
    aggregateIds,
  }: {
    keyPrefix: string;
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<Set<string>> {
    if (!this.deps.liveness || aggregateIds.length === 0) return new Set();

    try {
      return await this.deps.liveness.withWorkInFlight({
        tenantId,
        aggregateIds,
      });
    } catch (error) {
      logger.error(
        { keyPrefix, tenantId, error: String(error) },
        "Liveness check failed — treating every aggregate as in flight",
      );
      return new Set(aggregateIds);
    }
  }

  private async readEntries({
    keyPrefix,
    tenantId,
    aggregateIds,
  }: {
    keyPrefix: string;
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<Map<string, { updatedAt: number | null }>> {
    const keys = aggregateIds.map((aggregateId) =>
      cacheKey({ keyPrefix, tenantId, aggregateId }),
    );
    const raws = await this.deps.redis.mget(...keys);

    const result = new Map<string, { updatedAt: number | null }>();
    aggregateIds.forEach((aggregateId, index) => {
      const raw = raws[index];
      if (raw === null || raw === undefined) return;
      try {
        result.set(aggregateId, {
          updatedAt: decodeFoldCacheEntry(raw).updatedAt,
        });
      } catch {
        // An unparseable entry cannot be confirmed; leave it to the backstop.
        result.set(aggregateId, { updatedAt: null });
      }
    });
    return result;
  }

  private async release({
    keyPrefix,
    tenantId,
    aggregateIds,
  }: {
    keyPrefix: string;
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<void> {
    if (aggregateIds.length === 0) return;

    try {
      await this.deps.redis.del(
        ...aggregateIds.map((aggregateId) =>
          cacheKey({ keyPrefix, tenantId, aggregateId }),
        ),
      );
    } catch (error) {
      // The entry stays and gets re-checked; it is still correct to serve, just
      // no longer needed. Nothing is lost by failing here.
      incrementEsFoldCacheRedisError(keyPrefix, "del");
      logger.warn(
        { keyPrefix, tenantId, error: String(error) },
        "Could not release confirmed cache entries",
      );
    }
  }
}

function cacheKey({
  keyPrefix,
  tenantId,
  aggregateId,
}: {
  keyPrefix: string;
  tenantId: string;
  aggregateId: string;
}): string {
  return `fold:${keyPrefix}:${tenantId}:${aggregateId}`;
}

function groupByTenant(
  entries: ReadonlyArray<{ tenantId: string; aggregateId: string }>,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const { tenantId, aggregateId } of entries) {
    const existing = grouped.get(tenantId);
    if (existing) existing.push(aggregateId);
    else grouped.set(tenantId, [aggregateId]);
  }
  return grouped;
}
