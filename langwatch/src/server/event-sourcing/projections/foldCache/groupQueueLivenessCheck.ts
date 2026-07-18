import type { Redis } from "ioredis";
import { foldGroupKey } from "../../services/queues/groupKey";
import type { AggregateLivenessCheck } from "./confirmationProcessor";

export interface GroupQueueLivenessCheckDeps {
  redis: Redis;
  /** Queue the fold's jobs run on, e.g. the global queue's name. */
  queueName: string;
  /** Fold projection name as registered, e.g. `traceSummary`. */
  projectionName: string;
  /** Aggregate type the fold consumes, e.g. `trace`. */
  aggregateType: string;
}

/**
 * Reports which aggregates still have GroupQueue work outstanding.
 *
 * The confirmation processor must not release a cached fold entry while a job
 * for that aggregate could still run. Releasing it between a fold's durable
 * write and a RETRY of that fold would let the retry read already-applied state
 * from the durable store and apply its events a second time — and retry backoff
 * runs to ten minutes, so the window is wide.
 *
 * An aggregate counts as in flight when its group has staged jobs, is currently
 * dispatched, or is blocked after exhausting retries. Blocked groups matter
 * most: they wait on an operator, so their jobs run again at an arbitrary point
 * in the future.
 *
 * The group key is derived through {@link foldGroupKey}, the same helper the
 * queue itself uses. That shared derivation is load-bearing rather than tidy:
 * a key that does not exist reads as "no work in flight", so a hand-copied
 * format that drifted would release entries a retry still depends on, silently
 * and in the dangerous direction.
 */
export class GroupQueueLivenessCheck implements AggregateLivenessCheck {
  constructor(private readonly deps: GroupQueueLivenessCheckDeps) {}

  async withWorkInFlight({
    tenantId,
    aggregateIds,
  }: {
    tenantId: string;
    aggregateIds: readonly string[];
  }): Promise<Set<string>> {
    if (aggregateIds.length === 0) return new Set();

    const { redis, queueName, projectionName, aggregateType } = this.deps;
    const prefix = `${queueName}:gq`;

    const pipeline = redis.pipeline();
    for (const aggregateId of aggregateIds) {
      const groupId = foldGroupKey({
        tenantId,
        projectionName,
        aggregateType,
        aggregateId,
      });
      pipeline.hlen(`${prefix}:group:${groupId}:data`);
      pipeline.exists(`${prefix}:group:${groupId}:active`);
      pipeline.sismember(`${prefix}:blocked`, groupId);
    }

    const replies = await pipeline.exec();
    const inFlight = new Set<string>();

    aggregateIds.forEach((aggregateId, index) => {
      const base = index * 3;
      const busy =
        readCount(replies?.[base]) > 0 ||
        readCount(replies?.[base + 1]) > 0 ||
        readCount(replies?.[base + 2]) > 0;

      if (busy) inFlight.add(aggregateId);
    });

    return inFlight;
  }
}

/**
 * Reads one pipeline reply as a count, treating an error or an unreadable value
 * as "busy" so an unclear answer never releases a cache entry.
 */
function readCount(reply: [Error | null, unknown] | undefined): number {
  if (!reply) return 1;
  const [error, value] = reply;
  if (error) return 1;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 1;
  }
  return 1;
}
