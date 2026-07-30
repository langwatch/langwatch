import { createHash } from "node:crypto";
import type { GroupKey } from "@langwatch/event-sourcing";

/**
 * Dispatch-plane keys for the `log` aggregate (ADR-100).
 *
 * Two lanes exist, and they use different scopes deliberately:
 *
 * - The **command** lane is scoped to the aggregate — one lane per `recordId`
 *   — which is already the ADR-100 default and needs no override. The old
 *   pipeline additionally hashed every command into one of a bounded number
 *   of shards (`logCommandGroupKey`, `canonicalLog.ts:644-651`), because
 *   GroupQueue's per-group bookkeeping cost favoured bounding the *number* of
 *   distinct groups. That reason does not carry over: a content-addressed
 *   aggregate never reads prior state or writes one back (`aggregate.ts`), so
 *   there is no read-modify-write cycle for a wide lane to protect, and
 *   ADR-105 §8 asks for a non-default scope to be justified rather than
 *   inherited. One lane per record is already maximum parallelism and needs
 *   no sharding to be correct.
 * - The **map projection** lane genuinely needs the old sharding: a map
 *   coalesces only within one lane (ADR-100 decision 2), and one lane per
 *   record would mean one write per record — exactly the shape that has
 *   already taken a ClickHouse table down (ADR-099's "Context"). So the
 *   projection lane is `scope: partition`, hashed to a bounded shard count,
 *   which ADR-100's own Context names this pipeline as the pattern the two
 *   analytics rollups should adopt.
 */

export const DEFAULT_LOG_SHARD_COUNT = 16;
export const MIN_LOG_SHARD_COUNT = 1;
export const MAX_LOG_SHARD_COUNT = 128;

function clampShardCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_LOG_SHARD_COUNT;
  return Math.min(
    MAX_LOG_SHARD_COUNT,
    Math.max(MIN_LOG_SHARD_COUNT, Math.trunc(value)),
  );
}

/** Resolves a configured shard count, falling back to the default on anything unusable. */
export function resolveLogShardCount(value: string | undefined): number {
  if (!value) return DEFAULT_LOG_SHARD_COUNT;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clampShardCount(parsed)
    : DEFAULT_LOG_SHARD_COUNT;
}

/**
 * Which shard a record's writes coalesce into. Stable per `recordId` — a
 * redelivery of the same record always lands in the same shard, which is
 * incidental (the store's redelivery safety comes from content-addressing,
 * not from shard stability) but keeps a given record's write history in one
 * lane for anyone reading operational metrics per shard.
 */
export function logRecordShard(recordId: string, shardCount: number): number {
  const count = BigInt(clampShardCount(shardCount));
  const digest = createHash("sha256").update(recordId).digest("hex");
  return Number(BigInt(`0x${digest.slice(0, 16)}`) % count);
}

/** The command lane's key: one lane per aggregate, the ADR-100 default for a command. */
export function logRecordCommandGroupKey(args: {
  tenantId: string;
  recordId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "recordCanonicalLog" },
    scope: {
      kind: "aggregate",
      aggregateType: "log",
      aggregateId: args.recordId,
    },
  };
}

/** The map projection's key: a hashed, bounded shard so writes coalesce (ADR-100 decision 2). */
export function canonicalLogStorageGroupKey(args: {
  tenantId: string;
  recordId: string;
  shardCount?: number;
}): GroupKey {
  const shardCount = args.shardCount ?? DEFAULT_LOG_SHARD_COUNT;
  return {
    tenantId: args.tenantId,
    lane: { kind: "map", name: "canonicalLogStorage" },
    scope: {
      kind: "partition",
      parts: [String(logRecordShard(args.recordId, shardCount))],
    },
  };
}
