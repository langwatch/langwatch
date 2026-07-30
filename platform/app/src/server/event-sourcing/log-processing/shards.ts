import { createHash } from "node:crypto";

/**
 * The projection lane's hashed shard. A map coalesces only within one lane, and
 * one lane per record would mean one write per record — the shape that has
 * already taken a ClickHouse table down (ADR-099), so records spread across a
 * bounded set of lanes instead (ADR-100).
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

/** Stable per record id, so one record's writes always serialise in one lane. */
export function logRecordShard(recordId: string, shardCount: number): number {
  const count = BigInt(clampShardCount(shardCount));
  const digest = createHash("sha256").update(recordId).digest("hex");
  return Number(BigInt(`0x${digest.slice(0, 16)}`) % count);
}
